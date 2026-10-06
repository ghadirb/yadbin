/**
 * Comprehensive student report («گزارش جامع پرونده دانش‌آموز»). It REUSES the growth computation (growth/compute.ts, growth/service.ts loaders)
 * and only adds: the academic-year / custom window, student identity, paginated activity list and the optional response-control series.
 * Everything is aggregated here; the client (and the print renderer) only display. No invented data: a missing measure is reported as missing.
 */
import { gradeByCode, gradeByOrder, levelLabel } from '../education/catalog';
import { loadAssessmentResults, loadCognitiveResults } from '../growth/service';
import {
  buildAnalysis, buildAssessmentGrowth, buildOverview, buildSkills, buildTimeline, classifyTrend, GAME_SKILL_FA, MIN_BUCKETS_FOR_CHART, MIN_RESULTS_FOR_TREND,
  MSG_NOT_ENOUGH_ACTIVITIES, MSG_NOT_ENOUGH_RANGE, pct, pointsPhrase, r1, startVsCurrent, type CogResult,
} from '../growth/compute';
import { academicYearAt, bucketForDays, jalaliText, type ResolvedPeriod } from './period';

export type ReportType = 'full' | 'summary';
export const REPORT_DISCLAIMER = 'این گزارش بر اساس عملکرد ثبت‌شده در فعالیت‌ها و آزمون‌های یادبین تهیه شده و جنبه آموزشی و عملکردی دارد و به‌تنهایی ابزار تشخیص پزشکی یا روان‌شناختی محسوب نمی‌شود.';
export const MSG_NO_INDEPENDENT_DATA = 'داده مستقل کافی ثبت نشده است.';
export const MAX_PAGE_SIZE = 50;

export interface ReportParams { type: ReportType; page: number; pageSize: number }

interface ControlRow { at: string; falseClickRate: number; samples: number }
/**
 * «کنترل پاسخ» (response control) — the ONLY raw signal the system stores for it is the false-click rate of the attention activity
 * (clicks on non-targets, game_results.raw_result_json → computed.details.falseClickRate, 0..1). Score = (1 − falseClickRate) × 100 per session.
 * It is measured only inside attention activities and is labelled that way; with fewer than 3 sessions that carry the field it is not shown.
 */
async function loadResponseControl(db: D1Database, teacherId: string, studentId: string, from: string, to: string): Promise<ControlRow[]> {
  const { results } = await db.prepare(
    `SELECT r.created_at AS at, json_extract(r.raw_result_json, '$.computed.details.falseClickRate') AS rate, r.sample_count AS samples
       FROM game_results r
       JOIN game_sessions gs ON gs.id = r.session_id
       JOIN activity_students ast ON ast.id = gs.activity_student_id
       JOIN activities a ON a.id = ast.activity_id
      WHERE ast.student_id = ?1 AND a.teacher_id = ?2 AND a.publish_state = 'published' AND ast.status = 'completed' AND gs.status = 'completed'
        AND gs.game_type = 'attention' AND r.sample_count > 0 AND r.created_at >= ?3 AND r.created_at < ?4
      ORDER BY r.created_at ASC LIMIT 5000`,
  ).bind(studentId, teacherId, from, to).all<{ at: string; rate: number | null; samples: number }>();
  return results.filter((x) => typeof x.rate === 'number' && x.rate >= 0 && x.rate <= 1).map((x) => ({ at: x.at, falseClickRate: x.rate as number, samples: x.samples }));
}

function buildResponseControl(rows: ControlRow[]) {
  const title = 'کنترل پاسخ';
  const basis = 'بر پایهٔ نرخ کلیک اشتباه در فعالیت‌های توجه (۱۰۰ منهای درصد کلیک‌های اشتباه)؛ فقط در فعالیت‌های توجه اندازه‌گیری می‌شود.';
  if (rows.length < MIN_RESULTS_FOR_TREND) {
    return { code: 'response_control', title, available: false, message: `${title}: ${MSG_NO_INDEPENDENT_DATA}`, basis, results: rows.length, start: null, current: null, changePoints: null, changeLabel: null, trend: classifyTrend([]), series: [] as { at: string; percent: number }[] };
  }
  const score = rows.map((r) => ({ v: 1 - r.falseClickRate, w: r.samples }));
  const sc = startVsCurrent(score);
  const trend = classifyTrend(score.map((s) => s.v));
  return {
    code: 'response_control', title, available: true, message: null, basis, results: rows.length,
    start: sc?.startPercent ?? null, current: sc?.currentPercent ?? null, changePoints: sc?.changePoints ?? null, changeLabel: sc ? pointsPhrase(sc.changePoints) : null,
    trend, series: rows.map((r) => ({ at: r.at, percent: pct(1 - r.falseClickRate) })),
  };
}
/** «یادگیری»: the system keeps no separate learning measurement (improvement between repeats is already what the accuracy trend shows). Never estimated. */
const LEARNING = { code: 'learning', title: 'یادگیری', available: false, message: `یادگیری: ${MSG_NO_INDEPENDENT_DATA}`, basis: null as string | null };

