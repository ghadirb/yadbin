import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEnv, registerTeacher, type TestEnv } from './helpers';
import { confirmStorePurchase } from '../src/payments/service';
import { MyketPaymentProvider } from '../src/payments/myket';
import { getProvider } from '../src/payments/provider';
import { startTrialIfNeeded } from '../src/subscription/entitlements';

const past = () => new Date(Date.now() - 86400_000).toISOString();
const DAY = 86400_000;

let t: TestEnv; // plain env: no payment provider configured
let m: TestEnv; // mock provider enabled (non-production)
beforeAll(async () => {
  t = await createEnv();
  m = await createEnv({ PAYMENT_PROVIDER: 'mock', PAYMENT_MOCK_ENABLED: 'true' });
  await m.db.prepare("UPDATE plans SET price_amount = 500000 WHERE id = 'pro_monthly'").run(); // only the Mock env has a (test) price
}, 90_000); // two Worker+D1 environments: the default 10 s hook limit is too tight when the whole suite runs in parallel
afterAll(async () => { await t?.dispose(); await m?.dispose(); });

async function expireTrial(e: TestEnv, id: string) { await e.db.prepare('UPDATE teachers SET trial_expires_at = ? WHERE id = ?').bind(past(), id).run(); }
const sub = async (e: TestEnv, token: string) => (await e.api('GET', '/api/subscription', undefined, token)).data.subscription;
const mkClass = (e: TestEnv, token: string, name = 'کلاس') => e.api('POST', '/api/classes', { name, grade: 'پایه سوم', gradeCode: 'g3' }, token);

describe('Trial (server-side, once per account)', () => {
  it('a new account gets a 7-day Trial with full access', async () => {
    const a = await registerTeacher(t);
    const s = await sub(t, a.token);
    expect(s.plan).toBe('TRIAL'); expect(s.status).toBe('TRIAL'); expect(s.trialActive).toBe(true);
    const days = (Date.parse(s.trialExpiresAt) - Date.parse(s.trialStartedAt)) / DAY;
    expect(days).toBeCloseTo(7, 5);
    expect(s.limits.maxClasses).toBeNull();
  });
  it('login again keeps the SAME trial; a second start is a no-op (local data / reinstall cannot reset it)', async () => {
    const a = await registerTeacher(t);
    const first = (await sub(t, a.token)).trialExpiresAt;
    const login = await t.api('POST', '/api/auth/login', { phone: a.phone, password: 'pass12345' });
    expect((await sub(t, login.data.token)).trialExpiresAt).toBe(first);
    expect(await startTrialIfNeeded({ DB: t.db } as any, a.id)).toBe(false);
  });
  it('there is no client endpoint that can start/extend a trial or set a plan', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    for (const [method, path] of [['POST', '/api/subscription'], ['PUT', '/api/subscription'], ['POST', '/api/subscription/trial'], ['POST', '/api/trial']] as const) {
      const r = await t.api(method, path, { plan: 'PRO', expiresAt: '2099-01-01T00:00:00Z', trialExpiresAt: '2099-01-01T00:00:00Z' }, a.token);
      expect([404, 405]).toContain(r.status);
    }
    expect((await sub(t, a.token)).plan).toBe('FREE');
  });
  it('a pre-subscription account gets its single Trial on first access', async () => {
    const a = await registerTeacher(t);
    await t.db.prepare('UPDATE teachers SET trial_used = 0, trial_started_at = NULL, trial_expires_at = NULL WHERE id = ?').bind(a.id).run();
    expect((await sub(t, a.token)).plan).toBe('TRIAL');
  });
  it('trial end -> FREE/EXPIRED, based on the server clock', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    const s = await sub(t, a.token);
    expect(s.plan).toBe('FREE'); expect(s.status).toBe('EXPIRED'); expect(s.trialActive).toBe(false);
    expect(s.limits.maxClasses).toBe(1); expect(s.limits.maxStudents).toBe(10);
  });
});

