import type { Env } from '../env';
import { getOwnedClass, getOwnedStudent } from '../db/queries';
import { gradeByCode, levelLabel } from '../education/catalog';
import { chooseStudents } from './activities';
import { assessmentProblems, fromRow, MAX_QUESTIONS, questionSchema, QUESTION_TYPE_LABELS_FA, teacherView, toColumns, type QuestionInput, type StoredQuestion } from '../assessments/grading';
import { addQuestionExtra, assessmentCreateSchema, assessmentFeedbackSchema, assessmentUpdateSchema, assignSchema, publishAssessmentSchema, reorderSchema } from '../assessments/schemas';
import { HttpError, json, notFound, readJson } from '../utils/http';
import { newId, newPlayToken, nowIso } from '../utils/ids';
import { parse } from '../validation/schemas';

/** Teacher Assessments (آزمون‌های معلم). Lifecycle = the activity lifecycle:
 *  draft → teacher_preview → ready_to_publish → published → archived.
 *  Any change to what a student would see bumps `content_rev`, drops previews and sends the assessment back to draft.
 *  A published version is immutable: «ساخت نسخه جدید» copies it to a new draft version. */

export const STATUS_LABELS_FA: Record<string, string> = { draft: 'پیش‌نویس', teacher_preview: 'در حال آزمایش', ready_to_publish: 'آماده انتشار', published: 'منتشرشده', archived: 'آرشیوشده' };
const EDITABLE = new Set(['draft', 'teacher_preview', 'ready_to_publish']);
const playUrl = (env: Env, token: string) => `${(env.PLAY_BASE_URL || '').replace(/\/$/, '')}/play/${token}`;
const previewUrl = (env: Env, token: string) => `${(env.PLAY_BASE_URL || '').replace(/\/$/, '')}/preview/${token}`;

export async function getOwnedAssessment(db: D1Database, teacherId: string, id: string) {
  const row = await db.prepare('SELECT * FROM assessments WHERE id = ? AND teacher_id = ?').bind(id, teacherId).first<any>();
  if (!row) throw notFound('آزمون یافت نشد.'); // a foreign id looks exactly like a missing one
  return row;
}
export async function loadQuestions(db: D1Database, assessmentId: string): Promise<StoredQuestion[]> {
  const { results } = await db.prepare('SELECT * FROM assessment_questions WHERE assessment_id = ? ORDER BY position, created_at').bind(assessmentId).all<any>();
  return results.map(fromRow);
}

export function assessmentDto(a: any, extra: { questionCount?: number; assigned?: number; completed?: number } = {}) {
  const g = gradeByCode(a.grade_code);
  return {
    id: a.id, rootId: a.root_id, version: a.version, contentType: 'teacher_assessment',
    title: a.title, description: a.description ?? null, subject: a.subject ?? null,
    gradeCode: a.grade_code ?? null, gradeLabel: g?.label ?? null, level: a.level ?? null, levelLabel: levelLabel(a.level),
    suggestedMinutes: a.suggested_minutes ?? null, status: a.status, statusLabel: STATUS_LABELS_FA[a.status] ?? a.status,
    questionCount: extra.questionCount ?? 0, assigned: extra.assigned ?? 0, completed: extra.completed ?? 0,
    previewedAt: a.previewed_at ?? null, previewFeedback: a.preview_feedback ?? null, teacherApprovedAt: a.teacher_approved_at ?? null,
    createdAt: a.created_at, updatedAt: a.updated_at, publishedAt: a.published_at ?? null, archivedAt: a.archived_at ?? null,
  };
}

