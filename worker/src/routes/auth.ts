import { hashPassword, verifyPassword } from '../auth/password';
import { signJwt } from '../auth/jwt';
import type { Env } from '../env';
import { HttpError, json, readJson } from '../utils/http';
import { newId, nowIso } from '../utils/ids';
import { clearRateLimit, rateLimit, rateLimitIp } from '../utils/ratelimit';
import { requireSecret } from '../auth/middleware';
import { startTrialIfNeeded } from '../subscription/entitlements';
import { loginSchema, parse, registerSchema, resetPasswordSchema } from '../validation/schemas';

const teacherDto = (t: any) => ({ id: t.id, name: t.name, phone: t.phone });
// Pre-computed dummy so unknown phones cost the same time as wrong passwords (no user enumeration by timing).
// Unambiguous alphabet (no 0/O/1/I/L) so the code is easy to copy by hand.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normalizeRecoveryCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}
const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export async function register(req: Request, env: Env) {
  requireSecret(env);
  await rateLimitIp(env, req, 'register', 10, 3600);
  const { name, phone, password } = parse(registerSchema, await readJson(req));
  const exists = await env.DB.prepare('SELECT id FROM teachers WHERE phone = ?').bind(phone).first();
  if (exists) throw new HttpError(409, 'phone_taken', 'این شماره موبایل قبلاً ثبت‌نام کرده است.');
  const id = newId(), now = nowIso();
  const recoveryCode = newRecoveryCode();
  await env.DB.prepare('INSERT INTO teachers (id,name,phone,password_hash,recovery_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, name, phone, await hashPassword(password), await hashPassword(normalizeRecoveryCode(recoveryCode)), now, now).run();
  // The one-and-only Trial starts here, on the server clock. A failure must not break registration: it is retried on first access.
  try { await startTrialIfNeeded(env, id); } catch (e) { console.error('trial start failed', e instanceof Error ? e.message : String(e)); }
  return json({ token: await signJwt(id, env.JWT_SECRET), teacher: { id, name, phone }, recoveryCode }, 201);
}

export async function login(req: Request, env: Env) {
  requireSecret(env);
  await rateLimitIp(env, req, 'login', 30, 600);
  const { phone, password } = parse(loginSchema, await readJson(req));
  // Per-account brute-force guard (independent of IP): 8 attempts / 10 min.
  const phoneKey = `login:phone:${phone}`;
  await rateLimit(env, phoneKey, 8, 600);
  const t = await env.DB.prepare('SELECT * FROM teachers WHERE phone = ?').bind(phone).first<any>();
  const ok = await verifyPassword(password, t?.password_hash ?? DUMMY_HASH);
  if (!t || !ok) throw new HttpError(401, 'invalid_credentials', 'شماره موبایل یا رمز عبور اشتباه است.');
  await clearRateLimit(env, phoneKey);
  return json({ token: await signJwt(t.id, env.JWT_SECRET), teacher: teacherDto(t) });
}

/** Forgot password: phone + the recovery code shown at registration -> new password (code is rotated). */
export async function resetPassword(req: Request, env: Env) {
  requireSecret(env);
  await rateLimitIp(env, req, 'reset', 10, 3600);
  const { phone, recoveryCode, newPassword } = parse(resetPasswordSchema, await readJson(req));
  await rateLimit(env, `reset:phone:${phone}`, 5, 3600);
  const t = await env.DB.prepare('SELECT * FROM teachers WHERE phone = ?').bind(phone).first<any>();
  const ok = await verifyPassword(normalizeRecoveryCode(recoveryCode), t?.recovery_hash ?? DUMMY_HASH);
  if (!t || !t.recovery_hash || !ok) throw new HttpError(401, 'invalid_recovery', 'شماره موبایل یا کد بازیابی اشتباه است.');
  const next = newRecoveryCode();
  await env.DB.prepare('UPDATE teachers SET password_hash = ?, recovery_hash = ?, updated_at = ? WHERE id = ?')
    .bind(await hashPassword(newPassword), await hashPassword(normalizeRecoveryCode(next)), nowIso(), t.id).run();
  await clearRateLimit(env, `login:phone:${phone}`);
  await clearRateLimit(env, `reset:phone:${phone}`);
  return json({ token: await signJwt(t.id, env.JWT_SECRET), teacher: teacherDto(t), recoveryCode: next });
}
