import type { Env } from '../env';
import { activityDto, effectiveGradeOrder } from '../db/queries';
import { gradeByCode, gradeByOrder } from '../education/catalog';
import { GAMES, GAME_SKILL, SHORT_STATUS_FA } from '../education/insights';
import { MIN_SAMPLES, performanceStatus, type PerformanceStatus } from '../scoring';
import { json } from '../utils/http';
import { applyActivityFilters } from './activities';

/** GET /dashboard?classId=&grade=&skill=&level=&gameType=&completion=done|open&performance=good|average|needs_practice|insufficient
 *  Teacher-wide view over the teacher's OWN active classes. Counts and distributions only: no ranking and no per-student comparison. */
export async function dashboard(req: Request, env: Env, teacherId: string) {
  const sp = new URL(req.url).searchParams;
  const gradeF = gradeByCode(sp.get('grade'))?.order ?? null, classF = sp.get('classId'), perfF = sp.get('performance');
  const cls = (await env.DB.prepare('SELECT * FROM classes WHERE teacher_id = ? AND archived_at IS NULL ORDER BY created_at DESC').bind(teacherId).all<any>()).results
    .filter((c) => (!classF || c.id === classF) && (gradeF === null || effectiveGradeOrder(c) === gradeF));
  const ids = cls.map((c) => c.id);
  const ph = ids.map(() => '?').join(',');

  const metrics = ids.length ? (await env.DB.prepare(
    `SELECT cs.class_id, sm.student_id, sm.game_type, sm.accuracy, sm.sample_count FROM student_metrics sm
       JOIN class_students cs ON cs.student_id = sm.student_id AND cs.removed_at IS NULL WHERE cs.class_id IN (${ph})`).bind(...ids).all<any>()).results : [];
  const counts = ids.length ? (await env.DB.prepare(`SELECT class_id, COUNT(*) AS n FROM class_students WHERE removed_at IS NULL AND class_id IN (${ph}) GROUP BY class_id`).bind(...ids).all<any>()).results : [];
  const nStudents = new Map(counts.map((r) => [r.class_id, r.n as number]));

  const rows = ids.length ? (await env.DB.prepare(
    `SELECT a.*, c.name AS class_name,
            (SELECT COUNT(*) FROM activity_students x WHERE x.activity_id = a.id) AS assigned_n,
            (SELECT COUNT(*) FROM activity_students x WHERE x.activity_id = a.id AND x.status = 'completed') AS completed_n,
            (SELECT SUM(r.accuracy * r.sample_count) FROM game_results r JOIN game_sessions gs ON gs.id = r.session_id JOIN activity_students x ON x.id = gs.activity_student_id WHERE x.activity_id = a.id AND r.accuracy IS NOT NULL) AS wsum,
            (SELECT SUM(r.sample_count) FROM game_results r JOIN game_sessions gs ON gs.id = r.session_id JOIN activity_students x ON x.id = gs.activity_student_id WHERE x.activity_id = a.id AND r.accuracy IS NOT NULL) AS wn
       FROM activities a JOIN classes c ON c.id = a.class_id WHERE a.teacher_id = ? AND a.class_id IN (${ph}) ORDER BY a.created_at DESC LIMIT 300`).bind(teacherId, ...ids).all<any>()).results : [];

  const withPerf = rows.map((a) => {
    const status: PerformanceStatus = a.wn && a.wn >= MIN_SAMPLES ? performanceStatus(a.wsum / a.wn, a.wn) : 'insufficient';
    return { ...activityDto(a, a.assigned_n, a.completed_n), className: a.class_name, performanceStatus: status, performanceLabel: SHORT_STATUS_FA[status] };
  });
  const published = withPerf.filter((a) => a.publishState === 'published'); // drafts / activities being tested never count as assigned work
  const activities = applyActivityFilters(published, sp, sp.get('lifecycle') ?? 'open').filter((a) => !perfF || a.performanceStatus === perfF);

  const classes = cls.map((c) => {
    const n = nStudents.get(c.id) ?? 0;
    const mine = activities.filter((a) => a.classId === c.id);
    const assigned = mine.reduce((t, a) => t + a.assigned, 0), completed = mine.reduce((t, a) => t + a.completed, 0);
    return {
      id: c.id, name: c.name, gradeCode: c.grade_code ?? null, gradeLabel: gradeByOrder(effectiveGradeOrder(c))?.label ?? c.grade, studentCount: n,
      activityCount: mine.length, assigned, completed, completionRate: assigned ? Math.round((completed / assigned) * 100) / 100 : null,
      skills: GAMES.map((g) => {
        const dist: Record<PerformanceStatus, number> = { good: 0, average: 0, needs_practice: 0, insufficient: 0 };
        const mm = metrics.filter((m) => m.class_id === c.id && m.game_type === g);
        for (const m of mm) dist[performanceStatus(m.accuracy, m.sample_count)]++;
        dist.insufficient += Math.max(0, n - mm.length); // students with no results at all
        return { skill: GAME_SKILL[g].skill, label: GAME_SKILL[g].label, game: g, distribution: dist };
      }),
    };
  });
  return json({
    classes, activities,
    totals: { classes: classes.length, drafts: withPerf.length - published.length, activities: activities.length, assigned: activities.reduce((t, a) => t + a.assigned, 0), completed: activities.reduce((t, a) => t + a.completed, 0) },
    filters: { grade: sp.get('grade'), skill: sp.get('skill'), level: sp.get('level'), gameType: sp.get('gameType'), completion: sp.get('completion'), performance: perfF, classId: classF },
    notice: 'فقط شمارش و توزیع کلی نمایش داده می‌شود؛ دانش‌آموزان با یکدیگر مقایسه یا رتبه‌بندی نمی‌شوند.',
  });
}
