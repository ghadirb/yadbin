import type { Env } from '../env';
import { unauthorized } from '../utils/http';
import { verifyJwt } from './jwt';

export async function requireTeacher(req: Request, env: Env): Promise<string> {
  const h = req.headers.get('Authorization') ?? '';
  const m = /^Bearer (.+)$/.exec(h);
  if (!m || !env.JWT_SECRET) throw unauthorized();
  const payload = await verifyJwt(m[1], env.JWT_SECRET);
  if (!payload) throw unauthorized('نشست شما منقضی شده است. دوباره وارد شوید.');
  return payload.sub;
}
