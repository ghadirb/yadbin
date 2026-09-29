import type { Env } from '../env';
import { getOwnedClass, getOwnedStudent } from '../db/queries';
import { buildStudentReport } from '../services/metrics';
import { json } from '../utils/http';

export async function studentReport(env: Env, teacherId: string, id: string) {
  return json(await buildStudentReport(env.DB, await getOwnedStudent(env.DB, teacherId, id)));
}

/** Class report: counts and general activity stats only. Deliberately no ranking or per-student comparison. */
export async function classReport(env: Env, teacherId: string, id: string) {
  const c = await getOwnedClass(env.DB, teacherId, id);
  const students = await env.DB.prepare('SELECT COUNT(*) AS n FROM class_students WHERE class_id = ? AND removed_at IS NULL').bind(id).first<{ n: number }>();
  const per = await env.DB.prepare(
    `SELECT a.game_type AS game, COUNT(DISTINCT a.id) AS activities, COUNT(ast.id) AS assigned,
            SUM(CASE WHEN ast.status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM activities a LEFT JOIN activity_students ast ON ast.activity_id = a.id
     WHERE a.class_id = ? GROUP BY a.game_type`,
  ).bind(id).all<any>();
  const totals = per.results.reduce((t, r) => ({ a: t.a + r.activities, s: t.s + r.assigned, c: t.c + (r.completed ?? 0) }), { a: 0, s: 0, c: 0 });
  return json({
    class: { id: c.id, name: c.name, grade: c.grade },
    studentCount: students?.n ?? 0,
    activitiesCreated: totals.a,
    assignedLinks: totals.s,
    completedSessions: totals.c,
    completionRate: totals.s ? Math.round((totals.c / totals.s) * 100) / 100 : null,
    byGame: per.results.map((r) => ({ game: r.game, activities: r.activities, assigned: r.assigned, completed: r.completed ?? 0 })),
  });
}