describe('Free limits are enforced by the Worker', () => {
  it('classes: first allowed, second FEATURE_LIMIT_REACHED; existing data stays readable', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    expect((await mkClass(t, a.token)).status).toBe(201);
    const second = await mkClass(t, a.token, 'دوم');
    expect(second.status).toBe(403); expect(second.data.error).toBe('FEATURE_LIMIT_REACHED');
    expect(second.data.details).toMatchObject({ feature: 'classes', limit: 1, current: 1, upgrade: true });
    expect((await t.api('GET', '/api/classes', undefined, a.token)).data.classes).toHaveLength(1);
  });
  it('archive + create + unarchive cannot be used to get around the class cap', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    const c1 = (await mkClass(t, a.token)).data.class.id;
    await t.api('POST', `/api/classes/${c1}/archive`, undefined, a.token);
    expect((await mkClass(t, a.token, 'دوم')).status).toBe(201);
    const back = await t.api('POST', `/api/classes/${c1}/unarchive`, undefined, a.token);
    expect(back.status).toBe(403); expect(back.data.error).toBe('FEATURE_LIMIT_REACHED');
  });
  it('students: up to 10 allowed, the 11th (single or bulk) is refused', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    const cid = (await mkClass(t, a.token)).data.class.id;
    const names = Array.from({ length: 10 }, (_, i) => `دانش‌آموز ${i + 1}`);
    expect((await t.api('POST', `/api/classes/${cid}/students`, { names }, a.token)).status).toBe(201);
    const more = await t.api('POST', `/api/classes/${cid}/students`, { name: 'یازدهم' }, a.token);
    expect(more.status).toBe(403); expect(more.data.details).toMatchObject({ feature: 'students', limit: 10, current: 10 });
    expect((await t.api('POST', '/api/students', { name: 'یازدهم', classId: cid }, a.token)).data.error).toBe('FEATURE_LIMIT_REACHED');
  });
  it('a bulk add that would pass the cap is refused as a whole (nothing is half-added)', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    const cid = (await mkClass(t, a.token)).data.class.id;
    await t.api('POST', `/api/classes/${cid}/students`, { names: Array.from({ length: 8 }, (_, i) => `نام ${i + 1}`) }, a.token);
    const r = await t.api('POST', `/api/classes/${cid}/students`, { names: ['الف الف', 'ب ب', 'ج ج'] }, a.token);
    expect(r.status).toBe(403);
    expect((await t.api('GET', `/api/classes/${cid}`, undefined, a.token)).data.students).toHaveLength(8);
  });
  it('assessments: 3 allowed, 4th refused (create + duplicate), archived ones free a slot', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) { const r = await t.api('POST', '/api/assessments', { title: `آزمون ${i + 1}` }, a.token); expect(r.status).toBe(201); ids.push(r.data.assessment.id); }
    const fourth = await t.api('POST', '/api/assessments', { title: 'چهارم' }, a.token);
    expect(fourth.status).toBe(403); expect(fourth.data.details.feature).toBe('assessments');
    expect((await t.api('POST', `/api/assessments/${ids[0]}/duplicate`, undefined, a.token)).status).toBe(403);
    await t.api('POST', `/api/assessments/${ids[0]}/archive`, undefined, a.token);
    expect((await t.api('POST', '/api/assessments', { title: 'جایگزین' }, a.token)).status).toBe(201);
    expect((await t.api('POST', `/api/assessments/${ids[0]}/unarchive`, undefined, a.token)).status).toBe(403);
  });
  it('AI assessment generator is refused for a Free user whose monthly AI quota is spent', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    const period = new Date().toISOString().slice(0, 7);
    await t.db.prepare("INSERT INTO usage_counters (teacher_id, feature, period, count) VALUES (?, 'ai', ?, 3)").bind(a.id, period).run();
    const r = await t.api('POST', '/api/ai/assessment-draft', { prompt: 'ریاضی پایه سوم', questionCount: 3 }, a.token);
    expect(r.status).toBe(403); expect(r.data.error).toBe('FEATURE_LIMIT_REACHED'); expect(r.data.details.feature).toBe('ai');
  });
  it('AI activity builder keeps answering from the rule engine when the Free AI quota is spent', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    const period = new Date().toISOString().slice(0, 7);
    await t.db.prepare("INSERT INTO usage_counters (teacher_id, feature, period, count) VALUES (?, 'ai', ?, 3)").bind(a.id, period).run();
    const r = await t.api('POST', '/api/ai/activity-draft', { prompt: 'یک تمرین حافظه برای کلاس' }, a.token);
    expect(r.status).toBe(200); expect(r.data.source).toBe('rules'); expect(r.data.aiLimitReached).toBe(true);
  });
  it('Trial and Pro have no limits', async () => {
    const a = await registerTeacher(t);
    for (let i = 0; i < 3; i++) expect((await mkClass(t, a.token, `ک${i}`)).status).toBe(201);
  });
});

