import { requireTeacher } from './auth/middleware';
import type { Env } from './env';
import * as auth from './routes/auth';
import * as classes from './routes/classes';
import * as students from './routes/students';
import * as activities from './routes/activities';
import * as play from './routes/play';
import * as ap from './routes/assessment-play';
import * as as_ from './routes/assessments';
import { assessmentDraft } from './ai/assessment-draft';
import { assessmentDraftFromSource } from './ai/assessment-from-source';
import * as cs from './routes/content-sources';
import * as reports from './routes/reports';
import { activityDraft } from './ai/builder';
import { dashboard } from './routes/dashboard';
import { catalogDto } from './education/catalog';
import * as sub from './routes/subscription';
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
add('POST', '/api/activities/:id/preview', true, (req, env, p, t) => activities.startPreview(req, env, t, p.id));
add('POST', '/api/activities/:id/preview-feedback', true, (req, env, p, t) => activities.recordPreviewFeedback(req, env, t, p.id));
add('POST', '/api/activities/:id/publish', true, (req, env, p, t) => activities.publishActivity(req, env, t, p.id));

// Teacher Assessments share the activity URLs: an assessment token is answered by assessment-play, anything else falls through.
add('GET', '/api/play/:token', false, async (req, env, p) => (await ap.getPlay(env, p.token, req)) ?? play.getPlay(env, p.token, req));
add('GET', '/api/play/:token/progress', false, (req, env, p) => play.getProgress(env, p.token, req));
add('POST', '/api/play/:token/complete', false, async (req, env, p) => (await ap.completePlay(req, env, p.token)) ?? play.completePlay(req, env, p.token));
add('GET', '/api/preview/:token', false, async (req, env, p) => (await ap.getPreview(env, p.token, req)) ?? play.getPreview(env, p.token, req));
add('POST', '/api/preview/:token/complete', false, async (req, env, p) => (await ap.completePreview(req, env, p.token)) ?? play.completePreview(req, env, p.token));

// Teacher Assessments (آزمون‌های معلم) — separate content type, same lifecycle / preview / play-link system.
add('GET', '/api/assessments', true, (req, env, _p, t) => as_.listAssessments(req, env, t));
add('POST', '/api/assessments', true, (req, env, _p, t) => as_.createAssessment(req, env, t));
add('POST', '/api/ai/assessment-draft', true, (req, env, _p, t) => assessmentDraft(req, env, t));
// Source-grounded draft (آزمون از روی کتاب/منبع): same Draft → Preview → Publish workflow, same AI entitlement and usage counter.
add('POST', '/api/ai/assessment-draft-from-source', true, (req, env, _p, t) => assessmentDraftFromSource(req, env, t));
add('GET', '/api/assessments/:id', true, (_r, env, p, t) => as_.getAssessment(env, t, p.id));
add('PUT', '/api/assessments/:id', true, (req, env, p, t) => as_.updateAssessment(req, env, t, p.id));
add('DELETE', '/api/assessments/:id', true, (_r, env, p, t) => as_.deleteAssessment(env, t, p.id));
add('POST', '/api/assessments/:id/archive', true, (_r, env, p, t) => as_.setAssessmentArchived(env, t, p.id, true));
add('POST', '/api/assessments/:id/unarchive', true, (_r, env, p, t) => as_.setAssessmentArchived(env, t, p.id, false));
add('POST', '/api/assessments/:id/duplicate', true, (_r, env, p, t) => as_.duplicateAssessment(env, t, p.id));
add('POST', '/api/assessments/:id/new-version', true, (_r, env, p, t) => as_.newAssessmentVersion(env, t, p.id));
add('POST', '/api/assessments/:id/questions', true, (req, env, p, t) => as_.addQuestion(req, env, t, p.id));
add('PUT', '/api/assessments/:id/questions/:qid', true, (req, env, p, t) => as_.updateQuestion(req, env, t, p.id, p.qid));
add('DELETE', '/api/assessments/:id/questions/:qid', true, (_r, env, p, t) => as_.deleteQuestion(env, t, p.id, p.qid));
add('POST', '/api/assessments/:id/questions/:qid/duplicate', true, (_r, env, p, t) => as_.duplicateQuestion(env, t, p.id, p.qid));
add('POST', '/api/assessments/:id/reorder', true, (req, env, p, t) => as_.reorderQuestions(req, env, t, p.id));
add('POST', '/api/assessments/:id/preview', true, (_r, env, p, t) => as_.startAssessmentPreview(env, t, p.id));
add('POST', '/api/assessments/:id/preview-feedback', true, (req, env, p, t) => as_.assessmentPreviewFeedback(req, env, t, p.id));
add('POST', '/api/assessments/:id/publish', true, (req, env, p, t) => as_.publishAssessment(req, env, t, p.id));
add('POST', '/api/assessments/:id/assign', true, (req, env, p, t) => as_.assignAssessment(req, env, t, p.id));
add('GET', '/api/assessments/:id/report', true, (_r, env, p, t) => as_.assessmentReport(env, t, p.id));
add('GET', '/api/students/:id/assessments', true, (_r, env, p, t) => as_.studentAssessments(env, t, p.id));

// Content Sources (کتاب‌ها و منابع درسی, v1.5) — private to the owning teacher; a foreign id looks exactly like a missing one (404).
add('POST', '/api/content-sources', true, (req, env, _p, t) => cs.createSource(req, env, t));
add('GET', '/api/content-sources', true, (req, env, _p, t) => cs.listSources(req, env, t));
add('GET', '/api/content-sources/:id', true, (_r, env, p, t) => cs.getSource(env, t, p.id));
add('PUT', '/api/content-sources/:id', true, (req, env, p, t) => cs.updateSource(req, env, t, p.id));
add('DELETE', '/api/content-sources/:id', true, (_r, env, p, t) => cs.deleteSource(env, t, p.id));
add('POST', '/api/content-sources/:id/process', true, (req, env, p, t) => cs.processSourceRoute(req, env, t, p.id));
add('GET', '/api/content-sources/:id/sections', true, (_r, env, p, t) => cs.listSections(env, t, p.id));
add('GET', '/api/content-sources/:id/sections/:sectionId', true, (_r, env, p, t) => cs.getSection(env, t, p.id, p.sectionId));

// Subscription / Trial / payments (v1.4). Access is decided server-side only (see subscription/entitlements.ts).
add('GET', '/api/subscription', true, (_r, env, _p, t) => sub.getSubscription(env, t));
add('GET', '/api/plans', false, (req, env) => sub.listPlans(env, req));
add('POST', '/api/payment/create', true, (req, env, _p, t) => sub.postPaymentCreate(req, env, t));
add('POST', '/api/payment/myket/confirm', true, (req, env, _p, t) => sub.postMyketConfirm(req, env, t));
add('GET', '/api/payment/status', true, (req, env, _p, t) => sub.getPaymentStatus(req, env, t));
add('POST', '/api/payment/callback', false, (req, env) => sub.paymentCallback(req, env));
add('GET', '/api/payment/callback', false, (req, env) => sub.paymentCallback(req, env));

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
