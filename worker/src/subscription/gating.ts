import type { Env } from '../env';
import { HttpError } from '../utils/http';
import { ocrPagesPro } from './config';
import { getUserEntitlements, type Entitlements } from './entitlements';

export type LimitedFeature = 'classes' | 'students' | 'assessments' | 'ai' | 'ocr';

const MESSAGES: Record<LimitedFeature, string> = {
  classes: 'در پلن رایگان فقط تعداد محدودی کلاس می‌توانید داشته باشید. برای کلاس بیشتر، اشتراک حرفه‌ای را فعال کنید.',
  students: 'به سقف دانش‌آموزان پلن رایگان رسیده‌اید. برای افزودن دانش‌آموز بیشتر، اشتراک حرفه‌ای را فعال کنید.',
  assessments: 'به سقف آزمون‌های پلن رایگان رسیده‌اید. برای ساخت آزمون بیشتر، اشتراک حرفه‌ای را فعال کنید.',
  ocr: 'خواندن صفحه‌های کتاب با تصویر (برای PDFهای اسکن‌شده یا با فونت خراب) فقط در اشتراک حرفه‌ای فعال است.',
  ai: 'سهمیه‌ی هوش مصنوعی پلن رایگان در این ماه تمام شده است. با اشتراک حرفه‌ای محدودیتی ندارید.',
};

/** The standard "you hit a Free-plan limit" error. Existing data is never touched; only creating MORE is refused. */
export function limitReached(feature: LimitedFeature, limit: number, current: number, plan: string): HttpError {
  return new HttpError(403, 'FEATURE_LIMIT_REACHED', MESSAGES[feature], { feature, limit, current, plan, upgrade: true });
}

const period = () => new Date().toISOString().slice(0, 7);