async function counts(db: D1Database, id: string) {
  const c = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM assessment_questions WHERE assessment_id = ?1) AS q,
            (SELECT COUNT(*) FROM assessment_students WHERE assessment_id = ?1) AS assigned,
            (SELECT COUNT(*) FROM assessment_students WHERE assessment_id = ?1 AND status = 'completed') AS completed,
            (SELECT COUNT(*) FROM assessment_students WHERE assessment_id = ?1 AND status != 'pending') AS touched`,
  ).bind(id).first<{ q: number; assigned: number; completed: number; touched: number }>();
  return { questionCount: c?.q ?? 0, assigned: c?.assigned ?? 0, completed: c?.completed ?? 0, touched: c?.touched ?? 0 };
}

async function detail(env: Env, teacherId: string, id: string, status = 200) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  const qs = await loadQuestions(env.DB, id);
  const c = await counts(env.DB, id);
  const versions = (await env.DB.prepare('SELECT id, version, status FROM assessments WHERE root_id = ? AND teacher_id = ? ORDER BY version').bind(a.root_id, teacherId).all<any>())
    .results.map((v) => ({ id: v.id, version: v.version, status: v.status, statusLabel: STATUS_LABELS_FA[v.status] ?? v.status }));
  const students = a.status === 'published' || a.status === 'archived' ? (await env.DB.prepare(
    `SELECT x.student_id, x.token, x.status, x.started_at, x.completed_at, x.class_id, s.display_name FROM assessment_students x JOIN students s ON s.id = x.student_id
      WHERE x.assessment_id = ? ORDER BY s.display_name`).bind(id).all<any>()).results.map((r) => ({ studentId: r.student_id, classId: r.class_id, name: r.display_name, token: r.token, url: playUrl(env, r.token), status: r.status, startedAt: r.started_at, completedAt: r.completed_at })) : [];
  return json({
    assessment: assessmentDto(a, c), questions: qs.map(teacherView), problems: assessmentProblems(a, qs), versions, students,
    editable: EDITABLE.has(a.status), canCreateNewVersion: a.status === 'published' || a.status === 'archived',
  }, status);
}

function assertEditable(a: any) {
  if (a.status === 'archived') throw new HttpError(409, 'assessment_archived', 'این آزمون آرشیو شده است. ابتدا آن را از آرشیو خارج کنید.');
  if (!EDITABLE.has(a.status)) throw new HttpError(409, 'assessment_locked', 'این آزمون منتشر شده و تغییر نمی‌کند. برای ویرایش، «ساخت نسخه جدید» را بزنید؛ نتیجه‌های قبلی دست‌نخورده می‌مانند.');
}

/** Statements that must accompany every change of what a student would see. */
function invalidate(env: Env, a: any, now: string) {
  return [
    env.DB.prepare(`UPDATE assessments SET content_rev = content_rev + 1, status = CASE WHEN status IN ('teacher_preview','ready_to_publish') THEN 'draft' ELSE status END,
        previewed_at = NULL, preview_feedback = NULL, teacher_approved_at = NULL, updated_at = ? WHERE id = ?`).bind(now, a.id),
    env.DB.prepare('DELETE FROM assessment_preview_sessions WHERE assessment_id = ?').bind(a.id),
  ];
}
const insertQuestion = (env: Env, assessmentId: string, id: string, position: number, q: QuestionInput, now: string, source: string | null = null) => {
  const c = toColumns(q);
  return env.DB.prepare('INSERT INTO assessment_questions (id,assessment_id,position,question_type,text,options_json,correct_json,explanation,source_question_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, assessmentId, position, c.type, c.text, c.options, c.correct, c.explanation, source, now, now);
};
const renumber = (env: Env, assessmentId: string, ids: string[]) => ids.map((qid, i) => env.DB.prepare('UPDATE assessment_questions SET position = ? WHERE id = ? AND assessment_id = ?').bind(i + 1, qid, assessmentId));

// ───────────────────────── assessment CRUD ─────────────────────────

export async function createAssessment(req: Request, env: Env, teacherId: string) {
  const b = parse(assessmentCreateSchema, await readJson(req));
  const id = newId(), now = nowIso();
  await env.DB.prepare('INSERT INTO assessments (id,teacher_id,root_id,version,title,description,subject,grade_code,level,suggested_minutes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, teacherId, id, 1, b.title, b.description ?? null, b.subject ?? null, b.gradeCode ?? null, b.level ?? null, b.suggestedMinutes ?? null, 'draft', now, now).run();
  return detail(env, teacherId, id, 201);
}

/** GET /assessments?status=all|draft|ready_to_publish|published|archived  («draft» also lists assessments being previewed). */
export async function listAssessments(req: Request, env: Env, teacherId: string) {
  const status = new URL(req.url).searchParams.get('status') ?? 'all';
  const where = status === 'all' ? '' : status === 'draft' ? "AND a.status IN ('draft','teacher_preview')" : ['ready_to_publish', 'published', 'archived'].includes(status) ? 'AND a.status = ?' : null;
  if (where === null) throw new HttpError(400, 'validation_error', 'فیلتر وضعیت معتبر نیست.');
  const { results } = await env.DB.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM assessment_questions q WHERE q.assessment_id = a.id) AS q_n,
            (SELECT COUNT(*) FROM assessment_students x WHERE x.assessment_id = a.id) AS assigned_n,
            (SELECT COUNT(*) FROM assessment_students x WHERE x.assessment_id = a.id AND x.status = 'completed') AS completed_n
       FROM assessments a WHERE a.teacher_id = ? ${where} ORDER BY a.updated_at DESC LIMIT 200`,
  ).bind(...(where.includes('?') ? [teacherId, status] : [teacherId])).all<any>();
  return json({ assessments: results.map((a) => assessmentDto(a, { questionCount: a.q_n, assigned: a.assigned_n, completed: a.completed_n })), filter: status });
}

