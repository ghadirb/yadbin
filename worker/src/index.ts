import { requireTeacher } from './auth/middleware';
import type { Env } from './env';
import * as auth from './routes/auth';
import * as classes from './routes/classes';
import * as students from './routes/students';
import * as activities from './routes/activities';
import * as play from './routes/play';
import * as reports from './routes/reports';
import { corsHeaders, HttpError, json } from './utils/http';

type P = Record<string, string>;
interface Route { method: string; segs: string[]; teacher: boolean; handler: (req: Request, env: Env, p: P, teacherId: string) => Promise<Response> }

const routes: Route[] = [];
function add(method: string, path: string, teacher: boolean, handler: Route['handler']) {
  routes.push({ method, segs: path.split('/').filter(Boolean), teacher, handler });
}

add('POST', '/api/auth/register', false, (req, env) => auth.register(req, env));
add('POST', '/api/auth/login', false, (req, env) => auth.login(req, env));
add('POST', '/api/auth/reset-password', false, (req, env) => auth.resetPassword(req, env));

add('GET', '/api/classes', true, (_r, env, _p, t) => classes.listClasses(env, t));
add('POST', '/api/classes', true, (req, env, _p, t) => classes.createClass(req, env, t));
add('GET', '/api/classes/:id', true, (_r, env, p, t) => classes.getClass(env, t, p.id));
add('PUT', '/api/classes/:id', true, (req, env, p, t) => classes.updateClass(req, env, t, p.id));
add('DELETE', '/api/classes/:id', true, (_r, env, p, t) => classes.deleteClass(env, t, p.id));
add('POST', '/api/classes/:id/students', true, (req, env, p, t) => classes.addStudentsToClass(req, env, t, p.id));
add('DELETE', '/api/classes/:id/students/:sid', true, (_r, env, p, t) => classes.removeStudentFromClass(env, t, p.id, p.sid));

add('POST', '/api/students', true, (req, env, _p, t) => students.createStudent(req, env, t));
add('GET', '/api/students/:id', true, (_r, env, p, t) => students.getStudent(env, t, p.id));
add('DELETE', '/api/students/:id', true, (_r, env, p, t) => students.deleteStudent(env, t, p.id));

add('POST', '/api/activities', true, (req, env, _p, t) => activities.createActivity(req, env, t));
add('GET', '/api/activities/:id', true, (_r, env, p, t) => activities.getActivity(env, t, p.id));
add('POST', '/api/activities/:id/cancel', true, (_r, env, p, t) => activities.cancelActivity(env, t, p.id));

add('GET', '/api/play/:token', false, (req, env, p) => play.getPlay(env, p.token, req));
add('POST', '/api/play/:token/complete', false, (req, env, p) => play.completePlay(req, env, p.token));

add('GET', '/api/reports/student/:id', true, (_r, env, p, t) => reports.studentReport(env, t, p.id));
add('GET', '/api/reports/class/:id', true, (_r, env, p, t) => reports.classReport(env, t, p.id));

function match(route: Route, method: string, segs: string[]): P | null {
  if (route.method !== method || route.segs.length !== segs.length) return null;
  const p: P = {};
  for (let i = 0; i < segs.length; i++) {
    const r = route.segs[i];
    if (r.startsWith(':')) p[r.slice(1)] = decodeURIComponent(segs[i]);
    else if (r !== segs[i]) return null;
  }
  return p;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    const segs = url.pathname.split('/').filter(Boolean);
    try {
      if (url.pathname === '/api/health') return withCors(json({ ok: true }), cors);
      let pathMatched = false;
      for (const r of routes) {
        const p = match(r, req.method, segs);
        if (!p) { if (r.segs.length === segs.length && r.segs.every((s, i) => s.startsWith(':') || s === segs[i])) pathMatched = true; continue; }
        const teacherId = r.teacher ? await requireTeacher(req, env) : '';
        return withCors(await r.handler(req, env, p, teacherId), cors);
      }
      if (pathMatched) throw new HttpError(405, 'method_not_allowed', 'روش درخواست مجاز نیست.');
      throw new HttpError(404, 'not_found', 'یافت نشد.');
    } catch (e) {
      if (e instanceof HttpError) {
        const retry = e.status === 429 ? (e.extra as { retryAfter?: number } | undefined)?.retryAfter : undefined;
        const body = e.status === 429 ? undefined : e.extra;
        return withCors(json({ error: e.code, message: e.message, details: body }, e.status, retry ? { 'Retry-After': String(retry) } : {}), cors);
      }
      console.error('unhandled', e instanceof Error ? e.stack : e);
      return withCors(json({ error: 'internal_error', message: 'خطای داخلی سرور.' }, 500), cors);
    }
  },
} satisfies ExportedHandler<Env>;

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
function withCors(res: Response, cors: Record<string, string>): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...cors })) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
