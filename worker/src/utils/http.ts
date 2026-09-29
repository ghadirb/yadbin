import type { Env } from '../env';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: unknown) { super(message); }
}
export const notFound = (msg = 'یافت نشد.') => new HttpError(404, 'not_found', msg);
export const forbidden = (msg = 'دسترسی مجاز نیست.') => new HttpError(403, 'forbidden', msg);
export const unauthorized = (msg = 'ابتدا وارد شوید.') => new HttpError(401, 'unauthorized', msg);
export const badRequest = (msg: string, extra?: unknown) => new HttpError(400, 'bad_request', msg, extra);

export function corsHeaders(env: Env): Record<string, string> {
  // Production must set ALLOWED_ORIGIN explicitly; the wildcard fallback is for local dev only.
  const origin = env.ALLOWED_ORIGIN || (env.ENVIRONMENT === 'production' ? '' : '*');
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}
const MAX_BODY = 512 * 1024;
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'payload_too_large', 'حجم درخواست زیاد است.');
  try { return text ? JSON.parse(text) : {}; } catch { throw badRequest('بدنه درخواست معتبر نیست.'); }
}