export async function getAssessment(env: Env, teacherId: string, id: string) { return detail(env, teacherId, id); }

export async function updateAssessment(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  const b = parse(assessmentUpdateSchema, await readJson(req));
  const gradeChanged = b.gradeCode !== undefined && (b.gradeCode ?? null) !== a.grade_code;
  const levelChanged = b.level !== undefined && (b.level ?? null) !== a.level;
  const contentChange = gradeChanged || levelChanged;
  if (a.status === 'archived') assertEditable(a);
  if (a.status === 'published' && contentChange) assertEditable(a); // title / description / subject / time are harmless; grade & level are not
  const now = nowIso();
  const stmts = [env.DB.prepare('UPDATE assessments SET title=?, description=?, subject=?, grade_code=?, level=?, suggested_minutes=?, updated_at=? WHERE id=? AND teacher_id=?').bind(
    b.title ?? a.title, b.description !== undefined ? (b.description || null) : a.description, b.subject !== undefined ? (b.subject || null) : a.subject,
    b.gradeCode !== undefined ? b.gradeCode : a.grade_code, b.level !== undefined ? b.level : a.level,
    b.suggestedMinutes !== undefined ? b.suggestedMinutes : a.suggested_minutes, now, id, teacherId)];
  if (contentChange) stmts.push(...invalidate(env, a, now));
  await env.DB.batch(stmts);
  return detail(env, teacherId, id);
}

/** Never-published assessments only. Anything that students may have seen is archived, never destroyed (spec 24). */
export async function deleteAssessment(env: Env, teacherId: string, id: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  const c = await counts(env.DB, id);
  if (a.status === 'published' || a.published_at || c.assigned > 0)
    throw new HttpError(409, 'assessment_has_results', 'آزمون منتشرشده حذف نمی‌شود تا نتیجه‌ها حفظ شوند. از «آرشیو» استفاده کنید.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM assessment_preview_sessions WHERE assessment_id = ?').bind(id),
    env.DB.prepare('DELETE FROM assessment_questions WHERE assessment_id = ?').bind(id),
    env.DB.prepare('DELETE FROM assessments WHERE id = ? AND teacher_id = ?').bind(id, teacherId),
  ]);
  return json({ ok: true });
}

export async function setAssessmentArchived(env: Env, teacherId: string, id: string, archived: boolean) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  const now = nowIso();
  if (archived) {
    if (a.status !== 'archived') await env.DB.prepare("UPDATE assessments SET status='archived', archived_at=?, updated_at=? WHERE id=? AND teacher_id=?").bind(now, now, id, teacherId).run();
  } else if (a.status === 'archived') {
    // back to where it can safely be: published stays published; an unpublished one returns as a draft (needs a fresh preview)
    await env.DB.batch([
      env.DB.prepare("UPDATE assessments SET status=?, archived_at=NULL, updated_at=?, previewed_at=NULL, preview_feedback=NULL, teacher_approved_at=NULL WHERE id=? AND teacher_id=?").bind(a.published_at ? 'published' : 'draft', now, id, teacherId),
      env.DB.prepare('DELETE FROM assessment_preview_sessions WHERE assessment_id = ?').bind(id),
    ]);
  }
  return detail(env, teacherId, id);
}

