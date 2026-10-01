import type { Env } from '../env';
import { activityDto, GAME_NAMES_FA, getOwnedActivity, getOwnedClass } from '../db/queries';
import { HttpError, json, readJson } from '../utils/http';
import { newId, newPlayToken, nowIso } from '../utils/ids';
import { activitySchema, activityUpdateSchema, duplicateSchema, parse, regenerateSchema } from '../validation/schemas';

const playUrl = (env: Env, token: string) => `${(env.PLAY_BASE_URL || '').replace(/\/$/, '')}/play/${token}`;
const DEFAULT_EXPIRY_DAYS = 30;
const ORDINALS_FA = ['', 'اول', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم', 'هفتم', 'هشتم', 'نهم', 'دهم'];

interface NewActivity {
  classId: string; gameType: string; difficultyMode: string; questionCount: number;
  title: string | null; description: string | null; suggestedMinutes: number | null; expiresInDays?: number;
}

async function assertClassOpen(env: Env, teacherId: string, classId: string) {
  const c = await getOwnedClass(env.DB, teacherId, classId);
  if (c.archived_at) throw new HttpError(409, 'class_archived', 'این کلاس آرشیو شده است. ابتدا آن را از آرشیو خارج کنید.');
  return c;
}

async function chooseStudents(env: Env, teacherId: string, classId: string, studentIds: 'all' | string[]) {
  const active = await env.DB.prepare(
    `SELECT s.id, s.display_name FROM class_students cs JOIN students s ON s.id = cs.student_id
      WHERE cs.class_id = ? AND cs.removed_at IS NULL AND s.teacher_id = ? ORDER BY cs.added_at`,
  ).bind(classId, teacherId).all<{ id: string; display_name: string }>();
  const byId = new Map(active.results.map((s) => [s.id, s]));
  let chosen = active.results;
  if (studentIds !== 'all') {
    chosen = [];
    for (const id of studentIds) {
      const s = byId.get(id);
      if (!s) throw new HttpError(400, 'invalid_student', 'یکی از دانش‌آموزان انتخاب‌شده عضو این کلاس نیست.');
      if (!chosen.includes(s)) chosen.push(s);
    }
  }
  if (!chosen.length) throw new HttpError(400, 'no_students', 'این کلاس دانش‌آموزی ندارد.');
  return chosen;
}

async function insertActivity(env: Env, teacherId: string, a: NewActivity, chosen: { id: string; display_name: string }[]) {
  const id = newId(), now = nowIso();
  const expires = new Date(Date.now() + (a.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 86400_000).toISOString();
  const links = chosen.map((s) => ({ rowId: newId(), studentId: s.id, name: s.display_name, token: newPlayToken() }));
  await env.DB.batch([
    env.DB.prepare('INSERT INTO activities (id,teacher_id,class_id,game_type,difficulty_mode,question_count,status,created_at,expires_at,title,description,suggested_minutes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, teacherId, a.classId, a.gameType, a.difficultyMode, a.questionCount, 'active', now, expires, a.title, a.description, a.suggestedMinutes),
    ...links.map((l) => env.DB.prepare('INSERT INTO activity_students (id,activity_id,student_id,token,status) VALUES (?,?,?,?,?)').bind(l.rowId, id, l.studentId, l.token, 'pending')),
  ]);
  const row = await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first<any>();
  return {
    activity: activityDto(row, links.length, 0),
    links: links.map((l) => ({ studentId: l.studentId, name: l.name, token: l.token, url: playUrl(env, l.token) })),
  };
}

export async function createActivity(req: Request, env: Env, teacherId: string) {
  const b = parse(activitySchema, await readJson(req));
  await assertClassOpen(env, teacherId, b.classId);
  const chosen = await chooseStudents(env, teacherId, b.classId, b.studentIds);
  return json(await insertActivity(env, teacherId, b, chosen), 201);
}

async function counts(env: Env, id: string) {
  const c = await env.DB.prepare(
    `SELECT COUNT(*) AS assigned, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN status!='pending' THEN 1 ELSE 0 END) AS touched
       FROM activity_students WHERE activity_id = ?`,
  ).bind(id).first<{ assigned: number; completed: number | null; touched: number | null }>();
  return { assigned: c?.assigned ?? 0, completed: c?.completed ?? 0, touched: c?.touched ?? 0 };
}

/** GET /activities?classId=&lifecycle=active|ended|archived|all (default: everything not archived). */
export async function listActivities(req: Request, env: Env, teacherId: string) {
  const url = new URL(req.url);
  const classId = url.searchParams.get('classId');
  const want = url.searchParams.get('lifecycle') ?? 'open';
  if (classId) await getOwnedClass(env.DB, teacherId, classId);
  const { results } = await env.DB.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM activity_students x WHERE x.activity_id = a.id) AS assigned_n,
            (SELECT COUNT(*) FROM activity_students x WHERE x.activity_id = a.id AND x.status = 'completed') AS completed_n
       FROM activities a WHERE a.teacher_id = ? ${classId ? 'AND a.class_id = ?' : ''} ORDER BY a.created_at DESC LIMIT 200`,
  ).bind(...(classId ? [teacherId, classId] : [teacherId])).all<any>();
  const all = results.map((a) => activityDto(a, a.assigned_n, a.completed_n));
  const activities = all.filter((a) => (want === 'all' ? true : want === 'open' ? a.lifecycle !== 'archived' : a.lifecycle === want));
  return json({ activities });
}

export async function getActivity(env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  const rows = await env.DB.prepare(
    `SELECT ast.student_id, ast.token, ast.status, ast.started_at, ast.completed_at, s.display_name
       FROM activity_students ast JOIN students s ON s.id = ast.student_id WHERE ast.activity_id = ? ORDER BY s.display_name`,
  ).bind(id).all<any>();
  const c = await counts(env, id);
  return json({
    activity: activityDto(a, c.assigned, c.completed),
    students: rows.results.map((r) => ({ studentId: r.student_id, name: r.display_name, token: r.token, url: playUrl(env, r.token), status: r.status, startedAt: r.started_at, completedAt: r.completed_at })),
  });
}

/** Edit (spec 2.1). Title/description/time/expiry are always editable. Game type never changes.
 *  Difficulty and question count change how the seeded question pool is built, so they are locked once a child has started. */
export async function updateActivity(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  const b = parse(activityUpdateSchema, await readJson(req));
  const c = await counts(env, id);
  const settingsChange = (b.difficultyMode !== undefined && b.difficultyMode !== a.difficulty_mode) || (b.questionCount !== undefined && b.questionCount !== a.question_count);
  if (settingsChange && c.touched > 0)
    throw new HttpError(409, 'activity_in_progress', 'پس از شروع دانش‌آموزان، سطح دشواری و تعداد سؤال قابل تغییر نیست. از «ساخت نسخه جدید» استفاده کنید.');
  const expires = b.expiresInDays !== undefined ? new Date(Date.now() + b.expiresInDays * 86400_000).toISOString() : a.expires_at;
  await env.DB.prepare(
    'UPDATE activities SET title=?, description=?, suggested_minutes=?, difficulty_mode=?, question_count=?, expires_at=? WHERE id=? AND teacher_id=?',
  ).bind(
    b.title !== undefined ? (b.title || null) : a.title,
    b.description !== undefined ? (b.description || null) : a.description,
    b.suggestedMinutes !== undefined ? b.suggestedMinutes : a.suggested_minutes,
    b.difficultyMode ?? a.difficulty_mode, b.questionCount ?? a.question_count, expires, id, teacherId,
  ).run();
  return getActivity(env, teacherId, id);
}

/** "ساخت نسخه جدید" (spec 2.2): same class + settings, fresh links, title "<base> - تمرین دوم". Old results are untouched. */
export async function duplicateActivity(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  const b = parse(duplicateSchema, await readJson(req));
  await assertClassOpen(env, teacherId, a.class_id);
  const base = ((a.title as string | null) || GAME_NAMES_FA[a.game_type] || a.game_type).replace(/\s-\sتمرین\s\S+$/u, '');
  let title = b.title?.trim() || '';
  if (!title) {
    const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM activities WHERE class_id = ? AND teacher_id = ? AND (title = ? OR title LIKE ?)')
      .bind(a.class_id, teacherId, base, `${base} - تمرین %`).first<{ n: number }>())?.n ?? 1;
    const k = Math.max(2, n + 1);
    title = `${base} - تمرین ${ORDINALS_FA[k] ?? k}`;
  }
  const chosen = await chooseStudents(env, teacherId, a.class_id, b.studentIds);
  const out = await insertActivity(env, teacherId, {
    classId: a.class_id, gameType: a.game_type, difficultyMode: a.difficulty_mode, questionCount: a.question_count,
    title, description: a.description, suggestedMinutes: a.suggested_minutes,
  }, chosen);
  return json(out, 201);
}

export async function cancelActivity(env: Env, teacherId: string, id: string) {
  await getOwnedActivity(env.DB, teacherId, id);
  await env.DB.prepare("UPDATE activities SET status = 'canceled' WHERE id = ? AND teacher_id = ?").bind(id, teacherId).run();
  return json({ ok: true });
}

export async function setArchived(env: Env, teacherId: string, id: string, archived: boolean) {
  await getOwnedActivity(env.DB, teacherId, id);
  await env.DB.prepare('UPDATE activities SET archived_at = ? WHERE id = ? AND teacher_id = ?').bind(archived ? nowIso() : null, id, teacherId).run();
  return getActivity(env, teacherId, id);
}

/** New entry links for students who have NOT finished (lost/leaked link). The old link stops working immediately;
 *  a started session survives because it hangs off the activity_student row, not the token. */
export async function regenerateLinks(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  if (a.status === 'canceled') throw new HttpError(409, 'activity_canceled', 'این فعالیت لغو شده است.');
  const b = parse(regenerateSchema, await readJson(req));
  const rows = await env.DB.prepare(
    `SELECT ast.id, ast.student_id, s.display_name FROM activity_students ast JOIN students s ON s.id = ast.student_id
      WHERE ast.activity_id = ? AND ast.status != 'completed' ${b.studentId ? 'AND ast.student_id = ?' : ''}`,
  ).bind(...(b.studentId ? [id, b.studentId] : [id])).all<{ id: string; student_id: string; display_name: string }>();
  if (!rows.results.length) throw new HttpError(404, 'nothing_to_regenerate', 'دانش‌آموزی برای ساخت لینک جدید پیدا نشد.');
  const links = rows.results.map((r) => ({ id: r.id, studentId: r.student_id, name: r.display_name, token: newPlayToken() }));
  await env.DB.batch(links.map((l) => env.DB.prepare('UPDATE activity_students SET token = ? WHERE id = ?').bind(l.token, l.id)));
  return json({ links: links.map((l) => ({ studentId: l.studentId, name: l.name, token: l.token, url: playUrl(env, l.token) })) });
}
