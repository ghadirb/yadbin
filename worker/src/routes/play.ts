import type { Env } from '../env';
import { buildPools, MODE_TO_LEVEL, type DifficultyMode } from '../questions/generate';
import { PROBLEM_BY_ID } from '../questions/bank';
import { computeAge, gradeByOrder, inferGradeOrder } from '../education/catalog';
import { tuningFor, tuningFromRow } from '../education/tuning';
import { recomputeStudentMetrics } from '../services/metrics';
import { scoreAttention, scoreMemory, scoreProblemSolving, type GameMetrics, type GameType } from '../scoring';
import { HttpError, json, readJson } from '../utils/http';
import { newId, nowIso, TOKEN_RE } from '../utils/ids';
import { rateLimit, rateLimitIp } from '../utils/ratelimit';
import { attentionEventSchema, completeSchema, memoryEventSchema, parse, problemEventSchema } from '../validation/schemas';

/** Encouraging, non-numeric feedback for the child (spec 4.2). Never a score, never a comparison. */
export function childFeedback(accuracy: number | null) {
  const level = accuracy === null ? 'good' : accuracy >= 0.8 ? 'great' : accuracy >= 0.5 ? 'good' : 'keep_going';
  const performance = level === 'great' ? 'عملکرد خیلی خوب بود.' : level === 'good' ? 'عملکرد خوب بود.' : 'تمرین بیشتر کمک می‌کند؛ تلاشت عالی بود.';
  return { level, lines: ['فعالیت کامل شد.', performance, 'می‌توانی مرحله بعد را امتحان کنی.'] };
}

const INVALID = () => new HttpError(404, 'invalid_token', 'این لینک معتبر نیست.');
const INACTIVE = () => new HttpError(410, 'canceled', 'این فعالیت دیگر فعال نیست.');
const EXPIRED = () => new HttpError(410, 'expired', 'این فعالیت دیگر فعال نیست.\nاز معلم درخواست فعالیت جدید کنید.');

interface PlayRow {
  ast_id: string; student_id: string; token: string; ast_status: string;
  game_type: GameType; difficulty_mode: DifficultyMode; question_count: number; act_status: string; publish_state: string | null; requires_preview: number; expires_at: string | null;
}
async function loadByToken(env: Env, token: string): Promise<PlayRow> {
  if (!TOKEN_RE.test(token)) throw INVALID(); // cheap reject before touching the DB
  const row = await env.DB.prepare(
    `SELECT ast.id AS ast_id, ast.student_id, ast.token, ast.status AS ast_status,
            a.game_type, a.difficulty_mode, a.question_count, a.status AS act_status, a.publish_state, a.requires_preview, a.expires_at
       FROM activity_students ast JOIN activities a ON a.id = ast.activity_id WHERE ast.token = ?`,
  ).bind(token).first<PlayRow>();
  if (!row) throw INVALID();
  return row;
}

/** Student grade (own → class) and age + the activity's level/range → tuning band. Missing data → 0 (identical to v1.1). */
async function computeTuning(env: Env, row: PlayRow) {
  const r = await env.DB.prepare(
    `SELECT s.*, a.activity_level AS lvl, a.grade_min AS gmin, a.grade_max AS gmax,
            (SELECT c.grade_order FROM class_students cs JOIN classes c ON c.id = cs.class_id WHERE cs.student_id = s.id AND cs.removed_at IS NULL ORDER BY cs.added_at DESC LIMIT 1) AS class_order
       FROM activity_students ast JOIN students s ON s.id = ast.student_id JOIN activities a ON a.id = ast.activity_id WHERE ast.id = ?`,
  ).bind(row.ast_id).first<any>();
  if (!r) return 0;
  const gradeOrder = r.grade_order ?? inferGradeOrder(r.grade) ?? r.class_order ?? null;
  return tuningFor({ gradeOrder: gradeByOrder(gradeOrder) ? gradeOrder : null, age: computeAge(r).age, level: r.lvl, gradeMin: r.gmin, gradeMax: r.gmax });
}