/** Independent draft: new root, version 1, no assignments, no results. */
export async function duplicateAssessment(env: Env, teacherId: string, id: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  const qs = await loadQuestions(env.DB, id);
  const nid = newId(), now = nowIso();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO assessments (id,teacher_id,root_id,version,title,description,subject,grade_code,level,suggested_minutes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(nid, teacherId, nid, 1, `کپی ${a.title}`.slice(0, 100), a.description, a.subject, a.grade_code, a.level, a.suggested_minutes, 'draft', now, now),
    ...qs.map((q, i) => insertQuestion(env, nid, newId(), i + 1, asInput(q), now, q.id)),
  ]);
  return detail(env, teacherId, nid, 201);
}

/** «ساخت نسخه جدید»: the published version stays untouched; the copy is a draft that needs its own preview. Idempotent per root. */
export async function newAssessmentVersion(env: Env, teacherId: string, id: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  if (EDITABLE.has(a.status)) throw new HttpError(409, 'not_published', 'این نسخه هنوز منتشر نشده است و مستقیم قابل ویرایش است.');
  const open = await env.DB.prepare("SELECT id FROM assessments WHERE root_id = ? AND teacher_id = ? AND status IN ('draft','teacher_preview','ready_to_publish') ORDER BY version DESC LIMIT 1").bind(a.root_id, teacherId).first<{ id: string }>();
  if (open) return detail(env, teacherId, open.id); // a newer unpublished version already exists: continue with it
  const qs = await loadQuestions(env.DB, id);
  const max = (await env.DB.prepare('SELECT MAX(version) AS v FROM assessments WHERE root_id = ?').bind(a.root_id).first<{ v: number }>())?.v ?? a.version;
  const nid = newId(), now = nowIso();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO assessments (id,teacher_id,root_id,version,title,description,subject,grade_code,level,suggested_minutes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(nid, teacherId, a.root_id, max + 1, a.title, a.description, a.subject, a.grade_code, a.level, a.suggested_minutes, 'draft', now, now),
    ...qs.map((q, i) => insertQuestion(env, nid, newId(), i + 1, asInput(q), now, q.id)),
  ]);
  return detail(env, teacherId, nid, 201);
}

const asInput = (q: StoredQuestion): QuestionInput => (q.type === 'multiple_choice' ? { type: q.type, text: q.text, options: q.options!, correct: q.correct as number, explanation: q.explanation }
  : q.type === 'true_false' ? { type: q.type, text: q.text, correct: q.correct as boolean, explanation: q.explanation } : { type: q.type, text: q.text, answers: q.correct as string[], explanation: q.explanation });

// ───────────────────────── questions ─────────────────────────

export async function addQuestion(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  assertEditable(a);
  const raw = (await readJson(req)) as Record<string, unknown>;
  const q = parse(questionSchema, raw);
  const { position } = parse(addQuestionExtra, { position: raw?.position });
  const existing = await loadQuestions(env.DB, id);
  if (existing.length >= MAX_QUESTIONS) throw new HttpError(409, 'too_many_questions', `هر آزمون حداکثر ${MAX_QUESTIONS} سؤال دارد.`);
  const qid = newId(), now = nowIso();
  const ids = existing.map((e) => e.id);
  ids.splice(position ? Math.min(position, ids.length + 1) - 1 : ids.length, 0, qid);
  await env.DB.batch([insertQuestion(env, id, qid, ids.indexOf(qid) + 1, q, now), ...renumber(env, id, ids), ...invalidate(env, a, now)]);
  return detail(env, teacherId, id, 201);
}