function skillSummaryText(s: { skill: string; trend: { direction: string }; results: number }): string {
  const d = s.trend.direction;
  if (d === 'insufficient') return `برای ${s.skill} هنوز فعالیت کافی برای تعیین روند ثبت نشده است.`;
  const phrase = d === 'up' ? 'روند افزایشی داشته است' : d === 'down' ? 'کاهش داشته است' : d === 'fluctuating' ? 'نوسان بیشتری داشته است' : 'تقریباً ثابت بوده است';
  return `عملکرد ثبت‌شدهٔ ${s.skill} در این بازه ${phrase}.`;
}

async function studentIdentity(db: D1Database, student: any, period: ResolvedPeriod, now: Date) {
  const { results } = await db.prepare(
    `SELECT c.name, c.grade, c.grade_order FROM class_students cs JOIN classes c ON c.id = cs.class_id
      WHERE cs.student_id = ? AND cs.removed_at IS NULL ORDER BY cs.added_at DESC LIMIT 3`,
  ).bind(student.id).all<{ name: string; grade: string | null; grade_order: number | null }>().catch(() => ({ results: [] as { name: string; grade: string | null; grade_order: number | null }[] }));
  const first = results[0];
  const g = gradeByCode(student.grade) ?? gradeByOrder(first?.grade_order ?? null);
  return {
    id: student.id, name: student.display_name, className: first?.name ?? null, classNames: results.map((r) => r.name),
    gradeLabel: g?.label ?? first?.grade ?? student.grade ?? null,
    academicYear: period.academicYear ?? academicYearAt(now).label,
  };
}

