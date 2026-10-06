import { GAME_FOR_SKILL, levelLabel, SKILLS } from '../education/catalog';
import { loadAggregates, studentContext } from '../services/metrics';
import { recommendActivities } from '../education/insights';
import { HttpError } from '../utils/http';
import {
  buildAiFacts, buildAnalysis, buildAssessmentGrowth, buildOverview, buildSkills, buildTimeline, chooseBucket, classifyTrend, GAME_SKILL_FA,
  MIN_BUCKETS_FOR_CHART, MIN_RESULTS_FOR_TREND, MSG_NOT_ENOUGH_ACTIVITIES, MSG_NOT_ENOUGH_RANGE, pct, r1, RANGE_LABELS_FA, rangeWindow,
  type AssessmentResult, type CogResult, type Game, type RangeKey,
} from './compute';

export interface GrowthFilters { range: RangeKey; game?: Game; skill?: string; level?: string; subject?: string }

/** `skill` is a skill code from the catalog (memory, focus, reaction_speed…); it maps to the cognitive game that trains it. */
export function resolveGameFilter(f: GrowthFilters): Game | 'none' | undefined {
  const bySkill = f.skill ? (GAME_FOR_SKILL[f.skill] as Game | undefined) : undefined;
  if (f.skill && !SKILLS.some((s) => s.code === f.skill)) throw new HttpError(400, 'validation_error', 'مهارت معتبر نیست.');
  if (f.game && bySkill && f.game !== bySkill) return 'none';
  return f.game ?? bySkill;
}

interface CogRow {
  created_at: string; accuracy: number; sample_count: number; average_response_time: number | null; difficulty_reached: number | null;
  game_type: Game; activity_id: string; title: string | null; activity_level: string | null;
}

/**
 * VALID cognitive results of one student (same source as the Reports: game_results), restricted to
 *  - sessions that are completed and whose activity link was completed,
 *  - activities of THIS teacher in publish_state = 'published' (draft / unpublished never count),
 *  - results with a real accuracy in 0..1 and at least one answered item (incomplete results are skipped).
 * Teacher preview sessions live in their own table (teacher_preview_sessions) and never reach game_results.
 */
export async function loadCognitiveResults(db: D1Database, teacherId: string, studentId: string, sinceIso: string | null, untilIso: string | null = null): Promise<CogResult[]> {
  const { results } = await db.prepare(
    `SELECT r.created_at, r.accuracy, r.sample_count, r.average_response_time, r.difficulty_reached, gs.game_type,
            a.id AS activity_id, a.title, a.activity_level
       FROM game_results r
       JOIN game_sessions gs ON gs.id = r.session_id
       JOIN activity_students ast ON ast.id = gs.activity_student_id
       JOIN activities a ON a.id = ast.activity_id
      WHERE ast.student_id = ?1 AND a.teacher_id = ?2 AND a.publish_state = 'published'
        AND ast.status = 'completed' AND gs.status = 'completed'
        AND r.accuracy IS NOT NULL AND r.accuracy >= 0 AND r.accuracy <= 1 AND r.sample_count > 0
        AND (?3 IS NULL OR r.created_at >= ?3) AND (?4 IS NULL OR r.created_at < ?4)
      ORDER BY r.created_at ASC LIMIT 5000`,
  ).bind(studentId, teacherId, sinceIso, untilIso).all<CogRow>();
  return results.map((r) => ({
    at: r.created_at, accuracy: r.accuracy, samples: r.sample_count, avgResponseMs: r.average_response_time, difficulty: r.difficulty_reached,
    game: r.game_type, activityId: r.activity_id, title: r.title || GAME_TITLE[r.game_type] || r.game_type, level: r.activity_level,
  }));
}
const GAME_TITLE: Record<string, string> = { memory: 'به خاطر بسپار', attention: 'پیداش کن', problem_solving: 'راهش را پیدا کن' };

