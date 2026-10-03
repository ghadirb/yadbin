import type { CreatePaymentInput, CreatePaymentResult, PaymentProvider, VerifyPaymentInput, VerifyPaymentResult } from './provider';

/**
 * Development/test gateway. Scenarios are driven by the callback parameters:
 *   status=OK                 -> success            status=NOK     -> failed
 *   status=INVALID            -> invalid transaction mock_amount=N  -> gateway reports a different amount
 * Because it trusts the callback parameters it must never run in production; getProvider() refuses to create it there.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly id = 'mock';
  readonly kind = 'redirect' as const;

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const authority = 'MOCK' + crypto.randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase();
    return { authority, redirectUrl: `${input.callbackUrl}?authority=${authority}&status=OK` };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const status = (input.params.status ?? input.params.Status ?? '').toUpperCase();
    if (status === 'OK') {
      const amount = input.params.mock_amount !== undefined ? Number(input.params.mock_amount) : input.expectedAmount;
      return { ok: true, refId: `MOCKREF-${input.authority}`, amount };
    }
    return { ok: false, reason: status === 'INVALID' ? 'invalid' : 'failed' };
  }

  extractAuthority(params: Record<string, string>): string | null {
    return params.authority ?? params.Authority ?? null;
  }
}