describe('payments are unavailable until a provider is configured', () => {
  it('create -> 503 payments_unavailable with the "coming soon" message; plans show null prices', async () => {
    const a = await registerTeacher(t);
    const r = await t.api('POST', '/api/payment/create', { planId: 'pro_monthly' }, a.token);
    expect(r.status).toBe(503); expect(r.data.error).toBe('payments_unavailable'); expect(r.data.message).toContain('به‌زودی');
    const plans = await t.api('GET', '/api/plans');
    expect(plans.data.paymentsAvailable).toBe(false);
    expect(plans.data.plans.map((p: any) => p.price)).toEqual([null, null]);
    expect(plans.data.free.maxClasses).toBe(1); expect(plans.data.trialDays).toBe(7);
  });
  it('the Mock provider can never be created in production', () => {
    const base = { PAYMENT_PROVIDER: 'mock', PAYMENT_MOCK_ENABLED: 'true' } as any;
    expect(getProvider({ ...base, ENVIRONMENT: 'production' })).toBeNull();
    expect(getProvider({ ...base, ENVIRONMENT: 'development' })?.id).toBe('mock');
    expect(getProvider({ PAYMENT_PROVIDER: 'mock', ENVIRONMENT: 'development' } as any)).toBeNull(); // needs the explicit flag too
  });
});