/** Completed, scored attempts of teacher assessments (own tables; never mixed with the cognitive profile). Drafts / previews are not assigned to students. */
export async function loadAssessmentResults(db: D1Database, teacherId: string, studentId: string, sinceIso: string | null, untilIso: string | null = null): Promise<AssessmentResult[]> {
  const { results } = await db.prepare(
    `SELECT a.id AS assessment_id, a.title, a.subject, r.percent, r.total, COALESCE(x.completed_at, r.created_at) AS at
       FROM assessment_students x
       JOIN assessments a ON a.id = x.assessment_id
       JOIN assessment_attempts t ON t.assessment_student_id = x.id AND t.status = 'completed'
       JOIN assessment_results r ON r.attempt_id = t.id
      WHERE x.student_id = ?1 AND a.teacher_id = ?2 AND x.status = 'completed' AND a.status IN ('published','archived') AND r.total > 0
        AND (?3 IS NULL OR COALESCE(x.completed_at, r.created_at) >= ?3) AND (?4 IS NULL OR COALESCE(x.completed_at, r.created_at) < ?4)
      ORDER BY at ASC LIMIT 2000`,
  ).bind(studentId, teacherId, sinceIso, untilIso).all<{ assessment_id: string; title: string; subject: string | null; percent: number; total: number; at: string }>();
  return results.map((r) => ({ assessmentId: r.assessment_id, title: r.title, subject: r.subject, at: r.at, percent: r.percent, total: r.total }));
}

const inWindow = (at: string, from: string | null, to: string | null) => (from === null || at >= from) && (to === null || at < to);

