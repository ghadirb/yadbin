import type { Env } from '../env';
import { gradeAnswer, percentOf, studentView, type StoredQuestion } from '../assessments/grading';
import { answerSubmitSchema } from '../assessments/schemas';
import { loadQuestions, previewSummary } from './assessments';
import { PREVIEW_TTL_MS } from '../services/preview';
import { HttpError, json, readJson } from '../utils/http';
import { newId, nowIso, TOKEN_RE } from '../utils/ids';
import { rateLimit, rateLimitIp } from '../utils/ratelimit';
import { parse } from '../validation/schemas';

/** Student side + teacher preview of Teacher Assessments. They share the URLs of activities (/play/{token}, /preview/{token}):
 *  every handler returns `null` when the token is not an assessment token, and the caller then falls through to the activity code. */

interface Row { ast_id: string; student_id: string; ast_status: string; assessment_id: string; a_status: string; version: number; title: string; subject: string | null; description: string | null; suggested_minutes: number | null }
async function byToken(env: Env, token: string): Promise<Row | null> {
  if (!TOKEN_RE.test(token)) return null;
  return env.DB.prepare(
    `SELECT x.id AS ast_id, x.student_id, x.status AS ast_status, x.assessment_id, a.status AS a_status, a.version, a.title, a.subject, a.description, a.suggested_minutes
       FROM assessment_students x JOIN assessments a ON a.id = x.assessment_id WHERE x.token = ?`,
  ).bind(token).first<Row>();
}
const payloadOf = (row: { title: string; subject: string | null; description?: string | null; suggested_minutes: number | null }, qs: StoredQuestion[]) => ({
  title: row.title, subject: row.subject ?? null, description: row.description ?? null, questionCount: qs.length, suggestedMinutes: row.suggested_minutes ?? null, questions: qs.map(studentView),
});

/** Returns only what the child needs: no correct answers, no explanations, no names, no ids of teacher/class/student. */
export async function getPlay(env: Env, token: string, req?: Request): Promise<Response | null> {
  const row = await byToken(env, token);
  if (!row) return null;
  if (req) await rateLimitIp(env, req, 'play', 600, 60);
  await rateLimit(env, `play:token:${token}`, 200, 3600);
  if (row.ast_status === 'completed') return json({ kind: 'teacher_assessment', status: 'completed', message: 'این آزمون قبلاً انجام شده است.' });
  // an archived assessment cannot be started, but a child who already started it may still finish (their answers must not be lost)
  if (row.a_status === 'archived' && row.ast_status !== 'started') throw new HttpError(410, 'canceled', 'این آزمون دیگر فعال نیست.');
  if (row.a_status !== 'published' && row.a_status !== 'archived') throw new HttpError(403, 'not_published', 'این آزمون هنوز منتشر نشده است.');

  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO assessment_attempts (id, assessment_student_id, assessment_id, assessment_version, started_at, status) VALUES (?,?,?,?,?,?)').bind(newId(), row.ast_id, row.assessment_id, row.version, now, 'started'),
    env.DB.prepare("UPDATE assessment_students SET status = 'started', started_at = ? WHERE id = ? AND status = 'pending'").bind(now, row.ast_id),
  ]);
  const attempt = await env.DB.prepare('SELECT id, started_at FROM assessment_attempts WHERE assessment_student_id = ?').bind(row.ast_id).first<{ id: string; started_at: string }>();
  if (!attempt) throw new HttpError(500, 'session_error', 'خطا در شروع آزمون.');
  const qs = await loadQuestions(env.DB, row.assessment_id); // a published version is immutable → refresh gives the same questions in the same order
  return json({ kind: 'teacher_assessment', status: attempt.started_at === now ? 'ready' : 'resume', session: { id: attempt.id, startedAt: attempt.started_at }, assessment: payloadOf(row, qs) });
}

const clampMs = (v: number | undefined, lo: number, hi: number) => (v === undefined || !Number.isFinite(v) ? null : Math.max(lo, Math.min(hi, Math.round(v))));

