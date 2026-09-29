import type { Env } from '../env';
import { HttpError, unauthorized } from '../utils/http';
import { verifyJwt } from './jwt';

/** Fail closed if the signing secret is missing or weak (misconfigured deployment). */
export function requireSecret(env: Env): void {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    console.error('JWT_SECRET is missing or shorter than 32 characters');
    throw new HttpError(500, 'misconfigured', 'خطای پیکربندی سرور.');
  }
}

export async function requireTeacher(req: Request, env: Env): Promise<string> {
  const h = req.headers.get('Authorization') ?? '';
  const m = /^Bearer (.+)$/.exec(h);
  if (!m) throw unauthorized();
  requireSecret(env);
  const payload = await verifyJwt(m[1], env.JWT_SECRET);
  if (!payload) throw unauthorized('نشست شما منقضی شده است. دوباره وارد شوید.');
  return payload.sub;
}