async function ownedQuestion(env: Env, id: string, qid: string) {
  const row = await env.DB.prepare('SELECT * FROM assessment_questions WHERE id = ? AND assessment_id = ?').bind(qid, id).first<any>();
  if (!row) throw notFound('سؤال یافت نشد.');
  return row;
}

export async function updateQuestion(req: Request, env: Env, teacherId: string, id: string, qid: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  assertEditable(a);
  await ownedQuestion(env, id, qid);
  const q = parse(questionSchema, await readJson(req));
  const c = toColumns(q), now = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE assessment_questions SET question_type=?, text=?, options_json=?, correct_json=?, explanation=?, updated_at=? WHERE id=? AND assessment_id=?').bind(c.type, c.text, c.options, c.correct, c.explanation, now, qid, id),
    ...invalidate(env, a, now),
  ]);
  return detail(env, teacherId, id);
}

export async function deleteQuestion(env: Env, teacherId: string, id: string, qid: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  assertEditable(a);
  await ownedQuestion(env, id, qid);
  const rest = (await loadQuestions(env.DB, id)).map((q) => q.id).filter((x) => x !== qid), now = nowIso();
  await env.DB.batch([env.DB.prepare('DELETE FROM assessment_questions WHERE id = ? AND assessment_id = ?').bind(qid, id), ...renumber(env, id, rest), ...invalidate(env, a, now)]);
  return detail(env, teacherId, id);
}

/** Copy of a question, placed right after the original, with its own stable id. */
export async function duplicateQuestion(env: Env, teacherId: string, id: string, qid: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  assertEditable(a);
  const all = await loadQuestions(env.DB, id);
  const src = all.find((q) => q.id === qid);
  if (!src) throw notFound('سؤال یافت نشد.');
  if (all.length >= MAX_QUESTIONS) throw new HttpError(409, 'too_many_questions', `هر آزمون حداکثر ${MAX_QUESTIONS} سؤال دارد.`);
  const nid = newId(), now = nowIso(), ids = all.map((q) => q.id);
  ids.splice(ids.indexOf(qid) + 1, 0, nid);
  await env.DB.batch([insertQuestion(env, id, nid, ids.indexOf(nid) + 1, asInput(src), now, src.id), ...renumber(env, id, ids), ...invalidate(env, a, now)]);
  return detail(env, teacherId, id, 201);
}

export async function reorderQuestions(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  assertEditable(a);
  const { order } = parse(reorderSchema, await readJson(req));
  const current = (await loadQuestions(env.DB, id)).map((q) => q.id);
  if (order.length !== current.length || new Set(order).size !== order.length || !order.every((x) => current.includes(x)))
    throw new HttpError(400, 'validation_error', 'ترتیب باید شامل همه‌ی سؤال‌های آزمون، هرکدام یک بار باشد.');
  if (order.some((x, i) => x !== current[i])) await env.DB.batch([...renumber(env, id, order), ...invalidate(env, a, nowIso())]);
  return detail(env, teacherId, id);
}

// ───────────────────────── preview / approval / publish ─────────────────────────

export async function startAssessmentPreview(env: Env, teacherId: string, id: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  if (a.status === 'archived') throw new HttpError(409, 'assessment_archived', 'این آزمون آرشیو شده است.');
  const qs = await loadQuestions(env.DB, id);
  const problems = assessmentProblems(a, qs);
  if (problems.length) throw new HttpError(422, 'assessment_invalid', problems[0], { problems });
  const token = newPlayToken(), now = nowIso();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO assessment_preview_sessions (id,assessment_id,teacher_id,token,content_rev,started_at) VALUES (?,?,?,?,?,?)').bind(newId(), id, teacherId, token, a.content_rev, now),
    env.DB.prepare("UPDATE assessments SET status = CASE WHEN status = 'draft' THEN 'teacher_preview' ELSE status END WHERE id = ? AND teacher_id = ?").bind(id, teacherId),
  ]);
  return json({ token, url: previewUrl(env, token), summary: previewSummary(a, qs.length) });
}

