import type { Env } from '../env';
import { MockPaymentProvider } from './mock';
import { MyketPaymentProvider } from './myket';

/**
 * Gateway abstraction. The subscription logic and the UI only ever talk to this interface, so a real Iranian gateway
 * can be added later as one more class + one registry line, without touching Subscription code or the app.
 */
export interface CreatePaymentInput { paymentId: string; amount: number | null; currency: string | null; description: string; callbackUrl: string; sku: string | null }
/** redirect gateways return a redirectUrl; store providers (Myket) return the `developerPayload` + `sku` the app must pass to the store's purchase flow. */
export interface CreatePaymentResult { authority: string; redirectUrl: string | null; sku?: string }
export interface VerifyPaymentInput { authority: string; expectedAmount: number | null; params: Record<string, string>; sku?: string | null }
export type VerifyPaymentResult =
  | { ok: true; refId: string; amount: number | null }
  | { ok: false; reason: 'failed' | 'invalid' };

export interface PaymentProvider {
  readonly id: string;
  /** 'redirect': browser goes to the gateway and comes back to /api/payment/callback. 'store': the app buys through the store and posts the signed purchase to /api/payment/myket/confirm. */
  readonly kind: 'redirect' | 'store';
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Must ask the GATEWAY (server-to-server). The callback parameters alone are never proof of payment. Throws on transient gateway errors. */
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
  /** Pull this gateway's transaction identifier out of the callback parameters. */
  extractAuthority(params: Record<string, string>): string | null;
}

/**
 * Provider registry. No real gateway is registered in this version (the choice is deliberately open).
 * The Mock provider exists for development/tests only and can NEVER be created in production.
 */
export function getProvider(env: Env, id: string | undefined = env.PAYMENT_PROVIDER): PaymentProvider | null {
  const wanted = (id || '').trim().toLowerCase();
  if (!wanted || wanted === 'none') return null;
  if (wanted === 'myket') return MyketPaymentProvider.fromEnv(env); // null until key, package and access token are all configured
  if (wanted === 'mock') {
    if (env.ENVIRONMENT === 'production' || env.PAYMENT_MOCK_ENABLED !== 'true') return null;
    return new MockPaymentProvider();
  }
  return null; // unknown / not-yet-integrated gateway
}

export const paymentsAvailable = (env: Env): boolean => getProvider(env) !== null;