export async function countClasses(env: Env, teacherId: string): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM classes WHERE teacher_id = ? AND archived_at IS NULL').bind(teacherId).first<{ n: number }>();
  return r?.n ?? 0;
}
/** Students who count toward the cap: in an active class, or not (yet) in any class. Students removed from every class do not count. */
export async function countStudents(env: Env, teacherId: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM students s WHERE s.teacher_id = ?1 AND (
       EXISTS (SELECT 1 FROM class_students cs WHERE cs.student_id = s.id AND cs.removed_at IS NULL)
       OR NOT EXISTS (SELECT 1 FROM class_students cs WHERE cs.student_id = s.id))`,
  ).bind(teacherId).first<{ n: number }>();
  return r?.n ?? 0;
}
/** One assessment = one root (new versions of the same assessment do not count again). Archived ones are free again. */
export async function countAssessments(env: Env, teacherId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(DISTINCT root_id) AS n FROM assessments WHERE teacher_id = ? AND status != 'archived'").bind(teacherId).first<{ n: number }>();
  return r?.n ?? 0;
}
export async function aiUsed(env: Env, teacherId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT count FROM usage_counters WHERE teacher_id = ? AND feature = 'ai' AND period = ?").bind(teacherId, period()).first<{ count: number }>();
  return r?.count ?? 0;
}
export async function usageSnapshot(env: Env, teacherId: string) {
  const [classes, students, assessments, ai] = await Promise.all([countClasses(env, teacherId), countStudents(env, teacherId), countAssessments(env, teacherId), aiUsed(env, teacherId)]);
  const o = await ocrUsed(env, teacherId);
  return { classes, students, assessments, aiRequests: ai, ocrPages: o };
}

/** Throws FEATURE_LIMIT_REACHED if adding `adding` more classes/students/assessments would pass the plan's cap. */
export async function enforceCreate(env: Env, teacherId: string, feature: Exclude<LimitedFeature, 'ai'>, adding = 1, ent?: Entitlements): Promise<void> {
  const e = ent ?? await getUserEntitlements(env, teacherId);
  const limit = feature === 'classes' ? e.limits.maxClasses : feature === 'students' ? e.limits.maxStudents : e.limits.maxAssessments;
  if (limit === null) return;
  const current = feature === 'classes' ? await countClasses(env, teacherId) : feature === 'students' ? await countStudents(env, teacherId) : await countAssessments(env, teacherId);
  if (current + adding > limit) throw limitReached(feature, limit, current, e.plan);
}

/** True when the teacher may spend one AI request now (does not consume). */
export async function aiAllowed(env: Env, teacherId: string, ent?: Entitlements): Promise<{ allowed: boolean; limit: number | null; used: number; plan: string }> {
  const e = ent ?? await getUserEntitlements(env, teacherId);
  if (e.limits.aiRequestsPerMonth === null) return { allowed: true, limit: null, used: 0, plan: e.plan };
  const used = await aiUsed(env, teacherId);
  return { allowed: used < e.limits.aiRequestsPerMonth, limit: e.limits.aiRequestsPerMonth, used, plan: e.plan };
}
export async function requireAi(env: Env, teacherId: string): Promise<void> {
  const a = await aiAllowed(env, teacherId);
  if (!a.allowed) throw limitReached('ai', a.limit ?? 0, a.used, a.plan);
}
/** Record one successful AI request (atomic upsert). Only counted for metered plans. */
export async function consumeAi(env: Env, teacherId: string): Promise<void> {
  const e = await getUserEntitlements(env, teacherId);
  if (e.limits.aiRequestsPerMonth === null) return;
  await env.DB.prepare(
    `INSERT INTO usage_counters (teacher_id, feature, period, count) VALUES (?1, 'ai', ?2, 1)
       ON CONFLICT(teacher_id, feature, period) DO UPDATE SET count = count + 1`,
  ).bind(teacherId, period()).run();
}

/** Image reading of book pages (vision model, the only expensive step of a book upload): PAID only, with a monthly page budget.
 *  Trial and Free never get it — a new account could otherwise read whole books for nothing. Quota unit = one page actually sent to the model. */
export async function ocrUsed(env: Env, teacherId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT count FROM usage_counters WHERE teacher_id = ? AND feature = 'ocr_pages' AND period = ?").bind(teacherId, period()).first<{ count: number }>();
  return r?.count ?? 0;
}
export async function ocrQuota(env: Env, teacherId: string, ent?: Entitlements) {
  const e = ent ?? await getUserEntitlements(env, teacherId);
  const enabled = e.plan === 'PRO';
  const limit = enabled ? ocrPagesPro(env) : 0;
  const used = enabled ? await ocrUsed(env, teacherId) : 0;
  return { enabled, plan: e.plan, limit, used, remaining: Math.max(0, limit - used) };
}
/** Throws 403 FEATURE_LIMIT_REACHED (feature 'ocr') unless the teacher is on an active Pro plan with `pages` pages left this month. */
export async function requireOcrPlan(env: Env, teacherId: string): Promise<void> {
  const q = await ocrQuota(env, teacherId);
  if (!q.enabled) throw limitReached('ocr', 0, 0, q.plan);
}
export async function requireOcrPages(env: Env, teacherId: string, pages: number): Promise<void> {
  const q = await ocrQuota(env, teacherId);
  if (!q.enabled) throw limitReached('ocr', 0, 0, q.plan);
  if (pages > q.remaining) {
    throw new HttpError(403, 'FEATURE_LIMIT_REACHED', `سهمیهٔ ماهانهٔ خواندن صفحه‌ها با تصویر (${q.limit} صفحه) برای این کار کافی نیست؛ ${q.remaining} صفحه باقی مانده است. ماه بعد تمدید می‌شود یا می‌توانید بازهٔ صفحه‌ها را کوچک‌تر کنید.`,
      { feature: 'ocr', limit: q.limit, current: q.used, remaining: q.remaining, plan: q.plan, upgrade: false });
  }
}
export async function consumeOcrPages(env: Env, teacherId: string, pages: number): Promise<void> {
  if (pages <= 0) return;
  await env.DB.prepare(
    `INSERT INTO usage_counters (teacher_id, feature, period, count) VALUES (?1, 'ocr_pages', ?2, ?3)
       ON CONFLICT(teacher_id, feature, period) DO UPDATE SET count = count + ?3`,
  ).bind(teacherId, period(), pages).run();
}