/** GET /students/:id/growth — everything is aggregated here; raw results are never sent to the client. */
export async function buildGrowth(db: D1Database, teacherId: string, student: { id: string; display_name: string }, f: GrowthFilters, now: Date = new Date()) {
  const win = rangeWindow(f.range, now);
  const [allCog, allAss] = await Promise.all([
    loadCognitiveResults(db, teacherId, student.id, win.previousFrom ?? win.from),
    loadAssessmentResults(db, teacherId, student.id, win.from),
  ]);

  const gameFilter = resolveGameFilter(f);
  const passCog = (r: CogResult) => gameFilter !== 'none' && (!gameFilter || r.game === gameFilter) && (!f.level || r.level === f.level);
  const cogFiltered = allCog.filter(passCog);
  // `to` is exclusive for the previous window (it equals the start of the current one); the current window runs up to now.
  const cur = cogFiltered.filter((r) => inWindow(r.at, win.from, null));
  const prev = f.range === 'all' ? null : cogFiltered.filter((r) => inWindow(r.at, win.previousFrom, win.previousTo));
  const assessments = allAss.filter((r) => !f.subject || (r.subject?.trim() || 'بدون درس مشخص') === f.subject);
  const growthAss = buildAssessmentGrowth(assessments);

  const overview = buildOverview(cur, prev, growthAss.count, assessments.length ? assessments.reduce((m, r) => (r.at > m ? r.at : m), assessments[0].at) : null);
  const skills = buildSkills(cur);

  // ----- chart: aggregated points only; nothing is invented when data is thin -----
  const bucket = chooseBucket(f.range, cur[0]?.at, cur[cur.length - 1]?.at);
  const points = buildTimeline(cur, bucket);
  const chartOk = cur.length >= MIN_RESULTS_FOR_TREND && points.length >= MIN_BUCKETS_FOR_CHART;
  const timelineMessage = chartOk ? null : cur.length === 0 ? MSG_NOT_ENOUGH_RANGE : cur.length < MIN_RESULTS_FOR_TREND ? MSG_NOT_ENOUGH_ACTIVITIES : MSG_NOT_ENOUGH_RANGE;
  const overallTrend = classifyTrend(cur.map((r) => r.accuracy));

  // ----- recent / most-changed activities -----
  const lastBefore = new Map<string, number>(); // game → previous accuracy while walking forward in time
  const withChange = allCog.map((r) => { const p = lastBefore.get(r.game); lastBefore.set(r.game, r.accuracy); return { r, changePoints: p === undefined ? null : r1(pct(r.accuracy) - pct(p)) }; });
  const shown = withChange.filter((x) => passCog(x.r) && inWindow(x.r.at, win.from, null));
  const row = (x: (typeof shown)[number]) => ({
    activityId: x.r.activityId, title: x.r.title, date: x.r.at, gameType: x.r.game, skill: GAME_SKILL_FA[x.r.game], level: x.r.level, levelLabel: levelLabel(x.r.level),
    percent: pct(x.r.accuracy), answers: x.r.samples, averageResponseSeconds: x.r.avgResponseMs === null ? null : r1(x.r.avgResponseMs / 1000), difficultyReached: x.r.difficulty,
    status: 'completed', statusLabel: 'انجام‌شده', changePoints: x.changePoints,
  });
  const recent = [...shown].reverse().slice(0, 10).map(row);
  const mostChanged = shown.filter((x) => x.changePoints !== null).sort((a, b) => Math.abs(b.changePoints!) - Math.abs(a.changePoints!)).slice(0, 3).map(row);

  const analysis = buildAnalysis(skills, overview, growthAss);

  // ----- educational next-activity suggestion: reuses the existing recommendation engine (teacher still approves everything) -----
  const sctx = await studentContext(db, student);
  const rec = recommendActivities(await loadAggregates(db, student.id), sctx.ctx)[0] ?? null;

  const levels = [...new Set(allCog.map((r) => r.level).filter((x): x is string => !!x))];
  const games = [...new Set(allCog.map((r) => r.game))];
  const subjects = [...new Set(allAss.map((r) => r.subject?.trim() || 'بدون درس مشخص'))];

  return {
    student: { id: student.id, name: student.display_name },
    range: f.range, rangeLabel: RANGE_LABELS_FA[f.range],
    window: { from: win.from, to: win.to, previousFrom: win.previousFrom, previousTo: win.previousTo, bucket, timeZone: 'Asia/Tehran' },
    filters: {
      applied: { range: f.range, game: f.game ?? null, skill: f.skill ?? null, level: f.level ?? null, subject: f.subject ?? null },
      available: { ranges: Object.entries(RANGE_LABELS_FA).map(([code, label]) => ({ code, label })), games: games.map((g) => ({ code: g, label: GAME_SKILL_FA[g] })), levels: levels.map((l) => ({ code: l, label: levelLabel(l) })), subjects },
    },
    overview,
    cognitive: {
      section: 'cognitive_growth', title: 'رشد در فعالیت‌های شناختی',
      timeline: { available: chartOk, message: timelineMessage, bucket, yAxis: 'percent', points: chartOk ? points : [], trend: overallTrend },
      skills,
      skillsMessage: skills.length ? null : 'در این بازه برای هیچ مهارتی نتیجهٔ معتبر ثبت نشده است.',
      activities: { recent, mostChanged },
    },
    assessments: { section: 'academic_assessments', title: 'روند آزمون‌های درسی', ...growthAss, note: 'نمرهٔ آزمون‌های درسی در شاخص‌های شناختی (حافظه، توجه، حل مسئله) هیچ نقشی ندارد.' },
    analysis,
    suggestion: rec ? { text: rec.text, reason: rec.reason, skill: rec.skillLabel, gameType: rec.gameType, level: rec.level, levelLabel: rec.levelLabel, prefill: rec.prefill, requiresTeacherApproval: true } : null,
    notice: 'این صفحه رشد دانش‌آموز را نسبت به گذشتهٔ خودش نشان می‌دهد؛ مقایسه با دانش‌آموزان دیگر یا رتبه‌بندی وجود ندارد و هیچ تشخیصی ارائه نمی‌شود.',
  };
}

export { buildAiFacts };
