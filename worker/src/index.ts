import { requireTeacher } from './auth/middleware';
import type { Env } from './env';
import * as auth from './routes/auth';
import * as classes from './routes/classes';
import * as students from './routes/students';
import * as activities from './routes/activities';
import * as play from './routes/play';
import * as reports from './routes/reports';
import { activityDraft } from './ai/builder';
import { dashboard } from './routes/dashboard';
import { catalogDto } from './education/catalog';
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

add('GET', '/api/classes', true, (req, env, _p, t) => classes.listClasses(env, t, req));
add('POST', '/api/classes', true, (req, env, _p, t) => classes.createClass(req, env, t));
add('GET', '/api/classes/:id', true, (_r, env, p, t) => classes.getClass(env, t, p.id));
add('PUT', '/api/classes/:id', true, (req, env, p, t) => classes.updateClass(req, env, t, p.id));
add('DELETE', '/api/classes/:id', true, (_r, env, p, t) => classes.deleteClass(env, t, p.id));
add('POST', '/api/classes/:id/archive', true, (_r, env, p, t) => classes.setClassArchived(env, t, p.id, true));
add('POST', '/api/classes/:id/unarchive', true, (_r, env, p, t) => classes.setClassArchived(env, t, p.id, false));
add('POST', '/api/classes/:id/students', true, (req, env, p, t) => classes.addStudentsToClass(req, env, t, p.id));
add('DELETE', '/api/classes/:id/students/:sid', true, (_r, env, p, t) => classes.removeStudentFromClass(env, t, p.id, p.sid));

add('POST', '/api/students', true, (req, env, _p, t) => students.createStudent(req, env, t));
add('GET', '/api/meta/education', false, () => Promise.resolve(json(catalogDto())));
add('PUT', '/api/students/:id', true, (req, env, p, t) => students.updateStudent(req, env, t, p.id));
add('GET', '/api/students/:id/profile', true, (_r, env, p, t) => students.getEducationalProfile(env, t, p.id));
add('GET', '/api/students/:id/recommendations', true, (_r, env, p, t) => students.getRecommendations(env, t, p.id));
add('GET', '/api/students/:id', true, (_r, env, p, t) => students.getStudent(env, t, p.id));
add('GET', '/api/students/:id/history', true, (_r, env, p, t) => students.getStudentHistory(env, t, p.id));
add('DELETE', '/api/students/:id/data', true, (_r, env, p, t) => students.clearStudentData(env, t, p.id));
add('DELETE', '/api/students/:id', true, (_r, env, p, t) => students.deleteStudent(env, t, p.id));

add('POST', '/api/ai/activity-draft', true, (req, env, _p, t) => activityDraft(req, env, t));
add('GET', '/api/dashboard', true, (req, env, _p, t) => dashboard(req, env, t));
add('GET', '/api/templates', true, (req) => Promise.resolve(activities.listTemplates(req)));
add('GET', '/api/templates/:id', true, (_r, _e, p) => Promise.resolve(activities.getTemplate(p.id)));
add('POST', '/api/activities/from-template', true, (req, env, _p, t) => activities.createFromTemplate(req, env, t));
add('POST', '/api/activities', true, (req, env, _p, t) => activities.createActivity(req, env, t));
add('GET', '/api/activities', true, (req, env, _p, t) => activities.listActivities(req, env, t));
add('GET', '/api/activities/:id', true, (_r, env, p, t) => activities.getActivity(env, t, p.id));
add('PUT', '/api/activities/:id', true, (req, env, p, t) => activities.updateActivity(req, env, t, p.id));
add('POST', '/api/activities/:id/duplicate', true, (req, env, p, t) => activities.duplicateActivity(req, env, t, p.id));
add('POST', '/api/activities/:id/archive', true, (_r, env, p, t) => activities.setArchived(env, t, p.id, true));
add('POST', '/api/activities/:id/unarchive', true, (_r, env, p, t) => activities.setArchived(env, t, p.id, false));
add('POST', '/api/activities/:id/regenerate-links', true, (req, env, p, t) => activities.regenerateLinks(req, env, t, p.id));
add('POST', '/api/activities/:id/cancel', true, (_r, env, p, t) => activities.cancelActivity(env, t, p.id));

add('GET', '/api/play/:token', false, (req, env, p) => play.getPlay(env, p.token, req));
add('GET', '/api/play/:token/progress', false, (req, env, p) => play.getProgress(env, p.token, req));
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
    // API versioning (spec 6.1): /api/v1/* is the stable alias of /api/*. Old clients keep using /api/*.
    const path = url.pathname.startsWith('/api/v1/') || url.pathname === '/api/v1' ? '/api' + url.pathname.slice('/api/v1'.length) : url.pathname;
    const segs = path.split('/').filter(Boolean);
    try {
      if (path === '/api/health') return withCors(json({ ok: true }), cors);
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
      // Developer-facing error log (spec 6.2): structured, one line, no body/PII. The id is also sent to the client
      // so a teacher can report it ("کد پیگیری") and it can be found in `wrangler tail`.
      const errorId = crypto.randomUUID().slice(0, 8);
      console.error(JSON.stringify({ level: 'error', errorId, method: req.method, path, message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack?.split('\n').slice(0, 6) : undefined }));
      return withCors(json({ error: 'internal_error', message: 'خطای داخلی سرور.', errorId }, 500), cors);
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
