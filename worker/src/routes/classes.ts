import type { Env } from '../env';
import { activityDto, classDto, effectiveGradeOrder, getOwnedClass, getOwnedStudent, studentDto } from '../db/queries';
import { gradeByCode } from '../education/catalog';
import { recomputeStudentMetrics } from '../services/metrics';
import { GAME_TYPES, MIN_SAMPLES } from '../scoring';
import { eraseAssessmentDataForClass } from './assessments';
import { json, readJson } from '../utils/http';
import { newId, nowIso } from '../utils/ids';
import { bulkStudentsSchema, classSchema, parse } from '../validation/schemas';

/** GET /classes?archived=false|true|all — default false (active classes only). */
export async function listClasses(env: Env, teacherId: string, req?: Request) {
  const want = req ? new URL(req.url).searchParams.get('archived') ?? 'false' : 'false';
  const filter = want === 'all' ? '' : want === 'true' ? 'AND c.archived_at IS NOT NULL' : 'AND c.archived_at IS NULL';
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT c.*,
       (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.removed_at IS NULL) AS student_count,
       (SELECT COUNT(*) FROM activities a WHERE a.class_id = c.id AND a.created_at >= ?) AS recent_activity_count
     FROM classes c WHERE c.teacher_id = ? ${filter} ORDER BY c.created_at DESC`,
  ).bind(since, teacherId).all<any>();
  return json({ classes: results.map((c) => ({ ...classDto(c), studentCount: c.student_count, recentActivityCount: c.recent_activity_count })) });
}

export async function createClass(req: Request, env: Env, teacherId: string) {
  const b = parse(classSchema, await readJson(req));
  const id = newId();
  const g = gradeByCode(b.gradeCode);
  await env.DB.prepare('INSERT INTO classes (id,teacher_id,name,grade,school_name,created_at,grade_code,grade_order,age_min,age_max,education_stage) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, teacherId, b.name, b.grade ?? g!.label, b.schoolName, nowIso(), g?.code ?? null, g?.order ?? null, b.ageMin ?? null, b.ageMax ?? null, b.educationStage ?? g?.stage ?? null).run();
  return json({ class: classDto(await getOwnedClass(env.DB, teacherId, id)) }, 201);
}

export async function getClass(env: Env, teacherId: string, id: string) {
  const c = await getOwnedClass(env.DB, teacherId, id);
  const students = await env.DB.prepare(
    `SELECT s.*,
       (SELECT COUNT(*) FROM activity_students a WHERE a.student_id = s.id AND a.status = 'completed') AS completed,
       (SELECT COUNT(*) FROM activity_students a JOIN activities ac ON ac.id = a.activity_id
         WHERE a.student_id = s.id AND ac.class_id = cs.class_id AND a.status != 'completed' AND ac.status = 'active' AND ac.archived_at IS NULL AND ac.publish_state = 'published'
           AND (ac.expires_at IS NULL OR ac.expires_at >= ?)) AS open_count,
       (SELECT MAX(a.completed_at) FROM activity_students a WHERE a.student_id = s.id AND a.status = 'completed') AS last_at,
       (SELECT SUM(CASE WHEN r.accuracy IS NOT NULL THEN r.accuracy * r.sample_count END) FROM game_results r
          JOIN game_sessions gs ON gs.id = r.session_id JOIN activity_students a ON a.id = gs.activity_student_id WHERE a.student_id = s.id) AS wsum,
       (SELECT SUM(CASE WHEN r.accuracy IS NOT NULL THEN r.sample_count END) FROM game_results r
          JOIN game_sessions gs ON gs.id = r.session_id JOIN activity_students a ON a.id = gs.activity_student_id WHERE a.student_id = s.id) AS wn
     FROM class_students cs JOIN students s ON s.id = cs.student_id
     WHERE cs.class_id = ? AND cs.removed_at IS NULL ORDER BY cs.added_at, s.display_name`,
  ).bind(nowIso(), id).all<any>();
  const acts = await env.DB.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM activity_students x WHERE x.activity_id = a.id) AS assigned,
       (SELECT COUNT(*) FROM activity_students x WHERE x.activity_id = a.id AND x.status = 'completed') AS completed
     FROM activities a WHERE a.class_id = ? ORDER BY a.created_at DESC`,
  ).bind(id).all<any>();
  return json({
    class: classDto(c),
    students: students.results.map((s) => {
      const enough = (s.wn ?? 0) >= MIN_SAMPLES;
      return {
        ...studentDto(s, effectiveGradeOrder(c)), completedActivities: s.completed, openActivities: s.open_count, lastActivityAt: s.last_at,
        // Same rule as the student report: no numeric average until there is enough data.
        averagePerformance: enough ? Math.round((s.wsum / s.wn) * 100) / 100 : null,
        sufficientData: enough,
        activityState: s.open_count > 0 ? 'open' : s.completed > 0 ? 'up_to_date' : 'no_activity',
        activityStateLabel: s.open_count > 0 ? 'فعالیت باز دارد' : s.completed > 0 ? 'فعالیت‌ها انجام شده' : 'هنوز فعالیتی ندارد',
      };
    }),
    activities: acts.results.map((a) => activityDto(a, a.assigned, a.completed)),
  });
}

