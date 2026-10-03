import type { Env } from '../env';
import type { CreatePaymentInput, CreatePaymentResult, PaymentProvider, VerifyPaymentInput, VerifyPaymentResult } from './provider';

/**
 * Myket in-app purchase (docs: «خرید درون‌برنامه‌ای مایکت», «API صحت‌سنجی خرید», «توصیه‌های امنیتی»).
 *
 * Facts from the Myket docs this design follows:
 *  - Myket has NO auto-renewing subscriptions ("مایکت از اشتراک پشتیبانی نمی‌کند"): every plan period is a CONSUMABLE product.
 *    One purchase = one period; the app consumes the purchase only after the server has delivered it, so it can be bought again.
 *  - The app returns `originalJson` + `signature`; the signature must be checked on the SERVER with the app's RSA public key.
 *  - The verify API (X-Access-Token) must be called server-to-server only.
 *  - developerPayload must be a unique value we issued, and must match on return. The purchase token is unique per purchase.
 */
export const MYKET_VERIFY_BASE = 'https://developer.myket.ir/api/partners/applications';
export const DEFAULT_MYKET_PACKAGE = 'com.yadbin.teacher';

export interface MyketPurchase { orderId: string | null; packageName: string; productId: string; purchaseTime: number | null; purchaseState: number; developerPayload: string; purchaseToken: string }

const b64 = (s: string): Uint8Array => { const bin = atob(s.replace(/\s+/g, '')); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };

/** SHA1withRSA over the exact originalJson string — the same check as Security.verifyPurchase in the Myket client library. */
export async function verifyMyketSignature(publicKeyB64: string, signedData: string, signatureB64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', b64(publicKeyB64), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(signatureB64), new TextEncoder().encode(signedData));
  } catch { return false; }
}

/** Tolerant reader for the purchase JSON returned by the Myket client (Google-IAB compatible field names). */
export function parseMyketPurchase(originalJson: string): MyketPurchase | null {
  let o: any;
  try { o = JSON.parse(originalJson); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const purchaseToken = str(o.purchaseToken) || str(o.token);
  const productId = str(o.productId);
  if (!purchaseToken || !productId) return null;
  return {
    orderId: str(o.orderId) || null, packageName: str(o.packageName), productId,
    purchaseTime: typeof o.purchaseTime === 'number' ? o.purchaseTime : null,
    purchaseState: typeof o.purchaseState === 'number' ? o.purchaseState : 0,
    developerPayload: str(o.developerPayload), purchaseToken,
  };
}

export class MyketPaymentProvider implements PaymentProvider {
  readonly id = 'myket';
  readonly kind = 'store' as const;

  constructor(readonly cfg: { publicKey: string; packageName: string; accessToken: string }, private fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  static fromEnv(env: Env, fetchFn?: typeof fetch): MyketPaymentProvider | null {
    const publicKey = (env.MYKET_PUBLIC_KEY || '').trim(), accessToken = (env.MYKET_ACCESS_TOKEN || '').trim();
    if (!publicKey || !accessToken) return null; // not configured yet → online payment stays "coming soon"
    return new MyketPaymentProvider({ publicKey, accessToken, packageName: (env.MYKET_PACKAGE_NAME || DEFAULT_MYKET_PACKAGE).trim() }, fetchFn);
  }

  /** The store collects the money; we only issue the one-time developerPayload (CSPRNG, 128 bits) the app must hand to Myket. */
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!input.sku) throw new Error('plan has no store_sku');
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return { authority: 'YB' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''), redirectUrl: null, sku: input.sku };
  }

  extractAuthority(params: Record<string, string>): string | null { return params.developerPayload ?? null; }

  /** Server-to-server check with Myket. Throws on network/5xx so the caller can keep the payment pending and let the app retry. */
  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const token = input.params.purchaseToken, sku = input.sku ?? input.params.productId;
    if (!token || !sku) return { ok: false, reason: 'invalid' };
    const url = `${MYKET_VERIFY_BASE}/${encodeURIComponent(this.cfg.packageName)}/purchases/products/${encodeURIComponent(sku)}/verify`;
    const res = await this.fetchFn(url, { method: 'POST', headers: { 'X-Access-Token': this.cfg.accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenId: token }) });
    if (res.status >= 500 || res.status === 429) throw new Error(`myket verify HTTP ${res.status}`);
    if (res.status === 401 || res.status === 403) throw new Error(`myket verify rejected our access token (HTTP ${res.status})`); // our misconfiguration, not the buyer's fault
    if (!res.ok) return { ok: false, reason: 'invalid' }; // unknown token / product
    let body: any;
    try { body = await res.json(); } catch { throw new Error('myket verify: unreadable response'); }
    if (body?.purchaseState !== 0) return { ok: false, reason: 'failed' };
    if (input.params.developerPayload !== undefined && typeof body.developerPayload === 'string' && body.developerPayload !== input.params.developerPayload) return { ok: false, reason: 'invalid' };
    return { ok: true, refId: token, amount: null };
  }
}
