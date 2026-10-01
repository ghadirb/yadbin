import type { Env } from '../env';
import { getOwnedClass, getOwnedStudent } from '../db/queries';
import { buildStudentReport } from '../services/metrics';
import { MIN_SAMPLES } from '../scoring';
import { GAME_NAMES_FA } from '../db/queries';
import { json } from '../utils/http';

export async function studentReport(env: Env, teacherId: string, id: string) {
  return json(await buildStudentReport(env.DB, await getOwnedStudent(env.DB, teacherId, id)));
}

const r2 = (n: number) => Math.round(n * 100) / 100;
function weekStart(iso: string): string {
  const d = new Date(iso); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7)); // Saturday-based week
  return d.toISOString().slice(0, 10);
}

/** Class report: counts and general activity stats. Deliberately no ranking or per-student comparison (product principle).
 *  «مقایسه کلی» = game vs game and week vs week for the class as a whole. */
export async function classReport(env: Env, teacherId: string, id: string) {
  const c = await getOwnedClass(env.DB, teacherId, id);
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const students = await env.DB.prepare('SELECT COUNT(*) AS n FROM class_students WHERE class_id = ? AND removed_at IS NULL').bind(id).first<{ n: number }>();
  const active = await env.DB.prepare(
    `SELECT COUNT(DISTINCT ast.student_id) AS n FROM activity_students ast JOIN activities a ON a.id = ast.activity_id
       JOIN class_students cs ON cs.class_id = a.class_id AND cs.student_id = ast.student_id AND cs.removed_at IS NULL
      WHERE a.class_id = ? AND ast.status = 'completed' AND ast.completed_at >= ?`,
  ).bind(id, since30).first<{ n: number }>();
  const per = await env.DB.prepare(
    `SELECT a.game_type AS game, COUNT(DISTINCT a.id) AS activities, COUNT(ast.id) AS assigned,
            SUM(CASE WHEN ast.status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM activities a LEFT JOIN activity_students ast ON ast.activity_id = a.id
     WHERE a.class_id = ? GROUP BY a.game_type`,
  ).bind(id).all<any>();
  const res = await env.DB.prepare(
    `SELECT a.game_type AS game, r.accuracy, r.sample_count, r.created_at
       FROM game_results r JOIN game_sessions gs ON gs.id = r.session_id JOIN activity_students ast ON ast.id = gs.activity_student_id
       JOIN activities a ON a.id = ast.activity_id WHERE a.class_id = ? AND r.accuracy IS NOT NULL`,
  ).bind(id).all<{ game: string; accuracy: number; sample_count: number; created_at: string }>();

  const avg = (rows: { accuracy: number; sample_count: number }[]) => {
    const n = rows.reduce((t, r) => t + r.sample_count, 0);
    return n >= MIN_SAMPLES ? r2(rows.reduce((t, r) => t + r.accuracy * r.sample_count, 0) / n) : null;
  };
  const totals = per.results.reduce((t, r) => ({ a: t.a + r.activities, s: t.s + r.assigned, c: t.c + (r.completed ?? 0) }), { a: 0, s: 0, c: 0 });
  const overall = avg(res.results);

  // Last 6 weeks, oldest first, empty weeks included so a chart has a stable x axis.
  const weeks: { weekStart: string; completed: number; averagePerformance: number | null }[] = [];
  for (let i = 5; i >= 0; i--) {
    const ws = weekStart(new Date(Date.now() - i * 7 * 86400_000).toISOString());
    const rows = res.results.filter((r) => weekStart(r.created_at) === ws);
    weeks.push({ weekStart: ws, completed: rows.length, averagePerformance: avg(rows) });
  }
  const studentCount = students?.n ?? 0, activeN = active?.n ?? 0;
  return json({
    class: { id: c.id, name: c.name, grade: c.grade, archived: !!c.archived_at },
    studentCount,
    activeStudents: activeN,
    activitiesCreated: totals.a,
    assignedLinks: totals.s,
    completedSessions: totals.c,
    completionRate: totals.s ? r2(totals.c / totals.s) : null,
    averagePerformance: overall,
    sufficientData: overall !== null,
    overallLabel: overall === null ? 'برای نمایش میانگین، فعالیت‌های بیشتری لازم است.'
      : activeN === 0 ? 'در ۳۰ روز گذشته فعالیتی انجام نشده است.'
      : `${activeN} از ${studentCount} دانش‌آموز در ۳۰ روز گذشته فعال بوده‌اند.`,
    byGame: per.results.map((r) => ({
      game: r.game, gameName: GAME_NAMES_FA[r.game], activities: r.activities, assigned: r.assigned, completed: r.completed ?? 0,
      averagePerformance: avg(res.results.filter((x) => x.game === r.game)),
    })),
    weekly: weeks,
    notice: 'همه‌ی اعداد «عملکرد مشاهده‌شده» کلاس است و مقایسه‌ی دانش‌آموزان با یکدیگر نمایش داده نمی‌شود.',
  });
}