/** Archive keeps every student, activity and result; the class only disappears from the active list and accepts no new activities. */
export async function setClassArchived(env: Env, teacherId: string, id: string, archived: boolean) {
  await getOwnedClass(env.DB, teacherId, id);
  await env.DB.prepare('UPDATE classes SET archived_at = ? WHERE id = ? AND teacher_id = ?').bind(archived ? nowIso() : null, id, teacherId).run();
  return json({ class: classDto(await getOwnedClass(env.DB, teacherId, id)) });
}

export async function updateClass(req: Request, env: Env, teacherId: string, id: string) {
  const old = await getOwnedClass(env.DB, teacherId, id);
  const b = parse(classSchema, await readJson(req));
  // undefined = keep (old clients don't send the v1.2 fields), null = clear.
  // An old client that only edits the free-text grade makes the structured code stale → clear it.
  const staleCode = b.gradeCode === undefined && !!b.grade && b.grade !== old.grade;
  const g = b.gradeCode === undefined ? (staleCode ? null : gradeByCode(old.grade_code)) : gradeByCode(b.gradeCode);
  const keep = <T,>(v: T | undefined, o: T) => (v === undefined ? o : v);
  await env.DB.prepare('UPDATE classes SET name=?, grade=?, school_name=?, grade_code=?, grade_order=?, age_min=?, age_max=?, education_stage=? WHERE id=? AND teacher_id=?')
    .bind(b.name, b.grade ?? (b.gradeCode ? g!.label : old.grade), b.schoolName, g?.code ?? null, g?.order ?? null, keep(b.ageMin, old.age_min) ?? null, keep(b.ageMax, old.age_max) ?? null, keep(b.educationStage, old.education_stage) ?? g?.stage ?? null, id, teacherId).run();
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
    ...eraseAssessmentDataForClass(env.DB, id),
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
  if ((await getOwnedClass(env.DB, teacherId, classId)).archived_at) return json({ error: 'class_archived', message: 'این کلاس آرشیو شده است.' }, 409);
  const body = parse(bulkStudentsSchema, await readJson(req));
  const names = splitNames(body);
  const gender = body.gender ?? null;
  if (!names.length) return json({ error: 'validation_error', message: 'نامی وارد نشده است.' }, 400);
  if (names.length > 100) return json({ error: 'validation_error', message: 'در هر بار حداکثر ۱۰۰ نام مجاز است.' }, 400);
  const cls = await getOwnedClass(env.DB, teacherId, classId);
  const grade = cls.grade as string;
  const valid = names.filter((n) => n.length >= 2 && n.length <= 80);
  const now = nowIso();
  const created = valid.map((n) => ({ id: newId(), name: n }));
  if (created.length) {
    await env.DB.batch(created.flatMap((s) => [
      env.DB.prepare('INSERT INTO students (id,teacher_id,display_name,grade,created_at,grade_code,grade_order,gender) VALUES (?,?,?,?,?,?,?,?)').bind(s.id, teacherId, s.name, grade, now, cls.grade_code ?? null, cls.grade_order ?? null, gender),
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