describe('Payment flow (redirect gateway, via the Mock provider)', () => {
  async function start(token: string, planId = 'pro_monthly') { return m.api('POST', '/api/payment/create', { planId }, token); }
  const cb = (q: string) => m.api('POST', `/api/payment/callback?${q}`);

  it('success: create -> callback -> verify -> subscription ACTIVE; price comes from the plan, not the client', async () => {
    const a = await registerTeacher(m); await expireTrial(m, a.id);
    const c = await m.api('POST', '/api/payment/create', { planId: 'pro_monthly', amount: 1, price: 1 }, a.token);
    expect(c.status).toBe(400); // strict body: a client-supplied price is rejected, not ignored
    const ok = await start(a.token); expect(ok.status).toBe(201);
    expect(ok.data.status).toBe('pending');
    const row = await m.db.prepare('SELECT amount FROM payments WHERE id = ?').bind(ok.data.paymentId).first<any>();
    expect(row.amount).toBe(500000);
    expect((await sub(m, a.token)).plan).toBe('FREE'); // creating a payment grants nothing
    const authority = new URL(ok.data.redirectUrl).searchParams.get('authority')!;
    const r = await cb(`authority=${authority}&status=OK`);
    expect(r.data.status).toBe('verified');
    const s = await sub(m, a.token);
    expect(s.plan).toBe('PRO'); expect(s.status).toBe('ACTIVE'); expect(s.limits.maxClasses).toBeNull();
    expect((Date.parse(s.expiresAt) - Date.now()) / DAY).toBeCloseTo(30, 1);
    expect((await m.api('GET', `/api/payment/status?paymentId=${ok.data.paymentId}`, undefined, a.token)).data.status).toBe('verified');
  });
  it('duplicate callback: no second period, no second row', async () => {
    const a = await registerTeacher(m);
    const c = await start(a.token); const authority = new URL(c.data.redirectUrl).searchParams.get('authority')!;
    await cb(`authority=${authority}&status=OK`);
    const exp1 = (await sub(m, a.token)).expiresAt;
    const again = await cb(`authority=${authority}&status=OK`);
    expect(again.data.alreadyProcessed).toBe(true);
    expect((await sub(m, a.token)).expiresAt).toBe(exp1);
    const n = await m.db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE teacher_id = ?').bind(a.id).first<any>();
    expect(n.n).toBe(1);
  });
  it('parallel callbacks credit exactly once', async () => {
    const a = await registerTeacher(m);
    const c = await start(a.token); const authority = new URL(c.data.redirectUrl).searchParams.get('authority')!;
    await Promise.all(Array.from({ length: 5 }, () => cb(`authority=${authority}&status=OK`)));
    const n = await m.db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE teacher_id = ?').bind(a.id).first<any>();
    expect(n.n).toBe(1);
  });
  it('failed payment and gateway "invalid" never activate anything, and are final', async () => {
    const a = await registerTeacher(m); await expireTrial(m, a.id);
    for (const status of ['NOK', 'INVALID']) {
      const c = await start(a.token); const authority = new URL(c.data.redirectUrl).searchParams.get('authority')!;
      expect((await cb(`authority=${authority}&status=${status}`)).data.status).toBe('failed');
      expect((await cb(`authority=${authority}&status=OK`)).data.status).toBe('failed'); // cannot be "resurrected"
    }
    expect((await sub(m, a.token)).plan).toBe('FREE');
  });
  it('wrong amount reported by the gateway -> failed, nothing activated', async () => {
    const a = await registerTeacher(m); await expireTrial(m, a.id);
    const c = await start(a.token); const authority = new URL(c.data.redirectUrl).searchParams.get('authority')!;
    expect((await cb(`authority=${authority}&status=OK&mock_amount=1000`)).data.status).toBe('failed');
    expect((await sub(m, a.token)).plan).toBe('FREE');
  });
  it('expired transaction -> expired, nothing activated', async () => {
    const a = await registerTeacher(m); await expireTrial(m, a.id);
    const c = await start(a.token); const authority = new URL(c.data.redirectUrl).searchParams.get('authority')!;
    await m.db.prepare('UPDATE payments SET expires_at = ? WHERE id = ?').bind(past(), c.data.paymentId).run();
    expect((await cb(`authority=${authority}&status=OK`)).data.status).toBe('expired');
    expect((await sub(m, a.token)).plan).toBe('FREE');
  });
  it('unknown / missing transaction id is rejected', async () => {
    expect((await cb('authority=NOPE&status=OK')).status).toBe(404);
    expect((await cb('status=OK')).status).toBe(400);
  });
  it('renewal stacks on the current expiry; after expiry a new period starts now', async () => {
    const a = await registerTeacher(m);
    const buy = async () => { const c = await start(a.token); await cb(`authority=${new URL(c.data.redirectUrl).searchParams.get('authority')}&status=OK`); };
    await buy(); const e1 = Date.parse((await sub(m, a.token)).expiresAt);
    await buy(); const e2 = Date.parse((await sub(m, a.token)).expiresAt);
    expect((e2 - e1) / DAY).toBeCloseTo(30, 3);
    await m.db.prepare('UPDATE subscriptions SET expires_at = ? WHERE teacher_id = ?').bind(past(), a.id).run();
    await expireTrial(m, a.id);
    const s = await sub(m, a.token); expect(s.plan).toBe('FREE'); expect(s.status).toBe('EXPIRED'); // Pro expiry -> back to Free
    await buy();
    expect((Date.parse((await sub(m, a.token)).expiresAt) - Date.now()) / DAY).toBeCloseTo(30, 1);
  });
  it('the yearly plan lasts 365 days', async () => {
    await m.db.prepare("UPDATE plans SET price_amount = 4000000 WHERE id = 'pro_yearly'").run();
    const a = await registerTeacher(m);
    const c = await start(a.token, 'pro_yearly'); await cb(`authority=${new URL(c.data.redirectUrl).searchParams.get('authority')}&status=OK`);
    expect((Date.parse((await sub(m, a.token)).expiresAt) - Date.now()) / DAY).toBeCloseTo(365, 1);
  });
  it('a plan without a decided price cannot be bought', async () => {
    const a = await registerTeacher(m);
    await m.db.prepare("INSERT INTO plans (id,name,period,duration_days,price_amount,currency,active,sort_order) VALUES ('pro_x','x','monthly',30,NULL,'IRR',1,9)").run();
    expect((await start(a.token, 'pro_x')).status).toBe(503);
    expect((await start(a.token, 'nope')).status).toBe(404);
  });
});