export function previewSummary(a: any, questionCount: number) {
  return {
    kind: 'teacher_assessment', title: a.title, subject: a.subject ?? null, gradeLabel: gradeByCode(a.grade_code)?.label ?? null, levelLabel: levelLabel(a.level),
    questionCount, estimatedMinutes: a.suggested_minutes ?? Math.max(1, Math.ceil(questionCount * 0.75)),
    note: 'این اجرا فقط برای آزمایش شماست؛ دانش‌آموزی ایجاد نمی‌شود و هیچ نتیجه‌ای در گزارش‌ها ثبت نمی‌شود.',
  };
}

/** suitable / too_easy → ready_to_publish; too_hard / needs_edit → draft. Needs a COMPLETED preview of the CURRENT revision. */
export async function assessmentPreviewFeedback(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  const { feedback } = parse(assessmentFeedbackSchema, await readJson(req));
  if (a.status === 'archived') throw new HttpError(409, 'assessment_archived', 'این آزمون آرشیو شده است.');
  const done = await env.DB.prepare("SELECT id FROM assessment_preview_sessions WHERE assessment_id = ? AND teacher_id = ? AND status = 'completed' AND content_rev = ? ORDER BY completed_at DESC LIMIT 1").bind(id, teacherId, a.content_rev).first();
  if (!done) throw new HttpError(409, 'preview_required', 'ابتدا آزمون را کامل آزمایش کنید (پس از هر ویرایش، آزمایش دوباره لازم است).');
  const now = nowIso();
  if (a.status === 'published') { // already live: the verdict is only recorded
    await env.DB.prepare('UPDATE assessments SET previewed_at=?, preview_feedback=? WHERE id=? AND teacher_id=?').bind(now, feedback, id, teacherId).run();
    return detail(env, teacherId, id);
  }
  const approved = feedback === 'suitable' || feedback === 'too_easy';
  await env.DB.batch([
    env.DB.prepare('UPDATE assessments SET previewed_at=?, preview_feedback=?, teacher_approved_at=?, status=?, updated_at=? WHERE id=? AND teacher_id=?').bind(now, feedback, approved ? now : null, approved ? 'ready_to_publish' : 'draft', now, id, teacherId),
    env.DB.prepare('DELETE FROM assessment_preview_sessions WHERE assessment_id = ?').bind(id), // the verdict consumes the run: a new decision needs a new preview
  ]);
  return detail(env, teacherId, id);
}

export async function publishAssessment(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  const body = parse(publishAssessmentSchema, await readJson(req));
  if (a.status === 'archived') throw new HttpError(409, 'assessment_archived', 'این آزمون آرشیو شده است.');
  if (a.status !== 'published') {
    if (a.status !== 'ready_to_publish' || !a.teacher_approved_at || !a.previewed_at)
      throw new HttpError(409, 'teacher_approval_required', a.preview_feedback === 'too_hard' || a.preview_feedback === 'needs_edit'
        ? 'آزمون نیاز به ویرایش دارد. آن را ویرایش و دوباره آزمایش کنید.' : 'این آزمون هنوز آزمایش و تأیید نشده است. ابتدا آن را آزمایش کنید.');
    const problems = assessmentProblems(a, await loadQuestions(env.DB, id));
    if (problems.length) throw new HttpError(422, 'assessment_invalid', problems[0], { problems });
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare("UPDATE assessments SET status='published', published_at=?, updated_at=? WHERE id=? AND teacher_id=? AND status='ready_to_publish'").bind(now, now, id, teacherId),
      env.DB.prepare('DELETE FROM assessment_preview_sessions WHERE assessment_id = ?').bind(id),
    ]);
  }
  if (body.classId) return assignAssessmentTo(env, teacherId, id, body.classId, body.studentIds);
  return detail(env, teacherId, id);
}

// ───────────────────────── assignment (class / selected students) ─────────────────────────