function levelsFor(mode: DifficultyMode): (1 | 2 | 3)[] {
  return mode === 'adaptive' ? [1, 2, 3] : [MODE_TO_LEVEL[mode]];
}
async function startDifficulty(env: Env, row: PlayRow): Promise<1 | 2 | 3> {
  if (row.difficulty_mode !== 'adaptive') return MODE_TO_LEVEL[row.difficulty_mode];
  const last = await env.DB.prepare(
    `SELECT r.difficulty_reached AS d, r.accuracy AS acc FROM game_results r
       JOIN game_sessions s ON s.id = r.session_id JOIN activity_students a ON a.id = s.activity_student_id
      WHERE a.student_id = ? AND s.game_type = ? ORDER BY r.created_at DESC LIMIT 1`,
  ).bind(row.student_id, row.game_type).first<{ d: number; acc: number | null }>();
  if (!last) return 1;
  const d = last.acc !== null && last.acc < 0.5 ? last.d - 1 : last.d;
  return Math.max(1, Math.min(3, d)) as 1 | 2 | 3;
}

/** Returns only what the game needs. No names, ids of teacher/class/student, or other students' data. */
// Per-IP ceiling is deliberately high: a whole school class usually shares ONE public IP (school Wi-Fi / mobile CGNAT).
// Abuse is bounded per token below (200 GET/h, 60 POST/h per token).
export async function getPlay(env: Env, token: string, req?: Request) {
  if (req) await rateLimitIp(env, req, 'play', 600, 60);
  const row = await loadByToken(env, token);
  await rateLimit(env, `play:token:${token}`, 200, 3600);
  if (row.act_status === 'canceled') throw INACTIVE();
  if (row.requires_preview && row.publish_state !== 'published') throw new HttpError(403, 'not_published', 'این فعالیت هنوز منتشر نشده است.');
  if (row.ast_status === 'completed') return json({ status: 'completed', message: 'این فعالیت قبلاً انجام شده است.' });
  if (row.expires_at && row.expires_at < nowIso()) throw EXPIRED();

  const now = nowIso();
  // v1.2: difficulty tuning from the student's grade/age + the activity level, computed ONCE when the session is created.
  const existing = await env.DB.prepare('SELECT id FROM game_sessions WHERE activity_student_id = ?').bind(row.ast_id).first();
  const tuning = existing ? 0 : await computeTuning(env, row);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO game_sessions (id, activity_student_id, game_type, started_at, status, tuning) VALUES (?,?,?,?,?,?)')
      .bind(newId(), row.ast_id, row.game_type, now, 'started', tuning),
    env.DB.prepare("UPDATE activity_students SET status = 'started', started_at = ? WHERE id = ? AND status = 'pending'").bind(now, row.ast_id),
  ]);
  const session = await env.DB.prepare('SELECT id, started_at, tuning FROM game_sessions WHERE activity_student_id = ?').bind(row.ast_id).first<{ id: string; started_at: string; tuning: number | null }>();
  if (!session) throw new HttpError(500, 'session_error', 'خطا در شروع جلسه.');

  const seed = session.id; // deterministic pools => resume gives the same questions
  return json({
    status: session.started_at === now ? 'ready' : 'resume',
    session: { id: session.id, startedAt: session.started_at },
    game: row.game_type,
    difficultyMode: row.difficulty_mode,
    questionCount: row.question_count,
    startDifficulty: await startDifficulty(env, row),
    seed,
    pools: buildPools(row.game_type, seed, levelsFor(row.difficulty_mode), row.question_count, tuningFromRow(session.tuning)),
    version: 1,
  });
}

interface PreviewRow {
  id: string; activity_id: string; teacher_id: string; token: string; status: string; started_at: string; tuning: number;
  game_type: GameType; difficulty_mode: DifficultyMode; question_count: number;
}
async function loadPreview(env: Env, token: string): Promise<PreviewRow> {
  if (!TOKEN_RE.test(token)) throw INVALID();
  const row = await env.DB.prepare(`SELECT p.*, a.game_type, a.difficulty_mode, a.question_count
    FROM teacher_preview_sessions p JOIN activities a ON a.id = p.activity_id WHERE p.token = ?`).bind(token).first<PreviewRow>();
  if (!row) throw INVALID();
  return row;
}

