import { z } from 'zod';
import type { Env } from '../env';
import { handleCallback, createPayment, paymentStatus, confirmStorePurchase } from '../payments/service';
import { paymentsAvailable } from '../payments/provider';
import { freeLimits, trialDays } from '../subscription/config';
import { getUserEntitlements } from '../subscription/entitlements';
import { usageSnapshot } from '../subscription/gating';
import { HttpError, json, readJson } from '../utils/http';
import { rateLimit, rateLimitIp } from '../utils/ratelimit';
import { parse } from '../validation/schemas';

const planDto = (p: any) => ({ id: p.id, name: p.name, period: p.period, durationDays: p.duration_days, price: p.price_amount ?? null, currency: p.currency, priceAvailable: p.price_amount != null });

/** GET /api/subscription — "my subscription": plan, status, dates, limits, usage. All values come from the server. */
export async function getSubscription(env: Env, teacherId: string) {
  await rateLimit(env, `sub:${teacherId}`, 60, 60);
  const ent = await getUserEntitlements(env, teacherId);
  return json({ subscription: ent, usage: await usageSnapshot(env, teacherId), paymentsAvailable: paymentsAvailable(env) });
}

/** GET /api/plans — public price list. A null price means "not decided yet". */
export async function listPlans(env: Env, req: Request) {
  await rateLimitIp(env, req, 'plans', 60, 600);
  const { results } = await env.DB.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY sort_order').all<any>();
  return json({ plans: results.map(planDto), free: freeLimits(env), trialDays: trialDays(env), paymentsAvailable: paymentsAvailable(env) });
}

// Only the plan id is accepted. Price, user and expiry are never read from the client.
const createSchema = z.object({ planId: z.string({ error: 'پلن الزامی است.' }).min(1).max(40) }).strict();

export async function postPaymentCreate(req: Request, env: Env, teacherId: string) {
  const { planId } = parse(createSchema, await readJson(req));
  return json(await createPayment(env, teacherId, planId), 201);
}

const confirmSchema = z.object({ originalJson: z.string().min(2).max(8192), signature: z.string().min(8).max(2048) }).strict();

/** POST /api/payment/myket/confirm — signed-in app posts the Myket purchase (originalJson + signature); see payments/service.ts. */
export async function postMyketConfirm(req: Request, env: Env, teacherId: string) {
  return json(await confirmStorePurchase(env, teacherId, parse(confirmSchema, await readJson(req))));
}

export async function getPaymentStatus(req: Request, env: Env, teacherId: string) {
  await rateLimit(env, `pay-status:${teacherId}`, 60, 60);
  const id = new URL(req.url).searchParams.get('paymentId') ?? '';
  if (!id || id.length > 64) throw new HttpError(400, 'bad_request', 'شناسه‌ی تراکنش لازم است.');
  return json(await paymentStatus(env, teacherId, id));
}

async function callbackParams(req: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URL(req.url).searchParams) out[k] = v;
  if (req.method === 'POST') {
    const text = await req.text();
    if (text.length > 64 * 1024) throw new HttpError(413, 'payload_too_large', 'حجم درخواست زیاد است.');
    const type = req.headers.get('Content-Type') ?? '';
    if (type.includes('application/x-www-form-urlencoded')) for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    else if (text) {
      try { const o = JSON.parse(text); if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (typeof v === 'string' || typeof v === 'number') out[k] = String(v); } catch { throw new HttpError(400, 'bad_request', 'بدنه درخواست معتبر نیست.'); }
    }
  }
  return out;
}

/**
 * /api/payment/callback — called by the gateway / the browser coming back from it. Unauthenticated BY DESIGN, so it grants
 * nothing by itself: the service re-verifies with the gateway and checks our stored amount before anything is activated.
 */
export async function paymentCallback(req: Request, env: Env) {
  await rateLimitIp(env, req, 'pay-callback', 60, 600);
  const outcome = await handleCallback(env, await callbackParams(req));
  if (req.method === 'GET') {
    const ok = outcome.status === 'verified';
    const text = ok ? 'پرداخت با موفقیت ثبت شد. به برنامه‌ی یادبین برگردید.' : 'پرداخت تکمیل نشد. به برنامه‌ی یادبین برگردید و دوباره تلاش کنید.';
    return new Response(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>یادبین</title><body><p>${text}</p></body></html>`, {
      status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return json(outcome);
}