/** First valid result of the student (cognitive or assessment) — used to tell the UI whether an earlier academic year has any data. */
async function firstResultAt(db: D1Database, teacherId: string, studentId: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT MIN(at) AS at FROM (
       SELECT MIN(r.created_at) AS at FROM game_results r JOIN game_sessions gs ON gs.id = r.session_id JOIN activity_students ast ON ast.id = gs.activity_student_id JOIN activities a ON a.id = ast.activity_id
        WHERE ast.student_id = ?1 AND a.teacher_id = ?2 AND a.publish_state = 'published' AND ast.status = 'completed' AND gs.status = 'completed' AND r.accuracy IS NOT NULL AND r.accuracy >= 0 AND r.accuracy <= 1 AND r.sample_count > 0
       UNION ALL
       SELECT MIN(COALESCE(x.completed_at, r.created_at)) FROM assessment_students x JOIN assessments a ON a.id = x.assessment_id JOIN assessment_attempts t ON t.assessment_student_id = x.id AND t.status = 'completed' JOIN assessment_results r ON r.attempt_id = t.id
        WHERE x.student_id = ?1 AND a.teacher_id = ?2 AND x.status = 'completed' AND a.status IN ('published','archived') AND r.total > 0)`,
  ).bind(studentId, teacherId).first<{ at: string | null }>();
  return row?.at ?? null;
}

export async function buildReport(db: D1Database, teacherId: string, student: any, period: ResolvedPeriod, params: ReportParams, now: Date = new Date()) {
  const [cog, ass, control, firstAt, identity] = await Promise.all([
    loadCognitiveResults(db, teacherId, student.id, period.from, period.to),
    loadAssessmentResults(db, teacherId, student.id, period.from, period.to),
    loadResponseControl(db, teacherId, student.id, period.from, period.to),
    firstResultAt(db, teacherId, student.id),
    studentIdentity(db, student, period, now),
  ]);

  const growthAss = buildAssessmentGrowth(ass);
  const lastAss = ass.length ? ass.reduce((m, r) => (r.at > m ? r.at : m), ass[0].at) : null;
  const overview = { ...buildOverview(cog, null, growthAss.count, lastAss), changeNote: null as string | null };
  const skills = buildSkills(cog);
  const bucket = bucketForDays(period.days);
  const points = buildTimeline(cog, bucket);
  const chartOk = cog.length >= MIN_RESULTS_FOR_TREND && points.length >= MIN_BUCKETS_FOR_CHART;
  const timelineMessage = chartOk ? null : cog.length === 0 ? MSG_NOT_ENOUGH_RANGE : cog.length < MIN_RESULTS_FOR_TREND ? MSG_NOT_ENOUGH_ACTIVITIES : MSG_NOT_ENOUGH_RANGE;
  const overallTrend = classifyTrend(cog.map((r) => r.accuracy));

  // ----- activities (newest first, paginated; the client never receives more than one page) -----
  const sorted: CogResult[] = [...cog].sort((a, b) => b.at.localeCompare(a.at));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize));
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, params.page), pages);
  const items = sorted.slice((page - 1) * pageSize, page * pageSize).map((r) => ({
    activityId: r.activityId, title: r.title, gameType: r.game, skill: GAME_SKILL_FA[r.game], level: r.level, levelLabel: levelLabel(r.level),
    date: r.at, dateJalali: jalaliText(r.at), percent: pct(r.accuracy), answers: r.samples,
  }));

  const analysis = buildAnalysis(skills, overview, growthAss);
  const full = params.type === 'full';
  const academicSubjects = growthAss.subjects.map((s) => ({ ...s, exams: full ? s.exams : [] }));

  return {
    type: params.type,
    student: identity,
    period: {
      key: period.key, label: period.label, from: period.from, to: period.to, fromJalali: period.fromJalali, toJalali: period.toJalali,
      academicYear: period.academicYear, days: period.days, bucket, timeZone: 'Asia/Tehran',
      title: period.academicYear ? `گزارش عملکرد دانش‌آموز در سال تحصیلی ${period.academicYear}` : `گزارش عملکرد دانش‌آموز (${period.fromJalali} تا ${period.toJalali})`,
    },
    overview: { ...overview, lastActivityJalali: overview.lastActivityAt ? jalaliText(overview.lastActivityAt) : null },
    cognitiveGrowth: {
      section: 'cognitive_growth', title: 'رشد شناختی',
      timeline: { available: chartOk, message: timelineMessage, bucket, yAxis: 'percent', points: chartOk ? points : [], trend: overallTrend },
    },
    skillTrends: {
      skills: skills.map((s) => ({ ...s, summary: skillSummaryText(s), })),
      skillsMessage: skills.length ? null : 'در این بازه برای هیچ مهارتی نتیجهٔ معتبر ثبت نشده است.',
      responseControl: buildResponseControl(control),
      learning: LEARNING,
    },
    academicAssessments: {
      section: 'academic_assessments', title: 'عملکرد آموزشی (آزمون‌های درسی)',
      count: growthAss.count, average: growthAss.average, last: growthAss.last, chartAvailable: growthAss.chartAvailable, message: growthAss.message,
      series: growthAss.series, subjects: academicSubjects, totals: await assessmentTotals(db, teacherId, student.id, period),
      note: 'نمرهٔ آزمون‌های درسی در شاخص‌های شناختی هیچ نقشی ندارد.',
    },
    activities: { total: sorted.length, page, pageSize, pages, items: full ? items : items.slice(0, 5), shown: full ? 'page' : 'latest5' },
    analysis,
    periodOptions: {
      currentYear: academicYearAt(now).label, previousYear: academicYearAt(new Date(Date.parse(academicYearAt(now).from) - 86_400_000)).label,
      firstResultAt: firstAt, hasPreviousYearData: !!firstAt && firstAt < academicYearAt(now).from,
    },
    metadata: {
      generatedAt: now.toISOString(), generatedAtJalali: jalaliText(now), version: 1, disclaimer: REPORT_DISCLAIMER,
      dataPolicy: 'فقط نتایج کامل و معتبرِ فعالیت‌های منتشرشده و آزمون‌های انجام‌شده؛ پیش‌نویس، پیش‌نمایش معلم و نتایج ناقص وارد نمی‌شوند. هیچ داده‌ای تخمین یا ساخته نمی‌شود.',
    },
  };
}
export type StudentReport = Awaited<ReturnType<typeof buildReport>>;

/** Correct / wrong / unanswered over the assessments inside the window (own tables; never part of the cognitive profile). */
async function assessmentTotals(db: D1Database, teacherId: string, studentId: string, p: ResolvedPeriod) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(r.total),0) AS total, COALESCE(SUM(r.correct),0) AS correct, COALESCE(SUM(r.unanswered),0) AS unanswered
       FROM assessment_students x JOIN assessments a ON a.id = x.assessment_id
       JOIN assessment_attempts t ON t.assessment_student_id = x.id AND t.status = 'completed' JOIN assessment_results r ON r.attempt_id = t.id
      WHERE x.student_id = ?1 AND a.teacher_id = ?2 AND x.status = 'completed' AND a.status IN ('published','archived') AND r.total > 0
        AND COALESCE(x.completed_at, r.created_at) >= ?3 AND COALESCE(x.completed_at, r.created_at) < ?4`,
  ).bind(studentId, teacherId, p.from, p.to).first<{ n: number; total: number; correct: number; unanswered: number }>();
  if (!row || row.n === 0) return null;
  const wrong = Math.max(0, row.total - row.correct - row.unanswered);
  return { exams: row.n, questions: row.total, correct: row.correct, wrong, unanswered: row.unanswered, successPercent: r1((row.correct / row.total) * 100) };
}