/** Uses the production question generator without creating a student session or result. */
export async function getPreview(env: Env, token: string, req?: Request) {
  if (req) await rateLimitIp(env, req, 'preview', 120, 60);
  const row = await loadPreview(env, token);
  await rateLimit(env, `preview:token:${token}`, 120, 3600);
  if (row.status === 'completed') return json({ status: 'completed', message: 'آزمایش قبلاً انجام شده است.' });
  return json({
    status: 'ready', session: { id: row.id, startedAt: row.started_at }, game: row.game_type,
    difficultyMode: row.difficulty_mode, questionCount: row.question_count,
    startDifficulty: row.difficulty_mode === 'adaptive' ? 1 : MODE_TO_LEVEL[row.difficulty_mode], seed: row.id,
    pools: buildPools(row.game_type, row.id, levelsFor(row.difficulty_mode), row.question_count, tuningFromRow(row.tuning)),
    version: 1, preview: true,
  });
}

export async function completePreview(req: Request, env: Env, token: string) {
  const row = await loadPreview(env, token);
  const body = parse(completeSchema, await readJson(req));
  if (body.sessionId !== row.id) throw new HttpError(404, 'invalid_session', 'جلسه معتبر نیست.');
  if (row.status === 'completed') return json({ ok: true, duplicate: true });
  const { metrics } = scoreEvents(row.game_type, body.events, row.id, row.difficulty_mode, row.question_count, row.tuning);
  if (metrics.sampleCount < 1) throw new HttpError(422, 'no_valid_events', 'نتیجه معتبر نیست.');
  await env.DB.prepare("UPDATE teacher_preview_sessions SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'started'").bind(nowIso(), row.id).run();
  return json({ ok: true, duplicate: false, preview: true, feedback: childFeedback(metrics.accuracy) });
}

function scoreEvents(game: GameType, rawEvents: unknown[], seed: string, mode: DifficultyMode, count: number, tuning = 0): { metrics: GameMetrics; events: unknown[]; ignored: number } {
  const ok: any[] = [];
  if (game === 'memory' || game === 'attention') {
    const schema = game === 'memory' ? memoryEventSchema : attentionEventSchema;
    for (const e of rawEvents) { const r = schema.safeParse(e); if (r.success) ok.push(r.data); }
    return { metrics: game === 'memory' ? scoreMemory(ok) : scoreAttention(ok), events: ok, ignored: rawEvents.length - ok.length };
  }
  // Problem solving: correctness is derived on the server from this session's own (seeded, shuffled) pools.
  const truth = new Map<string, { correctOption: number; difficulty: number }>();
  const pools = buildPools('problem_solving', seed, levelsFor(mode), count, tuningFromRow(tuning)) as Record<string, any[]>;
  for (const list of Object.values(pools)) for (const q of list) truth.set(q.id, { correctOption: q.correctOption, difficulty: q.difficulty });
  const seen = new Set<string>();
  for (const e of rawEvents) {
    const r = problemEventSchema.safeParse(e);
    if (!r.success) continue;
    const t = truth.get(r.data.questionId);
    if (!t || !PROBLEM_BY_ID.has(r.data.questionId) || seen.has(r.data.questionId)) continue;
    seen.add(r.data.questionId);
    ok.push({ ...r.data, difficulty: t.difficulty, correct: r.data.finalAnswer === t.correctOption });
  }
  return { metrics: scoreProblemSolving(ok), events: ok, ignored: rawEvents.length - ok.length };
}