async function assignAssessmentTo(env: Env, teacherId: string, id: string, classId: string, studentIds: 'all' | string[]) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  if (a.status !== 'published') throw new HttpError(409, 'not_published', 'ابتدا آزمون را منتشر کنید.');
  const cls = await getOwnedClass(env.DB, teacherId, classId); // ownership: a foreign class is a 404
  if (cls.archived_at) throw new HttpError(409, 'class_archived', 'این کلاس آرشیو شده است. ابتدا آن را از آرشیو خارج کنید.');
  const chosen = await chooseStudents(env, teacherId, classId, studentIds);
  const have = new Set((await env.DB.prepare('SELECT student_id FROM assessment_students WHERE assessment_id = ?').bind(id).all<{ student_id: string }>()).results.map((r) => r.student_id));
  const now = nowIso();
  await env.DB.batch(chosen.filter((s) => !have.has(s.id)).map((s) =>
    env.DB.prepare('INSERT INTO assessment_students (id,assessment_id,student_id,class_id,token,status,assigned_at) VALUES (?,?,?,?,?,?,?)').bind(newId(), id, s.id, classId, newPlayToken(), 'pending', now)));
  const rows = await env.DB.prepare(
    `SELECT x.student_id, x.token, x.status, s.display_name FROM assessment_students x JOIN students s ON s.id = x.student_id WHERE x.assessment_id = ? AND x.class_id = ? AND x.student_id IN (${chosen.map(() => '?').join(',')}) ORDER BY s.display_name`,
  ).bind(id, classId, ...chosen.map((c) => c.id)).all<any>();
  const out = await (await detail(env, teacherId, id)).json() as Record<string, unknown>;
  return json({ ...out, links: rows.results.map((r) => ({ studentId: r.student_id, name: r.display_name, token: r.token, url: playUrl(env, r.token), status: r.status })) }, 200);
}
export async function assignAssessment(req: Request, env: Env, teacherId: string, id: string) {
  const b = parse(assignSchema, await readJson(req));
  return assignAssessmentTo(env, teacherId, id, b.classId, b.studentIds);
}

// ───────────────────────── reports ─────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Test analysis, not a ranking: counts, mean, range and per-question correctness. No names, no order of students. */
export async function assessmentReport(env: Env, teacherId: string, id: string) {
  const a = await getOwnedAssessment(env.DB, teacherId, id);
  const c = await counts(env.DB, id);
  const res = await env.DB.prepare(
    `SELECT r.percent, r.correct, r.total, r.duration_ms FROM assessment_results r JOIN assessment_attempts t ON t.id = r.attempt_id WHERE t.assessment_id = ?`,
  ).bind(id).all<{ percent: number; correct: number; total: number; duration_ms: number | null }>();
  const n = res.results.length;
  const qs = await loadQuestions(env.DB, id);
  const per = await env.DB.prepare(
    `SELECT question_id, COUNT(*) AS rows_n, SUM(is_correct) AS ok, SUM(CASE WHEN selected_answer IS NULL AND answer_text IS NULL THEN 1 ELSE 0 END) AS none
       FROM assessment_answers WHERE assessment_id = ? GROUP BY question_id`,
  ).bind(id).all<{ question_id: string; rows_n: number; ok: number | null; none: number | null }>();
  const byQ = new Map(per.results.map((p) => [p.question_id, p]));
  const durations = res.results.map((r) => r.duration_ms).filter((d): d is number => d != null);
  return json({
    assessment: assessmentDto(a, c),
    participants: n, assigned: c.assigned, started: c.touched, notFinished: Math.max(0, c.assigned - c.completed),
    sufficientData: n > 0,
    averagePercent: n ? r1(res.results.reduce((t, r) => t + r.percent, 0) / n) : null,
    averageCorrect: n ? r1(res.results.reduce((t, r) => t + r.correct, 0) / n) : null,
    highestPercent: n ? Math.max(...res.results.map((r) => r.percent)) : null,
    lowestPercent: n ? Math.min(...res.results.map((r) => r.percent)) : null,
    averageMinutes: durations.length ? r1(durations.reduce((t, d) => t + d, 0) / durations.length / 60000) : null,
    questions: qs.map((q) => {
      const p = byQ.get(q.id), ok = p?.ok ?? 0, none = p?.none ?? 0, rows = p?.rows_n ?? 0;
      return { questionId: q.id, position: q.position, type: q.type, typeLabel: QUESTION_TYPE_LABELS_FA[q.type], text: q.text, answered: rows - none, correct: ok, incorrect: rows - none - ok, unanswered: none, percentCorrect: rows ? r1((ok / rows) * 100) : null };
    }),
    notice: 'این گزارش برای تحلیل خود آزمون است؛ رتبه‌بندی یا مقایسهٔ دانش‌آموزان نمایش داده نمی‌شود.',
  });
}

