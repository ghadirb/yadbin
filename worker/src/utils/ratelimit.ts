import type { Env } from '../env';
import { HttpError } from './http';

/** Client IP as set by Cloudflare. Absent only in local/test runs. */
export const clientIp = (req: Request): string | null => req.headers.get('CF-Connecting-IP');

/**
 * Fixed-window counter stored in D1 (atomic single-statement upsert).
 * Throws HTTP 429 with `Retry-After` once `limit` hits inside `windowSec` are exceeded.
 */
export async function rateLimit(env: Env, key: string, limit: number, windowSec: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
     RETURNING count, window_start`,
  ).bind(key, now, now - windowSec).first<{ count: number; window_start: number }>();
  if (row && row.count > limit) {
    const retryAfter = Math.max(1, row.window_start + windowSec - now);
    throw new HttpError(429, 'rate_limited', 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.', { retryAfter });
  }
  // Opportunistic cleanup of stale windows (~1% of calls).
  if (Math.random() < 0.01) {
    await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - 2 * 86400).run();
  }
}

/** IP-based limit; skipped when no client IP is available (local dev/tests). */
export async function rateLimitIp(env: Env, req: Request, scope: string, limit: number, windowSec: number): Promise<void> {
  const ip = clientIp(req);
  if (ip) await rateLimit(env, `${scope}:ip:${ip}`, limit, windowSec);
}

export async function clearRateLimit(env: Env, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}
