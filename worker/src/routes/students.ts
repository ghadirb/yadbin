import type { Env } from '../env';
import { effectiveGradeOrder, getOwnedClass, getOwnedStudent, studentDto } from '../db/queries';
import { gradeByCode } from '../education/catalog';
import { buildEducationalProfile, buildRecommendations, buildStudentReport, studentHistory } from '../services/metrics';
import { eraseAssessmentDataForStudent } from './assessments';
import { enforceCreate } from '../subscription/gating';
import { json, readJson } from '../utils/http';
import { newId, nowIso } from '../utils/ids';
import { parse, studentSchema, studentUpdateSchema } from '../validation/schemas';

type ProfileInput = { birthDate?: string | null; birthYear?: number | null; age?: number | null; gradeCode?: string | null; gender?: string | null; note?: string | null };

/** Merge profile input over an existing row (undefined = keep, null = clear). Age is never stored: an entered age becomes a birth year. */
function profileColumns(b: ProfileInput, old: any = {}) {
  const k = <T,>(v: T | undefined, o: T) => (v === undefined ? o : v);
  let birthDate: string | null = k(b.birthDate, old.birth_date ?? null);
  let birthYear: number | null = k(b.birthYear, old.birth_year ?? null);
  if (b.age !== undefined) { birthDate = null; birthYear = b.age === null ? null : new Date().getUTCFullYear() - b.age; }
  else if (b.birthDate) birthYear = null; // the full date wins; no duplicate source of truth
  else if (b.birthYear != null && b.birthDate === undefined) birthDate = null;
  const g = b.gradeCode === undefined ? gradeByCode(old.grade_code) : gradeByCode(b.gradeCode);
  return {
    birthDate, birthYear, gradeCode: g?.code ?? null, gradeOrder: g?.order ?? (b.gradeCode === undefined ? old.grade_order ?? null : null),
    gradeText: g?.label ?? (b.gradeCode === null ? null : old.grade ?? null), gender: k(b.gender, old.gender ?? null), note: k(b.note, old.teacher_note ?? null) || null,
  };
}