/** Idempotent: one valid result per session. A repeated submission returns the stored outcome without creating a duplicate. */
export async function completePlay(req: Request, env: Env, token: string) {
  await rateLimitIp(env, req, 'play', 600, 60);
  const row = await loadByToken(env, token);
  await rateLimit(env, `complete:token:${token}`, 60, 3600);
  if (row.act_status === 'canceled') throw INACTIVE();
  const body = parse(completeSchema, await readJson(req));

  const session = await env.DB.prepare('SELECT id, status, tuning FROM game_sessions WHERE id = ? AND activity_student_id = ?').bind(body.sessionId, row.ast_id).first<{ id: string; status: string; tuning: number | null }>();
  if (!session) throw new HttpError(404, 'invalid_session', 'جلسه معتبر نیست.');
  const doneMsg = { ok: true, duplicate: true, message: 'این فعالیت قبلاً انجام شده است.' };
  if (session.status === 'completed') return json(doneMsg);
  // A session that started before expiry may still finish/sync afterwards (offline play) — the data must not be lost.

  const { metrics, events, ignored } = scoreEvents(row.game_type, body.events, session.id, row.difficulty_mode, row.question_count, session.tuning ?? 0);
  if (metrics.sampleCount < 1) throw new HttpError(422, 'no_valid_events', 'نتیجه معتبر نیست.');

  const prev = await env.DB.prepare(
    `SELECT r.accuracy AS acc FROM game_results r JOIN game_sessions s ON s.id = r.session_id
       JOIN activity_students a ON a.id = s.activity_student_id WHERE a.student_id = ? AND s.game_type = ?
      ORDER BY r.created_at DESC LIMIT 1`,
  ).bind(row.student_id, row.game_type).first<{ acc: number | null }>();
  const improvement = prev?.acc != null && metrics.accuracy != null ? Math.round((metrics.accuracy - prev.acc) * 10000) / 10000 : null;

  const now = nowIso();
  const raw = JSON.stringify({ events, computed: metrics, meta: { ignoredEvents: ignored, durationMs: body.durationMs ?? null } });
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO game_results (session_id, accuracy, average_response_time, difficulty_reached, hints_used, independence_score, help_response_score, improvement_score, sample_count, raw_result_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(session.id, metrics.accuracy, metrics.averageResponseTime, metrics.difficultyReached, metrics.hintsUsed, metrics.independenceScore, metrics.helpResponseScore, improvement, metrics.sampleCount, raw, now),
    env.DB.prepare("UPDATE game_sessions SET status = 'completed', completed_at = ? WHERE id = ? AND status != 'completed'").bind(now, session.id),
    env.DB.prepare("UPDATE activity_students SET status = 'completed', completed_at = ? WHERE id = ? AND status != 'completed'").bind(now, row.ast_id),
  ]);
  if ((ins.meta?.changes ?? 0) === 0) return json(doneMsg); // lost a race with an identical submission: keep the stored result

  await recomputeStudentMetrics(env.DB, row.student_id, row.game_type);
  return json({ ok: true, duplicate: false, message: 'آفرین! فعالیت تمام شد.', feedback: childFeedback(metrics.accuracy) }); // no numeric score for the child
}

/** The child's own progress, reachable only with their own link. Returns no name, no ids, no other student's data, no scores. */
export async function getProgress(env: Env, token: string, req?: Request) {
  if (req) await rateLimitIp(env, req, 'play', 600, 60);
  const row = await loadByToken(env, token);
  await rateLimit(env, `progress:token:${token}`, 120, 3600);
  const { results } = await env.DB.prepare(
    `SELECT a.game_type AS game, COUNT(*) AS n, MAX(ast.completed_at) AS last_at,
            SUM(CASE WHEN r.accuracy >= 0.7 THEN 1 ELSE 0 END) AS good
       FROM activity_students ast JOIN activities a ON a.id = ast.activity_id
       LEFT JOIN game_sessions gs ON gs.activity_student_id = ast.id LEFT JOIN game_results r ON r.session_id = gs.id
      WHERE ast.student_id = ? AND ast.status = 'completed' GROUP BY a.game_type`,
  ).bind(row.student_id).all<{ game: string; n: number; last_at: string | null; good: number | null }>();
  const names: Record<string, string> = { memory: 'به خاطر بسپار', attention: 'پیداش کن', problem_solving: 'راهش را پیدا کن' };
  const total = results.reduce((t, r) => t + r.n, 0);
  return json({
    completedActivities: total,
    games: results.map((r) => ({ game: r.game, gameName: names[r.game], completed: r.n, goodRuns: r.good ?? 0, lastAt: r.last_at })),
    message: total === 0 ? 'هنوز فعالیتی تمام نکرده‌ای. شروع کن!' : `تا حالا ${total} فعالیت را تمام کرده‌ای. ادامه بده!`,
  });
}
