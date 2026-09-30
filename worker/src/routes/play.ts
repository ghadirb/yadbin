import type { Env } from '../env';
import { buildPools, MODE_TO_LEVEL, type DifficultyMode } from '../questions/generate';
import { PROBLEM_BY_ID } from '../questions/bank';
import { recomputeStudentMetrics } from '../services/metrics';
import { scoreAttention, scoreMemory, scoreProblemSolving, type GameMetrics, type GameType } from '../scoring';
import { HttpError, json, readJson } from '../utils/http';
import { newId, nowIso, TOKEN_RE } from '../utils/ids';
import { rateLimit, rateLimitIp } from '../utils/ratelimit';
import { attentionEventSchema, completeSchema, memoryEventSchema, parse, problemEventSchema } from '../validation/schemas';

const INVALID = () => new HttpError(404, 'invalid_token', 'این لینک معتبر نیست.');
const INACTIVE = () => new HttpError(410, 'canceled', 'این فعالیت دیگر فعال نیست.');
const EXPIRED = () => new HttpError(410, 'expired', 'این فعالیت دیگر فعال نیست.\nاز معلم درخواست فعالیت جدید کنید.');

interface PlayRow {
  ast_id: string; student_id: string; token: string; ast_status: string;
  game_type: GameType; difficulty_mode: DifficultyMode; question_count: number; act_status: string; expires_at: string | null;
}
async function loadByToken(env: Env, token: string): Promise<PlayRow> {
  if (!TOKEN_RE.test(token)) throw INVALID(); // cheap reject before touching the DB
  const row = await env.DB.prepare(
    `SELECT ast.id AS ast_id, ast.student_id, ast.token, ast.status AS ast_status,
            a.game_type, a.difficulty_mode, a.question_count, a.status AS act_status, a.expires_at
       FROM activity_students ast JOIN activities a ON a.id = ast.activity_id WHERE ast.token = ?`,
  ).bind(token).first<PlayRow>();
  if (!row) throw INVALID();
  return row;
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
  if (row.ast_status === 'completed') return json({ status: 'completed', message: 'این فعالیت قبلاً انجام شده است.' });
  if (row.expires_at && row.expires_at < nowIso()) throw EXPIRED();

  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO game_sessions (id, activity_student_id, game_type, started_at, status) VALUES (?,?,?,?,?)')
      .bind(newId(), row.ast_id, row.game_type, now, 'started'),
    env.DB.prepare("UPDATE activity_students SET status = 'started', started_at = ? WHERE id = ? AND status = 'pending'").bind(now, row.ast_id),
  ]);
  const session = await env.DB.prepare('SELECT id, started_at FROM game_sessions WHERE activity_student_id = ?').bind(row.ast_id).first<{ id: string; started_at: string }>();
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
    pools: buildPools(row.game_type, seed, levelsFor(row.difficulty_mode), row.question_count),
    version: 1,
  });
}

function scoreEvents(game: GameType, rawEvents: unknown[], seed: string, mode: DifficultyMode, count: number): { metrics: GameMetrics; events: unknown[]; ignored: number } {
  const ok: any[] = [];
  if (game === 'memory' || game === 'attention') {
    const schema = game === 'memory' ? memoryEventSchema : attentionEventSchema;
    for (const e of rawEvents) { const r = schema.safeParse(e); if (r.success) ok.push(r.data); }
    return { metrics: game === 'memory' ? scoreMemory(ok) : scoreAttention(ok), events: ok, ignored: rawEvents.length - ok.length };
  }
  // Problem solving: correctness is derived on the server from this session's own (seeded, shuffled) pools.
  const truth = new Map<string, { correctOption: number; difficulty: number }>();
  const pools = buildPools('problem_solving', seed, levelsFor(mode), count) as Record<string, any[]>;
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

  const session = await env.DB.prepare('SELECT id, status FROM game_sessions WHERE id = ? AND activity_student_id = ?').bind(body.sessionId, row.ast_id).first<{ id: string; status: string }>();
  if (!session) throw new HttpError(404, 'invalid_session', 'جلسه معتبر نیست.');
  const doneMsg = { ok: true, duplicate: true, message: 'این فعالیت قبلاً انجام شده است.' };
  if (session.status === 'completed') return json(doneMsg);
  // A session that started before expiry may still finish/sync afterwards (offline play) — the data must not be lost.

  const { metrics, events, ignored } = scoreEvents(row.game_type, body.events, session.id, row.difficulty_mode, row.question_count);
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
  return json({ ok: true, duplicate: false, message: 'آفرین! فعالیت تمام شد.' }); // no numeric score for the child
}