describe('Security: subscriptions are private and server-controlled', () => {
  it('user B cannot read or use user A\'s payment', async () => {
    const a = await registerTeacher(m), b = await registerTeacher(m);
    const c = await m.api('POST', '/api/payment/create', { planId: 'pro_monthly' }, a.token);
    expect((await m.api('GET', `/api/payment/status?paymentId=${c.data.paymentId}`, undefined, b.token)).status).toBe(404);
  });
  it('endpoints require sign-in; each user sees only their own subscription', async () => {
    expect((await t.api('GET', '/api/subscription')).status).toBe(401);
    expect((await t.api('POST', '/api/payment/create', { planId: 'pro_monthly' })).status).toBe(401);
    const a = await registerTeacher(t), b = await registerTeacher(t); await expireTrial(t, a.id);
    expect((await sub(t, a.token)).plan).toBe('FREE'); expect((await sub(t, b.token)).plan).toBe('TRIAL');
  });
  it('the gateway callback alone never activates Pro for someone who did not pay', async () => {
    const a = await registerTeacher(m); await expireTrial(m, a.id);
    const c = await m.api('POST', '/api/payment/create', { planId: 'pro_monthly' }, a.token);
    const authority = new URL(c.data.redirectUrl).searchParams.get('authority')!;
    expect((await m.api('POST', `/api/payment/callback?authority=${authority}&status=NOK`)).data.status).toBe('failed');
    expect((await sub(m, a.token)).plan).toBe('FREE');
  });
});

// ---------- Myket (store) flow: real RSA signatures, mocked Myket verify API ----------
const PKG = 'com.yadbin.teacher', SKU = 'yadbin_pro_monthly';
const b64 = (buf: ArrayBuffer) => Buffer.from(buf).toString('base64');
async function keyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' }, true, ['sign', 'verify']);
  return { publicKey: b64(await crypto.subtle.exportKey('spki', kp.publicKey)), sign: async (s: string) => b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(s))) };
}

