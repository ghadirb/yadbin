import { hashPassword, verifyPassword } from '../auth/password';
import { signJwt } from '../auth/jwt';
import type { Env } from '../env';
import { HttpError, json, readJson } from '../utils/http';
import { newId, nowIso } from '../utils/ids';
import { loginSchema, parse, registerSchema } from '../validation/schemas';

const teacherDto = (t: any) => ({ id: t.id, name: t.name, phone: t.phone });
// Pre-computed dummy so unknown phones cost the same time as wrong passwords (no user enumeration by timing).
const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export async function register(req: Request, env: Env) {
  const { name, phone, password } = parse(registerSchema, await readJson(req));
  const exists = await env.DB.prepare('SELECT id FROM teachers WHERE phone = ?').bind(phone).first();
  if (exists) throw new HttpError(409, 'phone_taken', 'این شماره موبایل قبلاً ثبت‌نام کرده است.');
  const id = newId(), now = nowIso();
  await env.DB.prepare('INSERT INTO teachers (id,name,phone,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind(id, name, phone, await hashPassword(password), now, now).run();
  return json({ token: await signJwt(id, env.JWT_SECRET), teacher: { id, name, phone } }, 201);
}

export async function login(req: Request, env: Env) {
  const { phone, password } = parse(loginSchema, await readJson(req));
  const t = await env.DB.prepare('SELECT * FROM teachers WHERE phone = ?').bind(phone).first<any>();
  const ok = await verifyPassword(password, t?.password_hash ?? DUMMY_HASH);
  if (!t || !ok) throw new HttpError(401, 'invalid_credentials', 'شماره موبایل یا رمز عبور اشتباه است.');
  return json({ token: await signJwt(t.id, env.JWT_SECRET), teacher: teacherDto(t) });
}