/** «آزمون‌های معلم» section of one student. Deliberately separate from the cognitive profile; never mixed into its numbers. */
export async function studentAssessments(env: Env, teacherId: string, studentId: string) {
  const s = await getOwnedStudent(env.DB, teacherId, studentId);
  const { results } = await env.DB.prepare(
    `SELECT a.id AS assessment_id, a.title, a.subject, a.version, x.status, x.assigned_at, x.completed_at,
            r.total, r.correct, r.unanswered, r.percent, r.duration_ms
       FROM assessment_students x JOIN assessments a ON a.id = x.assessment_id
       LEFT JOIN assessment_attempts t ON t.assessment_student_id = x.id LEFT JOIN assessment_results r ON r.attempt_id = t.id
      WHERE x.student_id = ? AND a.teacher_id = ? ORDER BY COALESCE(x.completed_at, x.assigned_at) DESC`,
  ).bind(studentId, teacherId).all<any>();
  const label: Record<string, string> = { pending: 'شروع نشده', started: 'در حال انجام', completed: 'انجام شده' };
  return json({
    student: { id: s.id, name: s.display_name }, section: 'teacher_assessments', title: 'آزمون‌های معلم',
    assessments: results.map((r) => {
      const done = r.status === 'completed' && r.total != null;
      return {
        assessmentId: r.assessment_id, title: r.title, subject: r.subject ?? null, version: r.version, status: r.status, statusLabel: label[r.status] ?? r.status,
        date: r.completed_at ?? r.assigned_at, questionCount: done ? r.total : null, correct: done ? r.correct : null, unanswered: done ? r.unanswered : null,
        percent: done ? r.percent : null, minutes: done && r.duration_ms != null ? Math.max(1, Math.round(r.duration_ms / 60000)) : null,
      };
    }),
    notice: 'نمرهٔ آزمون‌های معلم، سنجش درسی است و در پروفایل شناختی یادبین (حافظه، توجه، حل مسئله…) هیچ نقشی ندارد.',
  });
}

/** Statements that erase every assessment record of one student / of one class (used by the explicit «delete data» flows). */
export function eraseAssessmentDataForStudent(db: D1Database, studentId: string) {
  const ast = '(SELECT id FROM assessment_students WHERE student_id = ?)', att = `(SELECT id FROM assessment_attempts WHERE assessment_student_id IN ${ast})`;
  return [
    db.prepare(`DELETE FROM assessment_answers WHERE attempt_id IN ${att}`).bind(studentId),
    db.prepare(`DELETE FROM assessment_results WHERE attempt_id IN ${att}`).bind(studentId),
    db.prepare(`DELETE FROM assessment_attempts WHERE assessment_student_id IN ${ast}`).bind(studentId),
    db.prepare('DELETE FROM assessment_students WHERE student_id = ?').bind(studentId),
  ];
}
export function eraseAssessmentDataForClass(db: D1Database, classId: string) {
  const ast = '(SELECT id FROM assessment_students WHERE class_id = ?)', att = `(SELECT id FROM assessment_attempts WHERE assessment_student_id IN ${ast})`;
  return [
    db.prepare(`DELETE FROM assessment_answers WHERE attempt_id IN ${att}`).bind(classId),
    db.prepare(`DELETE FROM assessment_results WHERE attempt_id IN ${att}`).bind(classId),
    db.prepare(`DELETE FROM assessment_attempts WHERE assessment_student_id IN ${ast}`).bind(classId),
    db.prepare('DELETE FROM assessment_students WHERE class_id = ?').bind(classId),
  ];
}
