import type { Env } from '../env';
import { classDto, getOwnedClass, getOwnedStudent } from '../db/queries';
import { recomputeStudentMetrics } from '../services/metrics';
import { GAME_TYPES } from '../scoring';
import { json, readJson } from '../utils/http';
import { newId, nowIso } from '../utils/ids';
import { bulkStudentsSchema, classSchema, parse } from '../validation/schemas';

export async function listClasses(env: Env, teacherId: string) {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT c.*,
       (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.removed_at IS NULL) AS student_count,
       (SELECT COUNT(*) FROM activities a WHERE a.class_id = c.id AND a.created_at >= ?) AS recent_activity_count
     FROM classes c WHERE c.teacher_id = ? ORDER BY c.created_at DESC`,
  ).bind(since, teacherId).all<any>();
  return json({ classes: results.map((c) => ({ ...classDto(c), studentCount: c.student_count, recentActivityCount: c.recent_activity_count })) });
}

export async function createClass(req: Request, env: Env, teacherId: string) {
  const b = parse(classSchema, await readJson(req));
  const id = newId();
  await env.DB.prepare('INSERT INTO classes (id,teacher_id,name,grade,school_name,created_at) VALUES (?,?,?,?,?,?)')
    .bind(id, teacherId, b.name, b.grade, b.schoolName, nowIso()).run();
  return json({ class: classDto(await getOwnedClass(env.DB, teacherId, id)) }, 201);
}

export async function getClass(env: Env, teacherId: string, id: string) {
  const c = await getOwnedClass(env.DB, teacherId, id);
  const students = await env.DB.prepare(
    `SELECT s.id, s.display_name,
       (SELECT COUNT(*) FROM activity_students a WHERE a.student_id = s.id AND a.status = 'completed') AS completed,
       (SELECT MAX(a.completed_at) FROM activity_students a WHERE a.student_id = s.id AND a.status = 'completed') AS last_at
     FROM class_students cs JOIN students s ON s.id = cs.student_id
     WHERE cs.class_id = ? AND cs.removed_at IS NULL ORDER BY cs.added_at, s.display_name`,
  ).bind(id).all<any>();
  const acts = await env.DB.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM activity_students x WHERE x.activity_id = a.id) AS assigned,
       (SELECT COUNT(*) FROM activity_students x WHERE x.activity_id = a.id AND x.status = 'completed') AS completed
     FROM activities a WHERE a.class_id = ? ORDER BY a.created_at DESC`,
  ).bind(id).all<any>();
  return json({
    class: classDto(c),
    students: students.results.map((s) => ({ id: s.id, name: s.display_name, completedActivities: s.completed, lastActivityAt: s.last_at })),
    activities: acts.results.map((a) => ({
      id: a.id, gameType: a.game_type, difficultyMode: a.difficulty_mode, questionCount: a.question_count,
      status: a.status, createdAt: a.created_at, expiresAt: a.expires_at, assigned: a.assigned, completed: a.completed,
    })),
  });
}

export async function updateClass(req: Request, env: Env, teacherId: string, id: string) {
  await getOwnedClass(env.DB, teacherId, id);
  const b = parse(classSchema, await readJson(req));
  await env.DB.prepare('UPDATE classes SET name=?, grade=?, school_name=? WHERE id=? AND teacher_id=?').bind(b.name, b.grade, b.schoolName, id, teacherId).run();
  return json({ class: classDto(await getOwnedClass(env.DB, teacherId, id)) });
}

/** Deleting a class removes its activities and their results. Students remain (teacher-owned) but are recomputed. */
export async function deleteClass(env: Env, teacherId: string, id: string) {
  await getOwnedClass(env.DB, teacherId, id);
  const affected = await env.DB.prepare(
    `SELECT DISTINCT ast.student_id AS sid FROM activity_students ast JOIN activities a ON a.id = ast.activity_id WHERE a.class_id = ?`,
  ).bind(id).all<{ sid: string }>();
  const sub = `(SELECT ast.id FROM activity_students ast JOIN activities a ON a.id = ast.activity_id WHERE a.class_id = ?)`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM game_results WHERE session_id IN (SELECT id FROM game_sessions WHERE activity_student_id IN ${sub})`).bind(id),
    env.DB.prepare(`DELETE FROM game_sessions WHERE activity_student_id IN ${sub}`).bind(id),
    env.DB.prepare(`DELETE FROM activity_students WHERE activity_id IN (SELECT id FROM activities WHERE class_id = ?)`).bind(id),
    env.DB.prepare('DELETE FROM activities WHERE class_id = ?').bind(id),
    env.DB.prepare('DELETE FROM class_students WHERE class_id = ?').bind(id),
    env.DB.prepare('DELETE FROM classes WHERE id = ? AND teacher_id = ?').bind(id, teacherId),
  ]);
  for (const { sid } of affected.results) for (const g of GAME_TYPES) await recomputeStudentMetrics(env.DB, sid, g);
  return json({ ok: true });
}

function splitNames(b: { name?: string; names?: string[]; text?: string }): string[] {
  const raw = [...(b.name ? [b.name] : []), ...(b.names ?? []), ...(b.text ? b.text.split(/\r?\n/) : [])];
  return raw.map((n) => n.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/** Single add ({name}) or quick add (one name per line in {text} / {names[]}). */
export async function addStudentsToClass(req: Request, env: Env, teacherId: string, classId: string) {
  await getOwnedClass(env.DB, teacherId, classId);
  const names = splitNames(parse(bulkStudentsSchema, await readJson(req)));
  if (!names.length) return json({ error: 'validation_error', message: 'نامی وارد نشده است.' }, 400);
  if (names.length > 100) return json({ error: 'validation_error', message: 'در هر بار حداکثر ۱۰۰ نام مجاز است.' }, 400);
  const grade = (await getOwnedClass(env.DB, teacherId, classId)).grade as string;
  const valid = names.filter((n) => n.length >= 2 && n.length <= 80);
  const now = nowIso();
  const created = valid.map((n) => ({ id: newId(), name: n }));
  if (created.length) {
    await env.DB.batch(created.flatMap((s) => [
      env.DB.prepare('INSERT INTO students (id,teacher_id,display_name,grade,created_at) VALUES (?,?,?,?,?)').bind(s.id, teacherId, s.name, grade, now),
      env.DB.prepare('INSERT INTO class_students (class_id,student_id,added_at) VALUES (?,?,?)').bind(classId, s.id, now),
    ]));
  }
  return json({ added: created.map((s) => ({ id: s.id, name: s.name })), skipped: names.length - valid.length }, 201);
}

/** Remove from class: the student leaves the class, but their data is kept (different from deleting data). */
export async function removeStudentFromClass(env: Env, teacherId: string, classId: string, studentId: string) {
  await getOwnedClass(env.DB, teacherId, classId);
  await getOwnedStudent(env.DB, teacherId, studentId);
  await env.DB.prepare('UPDATE class_students SET removed_at = ? WHERE class_id = ? AND student_id = ? AND removed_at IS NULL')
    .bind(nowIso(), classId, studentId).run();
  return json({ ok: true });
}
