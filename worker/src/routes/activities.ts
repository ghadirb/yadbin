import type { Env } from '../env';
import { getOwnedActivity, getOwnedClass } from '../db/queries';
import { HttpError, json, readJson } from '../utils/http';
import { newId, newPlayToken, nowIso } from '../utils/ids';
import { activitySchema, parse } from '../validation/schemas';

const playUrl = (env: Env, token: string) => `${(env.PLAY_BASE_URL || '').replace(/\/$/, '')}/play/${token}`;
const DEFAULT_EXPIRY_DAYS = 30;

export async function createActivity(req: Request, env: Env, teacherId: string) {
  const b = parse(activitySchema, await readJson(req));
  await getOwnedClass(env.DB, teacherId, b.classId);
  const active = await env.DB.prepare(
    `SELECT s.id, s.display_name FROM class_students cs JOIN students s ON s.id = cs.student_id
      WHERE cs.class_id = ? AND cs.removed_at IS NULL AND s.teacher_id = ? ORDER BY cs.added_at`,
  ).bind(b.classId, teacherId).all<{ id: string; display_name: string }>();
  const byId = new Map(active.results.map((s) => [s.id, s]));
  let chosen = active.results;
  if (b.studentIds !== 'all') {
    chosen = [];
    for (const id of b.studentIds) {
      const s = byId.get(id);
      if (!s) throw new HttpError(400, 'invalid_student', 'یکی از دانش‌آموزان انتخاب‌شده عضو این کلاس نیست.');
      if (!chosen.includes(s)) chosen.push(s);
    }
  }
  if (!chosen.length) throw new HttpError(400, 'no_students', 'این کلاس دانش‌آموزی ندارد.');

  const id = newId(), now = nowIso();
  const expires = new Date(Date.now() + (b.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 86400_000).toISOString();
  const links = chosen.map((s) => ({ rowId: newId(), studentId: s.id, name: s.display_name, token: newPlayToken() }));
  await env.DB.batch([
    env.DB.prepare('INSERT INTO activities (id,teacher_id,class_id,game_type,difficulty_mode,question_count,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, teacherId, b.classId, b.gameType, b.difficultyMode, b.questionCount, 'active', now, expires),
    ...links.map((l) => env.DB.prepare('INSERT INTO activity_students (id,activity_id,student_id,token,status) VALUES (?,?,?,?,?)').bind(l.rowId, id, l.studentId, l.token, 'pending')),
  ]);
  return json({
    activity: { id, classId: b.classId, gameType: b.gameType, difficultyMode: b.difficultyMode, questionCount: b.questionCount, status: 'active', createdAt: now, expiresAt: expires },
    links: links.map((l) => ({ studentId: l.studentId, name: l.name, token: l.token, url: playUrl(env, l.token) })),
  }, 201);
}

export async function getActivity(env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  const rows = await env.DB.prepare(
    `SELECT ast.student_id, ast.token, ast.status, ast.started_at, ast.completed_at, s.display_name
       FROM activity_students ast JOIN students s ON s.id = ast.student_id WHERE ast.activity_id = ? ORDER BY s.display_name`,
  ).bind(id).all<any>();
  return json({
    activity: { id: a.id, classId: a.class_id, gameType: a.game_type, difficultyMode: a.difficulty_mode, questionCount: a.question_count, status: a.status, createdAt: a.created_at, expiresAt: a.expires_at },
    students: rows.results.map((r) => ({ studentId: r.student_id, name: r.display_name, token: r.token, url: playUrl(env, r.token), status: r.status, startedAt: r.started_at, completedAt: r.completed_at })),
  });
}

export async function cancelActivity(env: Env, teacherId: string, id: string) {
  await getOwnedActivity(env.DB, teacherId, id);
  await env.DB.prepare("UPDATE activities SET status = 'canceled' WHERE id = ? AND teacher_id = ?").bind(id, teacherId).run();
  return json({ ok: true });
}