describe('Myket in-app purchase (consumable product = one period)', () => {
  let keys: Awaited<ReturnType<typeof keyPair>>; let env: any; let myketCalls: any[]; let myketReply: () => Response;
  const provider = () => new MyketPaymentProvider({ publicKey: keys.publicKey, packageName: PKG, accessToken: 'tok-secret' }, (async (url: any, init: any) => { myketCalls.push({ url: String(url), init }); return myketReply(); }) as any);
  const ok200 = (payload: string) => () => new Response(JSON.stringify({ kind: 'androidpublisher#productPurchase', purchaseState: 0, consumptionState: 0, developerPayload: payload }), { status: 200 });
  const reset = () => { myketCalls = []; };

  beforeAll(async () => {
    keys = await keyPair();
    await t.db.prepare("UPDATE plans SET store_sku = ? WHERE id = 'pro_monthly'").bind(SKU).run();
    await t.db.prepare("UPDATE plans SET store_sku = NULL WHERE id = 'pro_yearly'").run(); // migration 0013 seeds both SKUs; this suite needs one plan without a product
    env = { DB: t.db, ENVIRONMENT: 'production', PAYMENT_PROVIDER: 'myket', MYKET_PUBLIC_KEY: keys.publicKey, MYKET_ACCESS_TOKEN: 'tok-secret', MYKET_PACKAGE_NAME: PKG, PLAY_BASE_URL: 'https://x.example' };
  });

  async function begin(teacher: { token: string; id: string }) {
    const c = await (await import('../src/payments/service')).createPayment(env, teacher.id, 'pro_monthly');
    return c;
  }
  async function purchase(c: any, o: Partial<{ productId: string; packageName: string; purchaseState: number; token: string; payload: string; badSig: boolean; tamper: boolean }> = {}) {
    const json = JSON.stringify({ orderId: 'MK-' + Math.random(), packageName: o.packageName ?? PKG, productId: o.productId ?? c.sku, purchaseTime: Date.now(), purchaseState: o.purchaseState ?? 0, developerPayload: o.payload ?? c.developerPayload, purchaseToken: o.token ?? 'TOKEN-' + crypto.randomUUID() });
    const signature = o.badSig ? b64(new Uint8Array(256).buffer) : await keys.sign(json);
    return { originalJson: o.tamper ? json.replace('"purchaseState":0', '"purchaseState":0 ') : json, signature };
  }
  const confirm = (teacherId: string, body: any) => confirmStorePurchase(env, teacherId, body, provider());

  it('is "coming soon" until key + access token are configured', async () => {
    expect(getProvider({ PAYMENT_PROVIDER: 'myket', ENVIRONMENT: 'production' } as any)).toBeNull();
    expect(getProvider({ PAYMENT_PROVIDER: 'myket', MYKET_PUBLIC_KEY: 'k' } as any)).toBeNull();
    expect(getProvider({ PAYMENT_PROVIDER: 'myket', MYKET_PUBLIC_KEY: 'k', MYKET_ACCESS_TOKEN: 't' } as any)?.id).toBe('myket');
  });
  it('create returns the SKU and a one-time developerPayload; no price is stored or needed; a plan without store_sku is unavailable', async () => {
    const a = await registerTeacher(t);
    const c = await begin(a);
    expect(c.kind).toBe('store'); expect(c.sku).toBe(SKU); expect(c.developerPayload).toMatch(/^YB[0-9a-f]{32}$/); expect(c.redirectUrl).toBeNull();
    const row = await t.db.prepare('SELECT amount, provider FROM payments WHERE id = ?').bind(c.paymentId).first<any>();
    expect(row.amount).toBeNull(); expect(row.provider).toBe('myket');
    await expect((await import('../src/payments/service')).createPayment(env, a.id, 'pro_yearly')).rejects.toMatchObject({ code: 'payments_unavailable' });
  });
  it('success: verifies signature + Myket API (server-to-server, token in header) and activates 30 days', async () => {
    reset(); const a = await registerTeacher(t); await expireTrial(t, a.id);
    const c = await begin(a); myketReply = ok200(c.developerPayload!);
    const p = await purchase(c);
    const r = await confirm(a.id, p);
    expect(r).toMatchObject({ ok: true, status: 'verified', alreadyProcessed: false });
    expect(myketCalls).toHaveLength(1);
    expect(myketCalls[0].url).toBe(`https://developer.myket.ir/api/partners/applications/${PKG}/purchases/products/${SKU}/verify`);
    expect(myketCalls[0].init.headers['X-Access-Token']).toBe('tok-secret');
    expect(JSON.parse(myketCalls[0].init.body).tokenId).toBe(JSON.parse(p.originalJson).purchaseToken);
    const s = await sub(t, a.token);
    expect(s.plan).toBe('PRO'); expect((Date.parse(s.expiresAt) - Date.now()) / DAY).toBeCloseTo(30, 1);
  });
  it('the app retrying the same purchase (unconsumed purchase at start-up) is idempotent', async () => {
    reset(); const a = await registerTeacher(t);
    const c = await begin(a); myketReply = ok200(c.developerPayload!);
    const p = await purchase(c);
    await confirm(a.id, p); const e1 = (await sub(t, a.token)).expiresAt;
    const again = await confirm(a.id, p);
    expect(again).toMatchObject({ ok: true, alreadyProcessed: true });
    expect((await sub(t, a.token)).expiresAt).toBe(e1);
    expect(myketCalls).toHaveLength(1); // no second call to Myket needed
    const parallel = await registerTeacher(t); const c2 = await begin(parallel); myketReply = ok200(c2.developerPayload!);
    const p2 = await purchase(c2);
    await Promise.all(Array.from({ length: 4 }, () => confirm(parallel.id, p2)));
    expect((await t.db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE teacher_id = ?').bind(parallel.id).first<any>()).n).toBe(1);
  });
  it('forged / tampered / wrongly-signed purchases are rejected before Myket is even called', async () => {
    reset(); const a = await registerTeacher(t); await expireTrial(t, a.id);
    const c = await begin(a); myketReply = ok200(c.developerPayload!);
    await expect(confirm(a.id, await purchase(c, { badSig: true }))).rejects.toMatchObject({ code: 'invalid_signature' });
    await expect(confirm(a.id, await purchase(c, { tamper: true }))).rejects.toMatchObject({ code: 'invalid_signature' });
    const other = await keyPair(); const j = JSON.stringify({ packageName: PKG, productId: SKU, purchaseState: 0, developerPayload: c.developerPayload, purchaseToken: 'T' });
    await expect(confirm(a.id, { originalJson: j, signature: await other.sign(j) })).rejects.toMatchObject({ code: 'invalid_signature' });
    expect(myketCalls).toHaveLength(0);
    expect((await sub(t, a.token)).plan).toBe('FREE');
  });
  it('wrong package, wrong product, unfinished purchase are rejected', async () => {
    reset(); const a = await registerTeacher(t); await expireTrial(t, a.id);
    const c = await begin(a); myketReply = ok200(c.developerPayload!);
    await expect(confirm(a.id, await purchase(c, { packageName: 'com.evil.app' }))).rejects.toMatchObject({ code: 'invalid_transaction' });
    await expect(confirm(a.id, await purchase(c, { productId: 'some_other_sku' }))).rejects.toMatchObject({ code: 'invalid_transaction' });
    await expect(confirm(a.id, await purchase(c, { purchaseState: 1 }))).rejects.toMatchObject({ code: 'purchase_not_completed' });
    expect((await sub(t, a.token)).plan).toBe('FREE');
  });
  it('a developerPayload issued to another account (or unknown) cannot be redeemed', async () => {
    reset(); const a = await registerTeacher(t), b = await registerTeacher(t); await expireTrial(t, b.id);
    const c = await begin(a); myketReply = ok200(c.developerPayload!);
    await expect(confirm(b.id, await purchase(c))).rejects.toMatchObject({ code: 'invalid_transaction' });
    await expect(confirm(a.id, await purchase(c, { payload: 'YBdeadbeef' }))).rejects.toMatchObject({ code: 'invalid_transaction' });
    expect((await sub(t, b.token)).plan).toBe('FREE');
  });
  it('Myket says the token is not a successful purchase -> nothing activated, payment closed', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    const c = await begin(a);
    myketReply = () => new Response(JSON.stringify({ purchaseState: 1, developerPayload: c.developerPayload }), { status: 200 });
    await expect(confirm(a.id, await purchase(c))).rejects.toMatchObject({ code: 'purchase_not_verified' });
    expect((await sub(t, a.token)).plan).toBe('FREE');
    expect((await t.api('GET', `/api/payment/status?paymentId=${c.paymentId}`, undefined, a.token)).data.status).toBe('failed');
  });
  it('Myket answers with a different developerPayload -> rejected', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    const c = await begin(a); myketReply = ok200('SOMETHING-ELSE');
    await expect(confirm(a.id, await purchase(c))).rejects.toMatchObject({ code: 'purchase_not_verified' });
    expect((await sub(t, a.token)).plan).toBe('FREE');
  });
  it('Myket outage keeps the payment pending so the already-paid purchase can be delivered on retry', async () => {
    const a = await registerTeacher(t); await expireTrial(t, a.id);
    const c = await begin(a); const p = await purchase(c);
    myketReply = () => new Response('oops', { status: 500 });
    await expect(confirm(a.id, p)).rejects.toMatchObject({ code: 'payment_verify_unavailable', status: 502 });
    expect((await sub(t, a.token)).plan).toBe('FREE');
    // 40 minutes later (past our 30-min window) Myket is back: the buyer already paid, so it must still be delivered
    await t.db.prepare('UPDATE payments SET expires_at = ? WHERE id = ?').bind(past(), c.paymentId).run();
    myketReply = ok200(c.developerPayload!);
    expect(await confirm(a.id, p)).toMatchObject({ ok: true });
    expect((await sub(t, a.token)).plan).toBe('PRO');
  });
  it('the same Myket purchase token can never be credited twice (even through another payment row)', async () => {
    const a = await registerTeacher(t); const b = await registerTeacher(t);
    const ca = await begin(a), cb2 = await begin(b); myketReply = ok200(ca.developerPayload!);
    const pa = await purchase(ca, { token: 'SHARED-TOKEN' });
    await confirm(a.id, pa);
    myketReply = ok200(cb2.developerPayload!);
    await expect(confirm(b.id, await purchase(cb2, { token: 'SHARED-TOKEN' }))).rejects.toMatchObject({ code: 'duplicate_transaction' });
    expect((await sub(t, b.token)).plan).not.toBe('PRO');
  });
  it('renewal with an active Pro stacks 30 more days', async () => {
    const a = await registerTeacher(t);
    const buy = async () => { const c = await begin(a); myketReply = ok200(c.developerPayload!); await confirm(a.id, await purchase(c)); };
    await buy(); const e1 = Date.parse((await sub(t, a.token)).expiresAt);
    await buy(); expect((Date.parse((await sub(t, a.token)).expiresAt) - e1) / DAY).toBeCloseTo(30, 3);
  });
  it('without configuration the confirm endpoint answers "coming soon" and the Access Token never appears in responses', async () => {
    const a = await registerTeacher(t);
    const r = await t.api('POST', '/api/payment/myket/confirm', { originalJson: '{"a":1}', signature: 'AAAAAAAAAA' }, a.token);
    expect(r.status).toBe(503); expect(JSON.stringify(r.data)).not.toContain('tok-secret');
    expect((await t.api('POST', '/api/payment/myket/confirm', { originalJson: '{}', signature: 'x', userId: 'other' }, a.token)).status).toBe(400);
  });
});