export async function createStudent(req: Request, env: Env, teacherId: string) {
  const b = parse(studentSchema, await readJson(req));
  const cls = b.classId ? await getOwnedClass(env.DB, teacherId, b.classId) : null;
  await enforceCreate(env, teacherId, 'students');
  // A student without their own grade inherits the class grade.
  const input = { ...b, gradeCode: b.gradeCode === undefined ? cls?.grade_code ?? undefined : b.gradeCode };
  const c = profileColumns(input);
  const gradeText = c.gradeText ?? cls?.grade ?? null;
  const gradeOrder = c.gradeOrder ?? cls?.grade_order ?? null;
  const id = newId(), now = nowIso();
  const stmts = [env.DB.prepare('INSERT INTO students (id,teacher_id,display_name,grade,created_at,birth_date,birth_year,grade_code,grade_order,gender,teacher_note) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, teacherId, b.name, gradeText, now, c.birthDate, c.birthYear, c.gradeCode, gradeOrder, c.gender, c.note)];
  if (b.classId) stmts.push(env.DB.prepare('INSERT INTO class_students (class_id,student_id,added_at) VALUES (?,?,?)').bind(b.classId, id, now));
  await env.DB.batch(stmts);
  const row = await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(id).first<any>();
  return json({ student: studentDto(row, cls ? effectiveGradeOrder(cls) : null) }, 201);
}

/** PUT /students/:id — name + optional age/grade/gender/note. Owner only. */
export async function updateStudent(req: Request, env: Env, teacherId: string, id: string) {
  const old = await getOwnedStudent(env.DB, teacherId, id);
  const b = parse(studentUpdateSchema, await readJson(req));
  const c = profileColumns(b, old);
  await env.DB.prepare('UPDATE students SET display_name=?, grade=?, birth_date=?, birth_year=?, grade_code=?, grade_order=?, gender=?, teacher_note=? WHERE id=? AND teacher_id=?')
    .bind(b.name ?? old.display_name, c.gradeText, c.birthDate, c.birthYear, c.gradeCode, c.gradeOrder, c.gender, c.note, id, teacherId).run();
  return json({ student: await studentWithClassGrade(env, teacherId, id) });
}

/** The student's profile; falls back to the grade of their active class when the student has none of their own. */
export async function studentWithClassGrade(env: Env, teacherId: string, id: string) {
  const s = await getOwnedStudent(env.DB, teacherId, id);
  const cls = await env.DB.prepare('SELECT c.* FROM class_students cs JOIN classes c ON c.id = cs.class_id WHERE cs.student_id = ? AND cs.removed_at IS NULL ORDER BY cs.added_at DESC LIMIT 1').bind(id).first<any>();
  return studentDto(s, cls ? effectiveGradeOrder(cls) : null);
}

export async function getStudent(env: Env, teacherId: string, id: string) {
  return json(await buildStudentReport(env.DB, await getOwnedStudent(env.DB, teacherId, id)));
}

export async function getStudentHistory(env: Env, teacherId: string, id: string) {
  const s = await getOwnedStudent(env.DB, teacherId, id);
  return json({ student: { id: s.id, name: s.display_name }, history: await studentHistory(env.DB, id) });
}

/** CLEAR DATA (what the teacher's «حذف داده‌های دانش‌آموز» button does): erases every result, session, assignment and metric
 *  of this student but KEEPS the student and their class membership. Explicit ordered deletes (no FK-cascade reliance).
 *  Old activity links of this student stop working (their assignment rows are gone); activities themselves are untouched. */
export async function clearStudentData(env: Env, teacherId: string, id: string) {
  const s = await getOwnedStudent(env.DB, teacherId, id);
  const ast = `(SELECT id FROM activity_students WHERE student_id = ?)`;
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM activity_students WHERE student_id = ?').bind(id).first<{ n: number }>();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM game_results WHERE session_id IN (SELECT id FROM game_sessions WHERE activity_student_id IN ${ast})`).bind(id),
    env.DB.prepare(`DELETE FROM game_sessions WHERE activity_student_id IN ${ast}`).bind(id),
    env.DB.prepare('DELETE FROM activity_students WHERE student_id = ?').bind(id),
    env.DB.prepare('DELETE FROM student_metrics WHERE student_id = ?').bind(id),
    ...eraseAssessmentDataForStudent(env.DB, id), // teacher-assessment answers/results are erased with the rest
  ]);
  return json({ ok: true, student: { id: s.id, name: s.display_name }, clearedActivities: count?.n ?? 0 });
}

/** DELETE STUDENT: permanently removes the student and every result (explicit ordered deletes; no reliance on FK cascade). */
export async function deleteStudent(env: Env, teacherId: string, id: string) {
  await getOwnedStudent(env.DB, teacherId, id);
  const ast = `(SELECT id FROM activity_students WHERE student_id = ?)`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM game_results WHERE session_id IN (SELECT id FROM game_sessions WHERE activity_student_id IN ${ast})`).bind(id),
    env.DB.prepare(`DELETE FROM game_sessions WHERE activity_student_id IN ${ast}`).bind(id),
    env.DB.prepare('DELETE FROM activity_students WHERE student_id = ?').bind(id),
    env.DB.prepare('DELETE FROM student_metrics WHERE student_id = ?').bind(id),
    ...eraseAssessmentDataForStudent(env.DB, id),
    env.DB.prepare('DELETE FROM class_students WHERE student_id = ?').bind(id),
    env.DB.prepare('DELETE FROM students WHERE id = ? AND teacher_id = ?').bind(id, teacherId),
  ]);
  return json({ ok: true });
}

/** GET /students/:id/profile — v1.2 educational profile (age, grade, skill indicators, summary). */
export async function getEducationalProfile(env: Env, teacherId: string, id: string) {
  return json(await buildEducationalProfile(env.DB, await getOwnedStudent(env.DB, teacherId, id)));
}
/** GET /students/:id/recommendations — suggestions only; creates nothing. */
export async function getRecommendations(env: Env, teacherId: string, id: string) {
  return json(await buildRecommendations(env.DB, await getOwnedStudent(env.DB, teacherId, id)));
}
