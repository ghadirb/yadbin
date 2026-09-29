import type { Env } from '../env';
import { getOwnedClass, getOwnedStudent } from '../db/queries';
import { buildStudentReport } from '../services/metrics';
import { json, readJson } from '../utils/http';
import { newId, nowIso } from '../utils/ids';
import { parse, studentSchema } from '../validation/schemas';

export async function createStudent(req: Request, env: Env, teacherId: string) {
  const b = parse(studentSchema, await readJson(req));
  let grade: string | null = null;
  if (b.classId) grade = (await getOwnedClass(env.DB, teacherId, b.classId)).grade;
  const id = newId(), now = nowIso();
  const stmts = [env.DB.prepare('INSERT INTO students (id,teacher_id,display_name,grade,created_at) VALUES (?,?,?,?,?)').bind(id, teacherId, b.name, grade, now)];
  if (b.classId) stmts.push(env.DB.prepare('INSERT INTO class_students (class_id,student_id,added_at) VALUES (?,?,?)').bind(b.classId, id, now));
  await env.DB.batch(stmts);
  return json({ student: { id, name: b.name } }, 201);
}

export async function getStudent(env: Env, teacherId: string, id: string) {
  return json(await buildStudentReport(env.DB, await getOwnedStudent(env.DB, teacherId, id)));
}

/** DELETE DATA: permanently removes the student and every result (explicit ordered deletes; no reliance on FK cascade). */
export async function deleteStudent(env: Env, teacherId: string, id: string) {
  await getOwnedStudent(env.DB, teacherId, id);
  const ast = `(SELECT id FROM activity_students WHERE student_id = ?)`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM game_results WHERE session_id IN (SELECT id FROM game_sessions WHERE activity_student_id IN ${ast})`).bind(id),
    env.DB.prepare(`DELETE FROM game_sessions WHERE activity_student_id IN ${ast}`).bind(id),
    env.DB.prepare('DELETE FROM activity_students WHERE student_id = ?').bind(id),
    env.DB.prepare('DELETE FROM student_metrics WHERE student_id = ?').bind(id),
    env.DB.prepare('DELETE FROM class_students WHERE student_id = ?').bind(id),
    env.DB.prepare('DELETE FROM students WHERE id = ? AND teacher_id = ?').bind(id, teacherId),
  ]);
  return json({ ok: true });
}