/** Grades on the server (the client never sees the key). Idempotent: one result per attempt; re-sending (retry, double tap, reconnect) is harmless. */
export async function completePlay(req: Request, env: Env, token: string): Promise<Response | null> {
  const row = await byToken(env, token);
  if (!row) return null;
  await rateLimitIp(env, req, 'play', 600, 60);
  await rateLimit(env, `complete:token:${token}`, 60, 3600);
  const body = parse(answerSubmitSchema, await readJson(req));
  const attempt = await env.DB.prepare('SELECT id, status, started_at FROM assessment_attempts WHERE id = ? AND assessment_student_id = ?').bind(body.sessionId, row.ast_id).first<{ id: string; status: string; started_at: string }>();
  if (!attempt) throw new HttpError(404, 'invalid_session', 'جلسه معتبر نیست.');
  const dup = { ok: true, kind: 'teacher_assessment', duplicate: true, message: 'این آزمون قبلاً ارسال شده است.' };
  if (attempt.status === 'completed') return json(dup);

  const qs = await loadQuestions(env.DB, row.assessment_id);
  const given = new Map<string, (typeof body.answers)[number]>();
  for (const a of body.answers) if (!given.has(a.questionId)) given.set(a.questionId, a); // first answer per question wins; unknown ids are ignored below
  const now = nowIso(), startMs = Date.parse(attempt.started_at), nowMs = Date.now();
  let correct = 0, unanswered = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const q of qs) {
    const a = given.get(q.id);
    const g = gradeAnswer(q, a?.answer);
    if (!g.answered) unanswered++; else if (g.correct) correct++;
    const at = a?.answeredAt !== undefined && a.answeredAt >= startMs - 1000 && a.answeredAt <= nowMs + 1000 ? new Date(a.answeredAt).toISOString() : now; // clock-skew safe
    stmts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO assessment_answers (attempt_id, assessment_id, assessment_version, question_id, selected_answer, answer_text, is_correct, response_time_ms, answered_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).bind(attempt.id, row.assessment_id, row.version, q.id, g.selected, g.text, g.answered && g.correct ? 1 : 0, g.answered ? clampMs(a?.responseTimeMs, 0, 3600_000) : null, g.answered ? at : null));
  }
  if (qs.length && unanswered === qs.length && body.answers.length === 0) throw new HttpError(422, 'no_valid_events', 'نتیجه معتبر نیست.');
  const res = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO assessment_results (attempt_id, total, correct, unanswered, percent, duration_ms, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(attempt.id, qs.length, correct, unanswered, percentOf(correct, qs.length), clampMs(body.durationMs, 0, 4 * 3600_000), now),
    ...stmts,
    env.DB.prepare("UPDATE assessment_attempts SET status = 'completed', completed_at = ? WHERE id = ? AND status != 'completed'").bind(now, attempt.id),
    env.DB.prepare("UPDATE assessment_students SET status = 'completed', completed_at = ? WHERE id = ? AND status != 'completed'").bind(now, row.ast_id),
  ]);
  if ((res[0].meta?.changes ?? 0) === 0) return json(dup); // lost a race with an identical submission: the stored result stays
  // Neutral message: the product shows children no score or comparison. The teacher sees the result.
  return json({ ok: true, kind: 'teacher_assessment', duplicate: false, message: 'آزمون ارسال شد. دستت درد نکند!' });
}

// ───────────────────────── teacher preview ─────────────────────────

interface PRow { id: string; assessment_id: string; token: string; status: string; started_at: string; content_rev: number; title: string; subject: string | null; description: string | null; suggested_minutes: number | null; grade_code: string | null; level: string | null; a_rev: number }
async function previewByToken(env: Env, token: string): Promise<PRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = await env.DB.prepare(
    `SELECT p.id, p.assessment_id, p.token, p.status, p.started_at, p.content_rev, a.title, a.subject, a.description, a.suggested_minutes, a.grade_code, a.level, a.content_rev AS a_rev
       FROM assessment_preview_sessions p JOIN assessments a ON a.id = p.assessment_id WHERE p.token = ?`,
  ).bind(token).first<PRow>();
  if (!row) return null;
  if (Date.parse(row.started_at) + PREVIEW_TTL_MS < Date.now()) throw new HttpError(410, 'expired', 'این لینک آزمایش منقضی شده است. دوباره «آزمایش آزمون» را بزنید.');
  return row;
}

/** Same questions, same order, same screens a student gets. Creates NO student, attempt, answer or result. */
export async function getPreview(env: Env, token: string, req?: Request): Promise<Response | null> {
  const row = await previewByToken(env, token);
  if (!row) return null;
  if (req) await rateLimitIp(env, req, 'preview', 120, 60);
  await rateLimit(env, `preview:token:${token}`, 120, 3600);
  if (row.status === 'completed') return json({ kind: 'teacher_assessment', status: 'completed', preview: true, message: 'آزمایش قبلاً انجام شده است.' });
  const qs = await loadQuestions(env.DB, row.assessment_id);
  return json({
    kind: 'teacher_assessment', status: 'ready', preview: true, session: { id: row.id, startedAt: row.started_at }, assessment: payloadOf(row, qs),
    summary: previewSummary(row, qs.length),
  });
}

/** Simulated result for the TEACHER (with the key and explanations). Only the preview session row is touched. */
export async function completePreview(req: Request, env: Env, token: string): Promise<Response | null> {
  const row = await previewByToken(env, token);
  if (!row) return null;
  const body = parse(answerSubmitSchema, await readJson(req));
  if (body.sessionId !== row.id) throw new HttpError(404, 'invalid_session', 'جلسه معتبر نیست.');
  if (row.status === 'completed') return json({ ok: true, preview: true, duplicate: true });
  const qs = await loadQuestions(env.DB, row.assessment_id);
  const given = new Map(body.answers.map((a) => [a.questionId, a]));
  let correct = 0, unanswered = 0;
  const items = qs.map((q) => {
    const g = gradeAnswer(q, given.get(q.id)?.answer);
    if (!g.answered) unanswered++; else if (g.correct) correct++;
    return { questionId: q.id, position: q.position, answered: g.answered, isCorrect: g.answered && g.correct, correctAnswer: q.type === 'fill_blank' ? (q.correct as string[]).join(' / ') : q.correct, explanation: q.explanation, sourceReference: q.sourceReference ?? null };
  });
  // Only valid for the revision that ran: if the teacher edited in the meantime the session row is gone and nothing is marked.
  await env.DB.prepare("UPDATE assessment_preview_sessions SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'started' AND content_rev = (SELECT content_rev FROM assessments WHERE id = ?)").bind(nowIso(), row.id, row.assessment_id).run();
  return json({ ok: true, preview: true, duplicate: false, result: { total: qs.length, correct, unanswered, percent: percentOf(correct, qs.length), items } });
}
