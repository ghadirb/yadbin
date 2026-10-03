import type { Env } from '../env';
import { apiBaseUrl } from '../config/urls';
import { currentProExpiry } from '../subscription/entitlements';
import { PAYMENT_TTL_MIN } from '../subscription/config';
import { HttpError, notFound } from '../utils/http';
import { newId, nowIso } from '../utils/ids';
import { rateLimit } from '../utils/ratelimit';
import { MyketPaymentProvider, parseMyketPurchase, verifyMyketSignature } from './myket';
import { getProvider } from './provider';

const UNAVAILABLE = 'پرداخت آنلاین به‌زودی فعال می‌شود.';
const unavailable = () => new HttpError(503, 'payments_unavailable', UNAVAILABLE);

export type PaymentState = 'pending' | 'verified' | 'failed' | 'expired';
export interface CallbackOutcome { paymentId: string; status: PaymentState; alreadyProcessed: boolean }

/** Step 1 — the teacher starts a payment. The amount comes from the plans table, never from the client. */
export async function createPayment(env: Env, teacherId: string, planId: string) {
  await rateLimit(env, `pay-create:${teacherId}`, 10, 3600);
  const provider = getProvider(env);
  if (!provider) throw unavailable();
  const plan = await env.DB.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').bind(planId).first<any>();
  if (!plan) throw notFound('پلن یافت نشد.');
  const store = provider.kind === 'store';
  if (store ? !plan.store_sku : plan.price_amount == null) throw unavailable(); // price (or Myket product) not decided yet
  const id = newId(), now = new Date();
  const expires = new Date(now.getTime() + PAYMENT_TTL_MIN * 60_000).toISOString();
  await env.DB.prepare('INSERT INTO payments (id,teacher_id,plan_id,provider,amount,currency,status,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, teacherId, plan.id, provider.id, store ? null : plan.price_amount, store ? null : plan.currency, 'pending', now.toISOString(), now.toISOString(), expires).run();
  try {
    const r = await provider.createPayment({ paymentId: id, amount: store ? null : plan.price_amount, currency: store ? null : plan.currency, description: plan.name, callbackUrl: `${apiBaseUrl(env)}/api/payment/callback`, sku: plan.store_sku ?? null });
    await env.DB.prepare('UPDATE payments SET authority = ?, updated_at = ? WHERE id = ?').bind(r.authority, nowIso(), id).run();
    // store: the app passes `sku` + `developerPayload` to the Myket purchase flow; redirect: the app opens `redirectUrl`.
    return { paymentId: id, status: 'pending' as PaymentState, provider: provider.id, kind: provider.kind, redirectUrl: r.redirectUrl, sku: r.sku ?? null, developerPayload: provider.kind === 'store' ? r.authority : null, expiresAt: expires };
  } catch (e) {
    // Gateway details never reach the client; they go to the developer log only.
    console.error(JSON.stringify({ level: 'error', where: 'payment.create', paymentId: id, message: e instanceof Error ? e.message : String(e) }));
    await env.DB.prepare("UPDATE payments SET status = 'failed', failure_reason = 'gateway_error', updated_at = ? WHERE id = ? AND status = 'pending'").bind(nowIso(), id).run();
    throw new HttpError(502, 'payment_gateway_error', 'اتصال به درگاه پرداخت ممکن نشد. کمی بعد دوباره تلاش کنید.');
  }
}

/**
 * Activates ONE subscription period for a verified payment. Idempotent: subscriptions.payment_id is UNIQUE, so replays
 * (duplicate callbacks, crash-and-retry) can never add time twice.
 *   active Pro  -> new period starts at the current expiry (renewal stacks)
 *   otherwise   -> starts now
 */
async function activateSubscription(env: Env, payment: any): Promise<void> {
  const exists = await env.DB.prepare('SELECT id FROM subscriptions WHERE payment_id = ?').bind(payment.id).first();
  if (exists) return;
  const plan = await env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(payment.plan_id).first<any>();
  if (!plan) throw new HttpError(500, 'internal_error', 'خطای داخلی سرور.');
  const now = nowIso();
  const current = await currentProExpiry(env, payment.teacher_id, now);
  const start = current ? current.expiresAt : now;
  const expires = new Date(new Date(start).getTime() + plan.duration_days * 86400_000).toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO subscriptions (id,teacher_id,plan_id,status,started_at,expires_at,provider,transaction_id,authority,payment_status,payment_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(newId(), payment.teacher_id, plan.id, 'active', start, expires, payment.provider, payment.ref_id, payment.authority, 'verified', payment.id, now, now).run();
}

async function finish(env: Env, id: string, to: 'failed' | 'expired', reason: string): Promise<PaymentState> {
  await env.DB.prepare("UPDATE payments SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(to, reason, nowIso(), id).run();
  const row = await env.DB.prepare('SELECT status FROM payments WHERE id = ?').bind(id).first<{ status: PaymentState }>();
  return row?.status ?? to;
}

/**
 * Steps 2–6 — the gateway sends the browser back. NOTHING here trusts the callback:
 * look up our own payment row -> ask the gateway to verify -> compare the amount with OUR stored amount ->
 * claim the transition pending->verified atomically (exactly one caller wins) -> activate the subscription.
 */
export async function handleCallback(env: Env, params: Record<string, string>): Promise<CallbackOutcome> {
  // The provider of the stored payment decides how to read the callback, so try the configured one first.
  const configured = getProvider(env);
  const authority = configured?.extractAuthority(params) ?? params.authority ?? params.Authority ?? null;
  if (!authority) throw new HttpError(400, 'bad_request', 'شناسه‌ی تراکنش ارسال نشده است.');
  const payment = await env.DB.prepare('SELECT * FROM payments WHERE authority = ?').bind(authority).first<any>();
  if (!payment) throw new HttpError(404, 'invalid_transaction', 'تراکنش معتبر نیست.');
  const provider = getProvider(env, payment.provider);
  if (!provider) throw unavailable();

  if (payment.status === 'verified') {
    await activateSubscription(env, payment); // heals a crash between "verified" and "subscription created"; no-op otherwise
    return { paymentId: payment.id, status: 'verified', alreadyProcessed: true };
  }
  if (payment.status !== 'pending') return { paymentId: payment.id, status: payment.status, alreadyProcessed: true };
  if (payment.expires_at < nowIso()) return { paymentId: payment.id, status: await finish(env, payment.id, 'expired', 'expired'), alreadyProcessed: false };

  let v;
  try {
    v = await provider.verifyPayment({ authority, expectedAmount: payment.amount, params });
  } catch (e) {
    // Transient gateway problem: keep the payment pending (the person may really have paid) so a retry can verify it.
    console.error(JSON.stringify({ level: 'error', where: 'payment.verify', paymentId: payment.id, message: e instanceof Error ? e.message : String(e) }));
    throw new HttpError(502, 'payment_verify_unavailable', 'تأیید پرداخت اکنون ممکن نیست. کمی بعد دوباره تلاش کنید.');
  }
  if (!v.ok) return { paymentId: payment.id, status: await finish(env, payment.id, 'failed', v.reason), alreadyProcessed: false };
  if (v.amount !== null && payment.amount !== null && v.amount !== payment.amount) return { paymentId: payment.id, status: await finish(env, payment.id, 'failed', 'amount_mismatch'), alreadyProcessed: false };

  let claimed = 0;
  try {
    const r = await env.DB.prepare("UPDATE payments SET status = 'verified', ref_id = ?, verified_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
      .bind(v.refId, nowIso(), nowIso(), payment.id).run();
    claimed = r.meta.changes ?? 0;
  } catch {
    // UNIQUE(provider, ref_id): this gateway transaction was already credited to another payment.
    return { paymentId: payment.id, status: await finish(env, payment.id, 'failed', 'duplicate_transaction'), alreadyProcessed: false };
  }
  const fresh = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(payment.id).first<any>();
  if (claimed === 0) return { paymentId: payment.id, status: fresh.status, alreadyProcessed: true }; // a parallel callback won the race
  await activateSubscription(env, fresh);
  return { paymentId: payment.id, status: 'verified', alreadyProcessed: false };
}

/** Owner-only status of one payment (a foreign id looks like a missing one). */
export async function paymentStatus(env: Env, teacherId: string, paymentId: string) {
  const p = await env.DB.prepare('SELECT id, plan_id, status, amount, currency, created_at, expires_at, verified_at FROM payments WHERE id = ? AND teacher_id = ?').bind(paymentId, teacherId).first<any>();
  if (!p) throw notFound('تراکنش یافت نشد.');
  const status: PaymentState = p.status === 'pending' && p.expires_at < nowIso() ? 'expired' : p.status;
  return { paymentId: p.id, planId: p.plan_id, status, amount: p.amount, currency: p.currency, createdAt: p.created_at, expiresAt: p.expires_at, verifiedAt: p.verified_at };
}

export interface StoreConfirmBody { originalJson: string; signature: string }

/**
 * Myket (store) flow — POST /api/payment/myket/confirm, called by the signed-in app after a purchase (or at app start for an
 * unconsumed purchase). Order of checks (cheapest/most decisive first, nothing is activated until ALL pass):
 *   1 signature of originalJson with the app's public key  2 package name  3 purchaseState == 0
 *   4 developerPayload is OUR payment row AND belongs to this teacher  5 product id == the plan's store_sku
 *   6 server-to-server verify with Myket  7 atomic pending->verified (unique purchase token)  8 activate one period.
 * Replays are harmless: a verified payment just answers "already processed" so the app may consume it. The app must consume
 * the purchase (so it can be bought again) only after receiving ok:true.
 */
export async function confirmStorePurchase(env: Env, teacherId: string, body: StoreConfirmBody, provider: MyketPaymentProvider | null = MyketPaymentProvider.fromEnv(env)) {
  await rateLimit(env, `pay-confirm:${teacherId}`, 30, 3600);
  if (!provider) throw unavailable();
  if (!body.originalJson || !body.signature || body.originalJson.length > 8192 || body.signature.length > 2048) throw new HttpError(400, 'bad_request', 'اطلاعات خرید معتبر نیست.');
  if (!(await verifyMyketSignature(provider.cfg.publicKey, body.originalJson, body.signature))) throw new HttpError(400, 'invalid_signature', 'امضای خرید معتبر نیست.');
  const purchase = parseMyketPurchase(body.originalJson);
  if (!purchase || purchase.packageName !== provider.cfg.packageName) throw new HttpError(400, 'invalid_transaction', 'اطلاعات خرید معتبر نیست.');
  if (purchase.purchaseState !== 0) throw new HttpError(402, 'purchase_not_completed', 'این خرید تکمیل نشده است.');

  const payment = purchase.developerPayload
    ? await env.DB.prepare('SELECT * FROM payments WHERE provider = ? AND authority = ? AND teacher_id = ?').bind(provider.id, purchase.developerPayload, teacherId).first<any>()
    : null;
  if (!payment) throw new HttpError(404, 'invalid_transaction', 'تراکنش معتبر نیست.'); // also what another account's payload looks like
  const plan = await env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(payment.plan_id).first<any>();
  if (!plan || !plan.store_sku || plan.store_sku !== purchase.productId) throw new HttpError(400, 'invalid_transaction', 'محصول خریداری‌شده با پلن انتخابی یکی نیست.');

  if (payment.status === 'verified') {
    if (payment.ref_id && payment.ref_id !== purchase.purchaseToken) throw new HttpError(409, 'invalid_transaction', 'تراکنش معتبر نیست.');
    await activateSubscription(env, payment); // heals a crash between "verified" and "subscription created"
    return { ok: true, paymentId: payment.id, status: 'verified' as PaymentState, alreadyProcessed: true };
  }
  // A pending row is honoured even after its 30-min window: the buyer has ALREADY paid Myket, so the purchase must still be delivered.
  if (payment.status !== 'pending') throw new HttpError(409, 'invalid_transaction', 'این تراکنش دیگر قابل استفاده نیست.');

  let v;
  try {
    v = await provider.verifyPayment({ authority: payment.authority, expectedAmount: null, sku: purchase.productId, params: { purchaseToken: purchase.purchaseToken, productId: purchase.productId, developerPayload: purchase.developerPayload } });
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', where: 'payment.myket.verify', paymentId: payment.id, message: e instanceof Error ? e.message : String(e) }));
    throw new HttpError(502, 'payment_verify_unavailable', 'تأیید خرید اکنون ممکن نیست. کمی بعد دوباره تلاش کنید؛ خرید شما از بین نمی‌رود.');
  }
  if (!v.ok) {
    // Myket says this token is not a successful purchase of this product. Terminal for this payment row.
    await finish(env, payment.id, 'failed', v.reason);
    throw new HttpError(402, 'purchase_not_verified', 'خرید توسط مایکت تأیید نشد.');
  }
  try {
    const r = await env.DB.prepare("UPDATE payments SET status = 'verified', ref_id = ?, verified_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
      .bind(v.refId, nowIso(), nowIso(), payment.id).run();
    if ((r.meta.changes ?? 0) === 0) { // a parallel confirm won the race
      const cur = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(payment.id).first<any>();
      if (cur?.status === 'verified') { await activateSubscription(env, cur); return { ok: true, paymentId: payment.id, status: 'verified' as PaymentState, alreadyProcessed: true }; }
      throw new HttpError(409, 'invalid_transaction', 'این تراکنش دیگر قابل استفاده نیست.');
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // UNIQUE(provider, ref_id): this Myket purchase token was already credited through another payment row.
    await finish(env, payment.id, 'failed', 'duplicate_transaction');
    throw new HttpError(409, 'duplicate_transaction', 'این خرید قبلاً ثبت شده است.');
  }
  const fresh = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(payment.id).first<any>();
  await activateSubscription(env, fresh);
  return { ok: true, paymentId: payment.id, status: 'verified' as PaymentState, alreadyProcessed: false };
}
