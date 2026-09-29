import { aggregateGame, GAME_TYPES, recommend, type GameAggregate, type GameType, type StoredResult, STATUS_LABELS_FA, NO_SUGGESTION_TEXT_FA } from '../scoring';
import { nowIso } from '../utils/ids';

export async function loadGameResults(db: D1Database, studentId: string, game: GameType): Promise<StoredResult[]> {
  const { results } = await db.prepare(
    `SELECT r.created_at, r.raw_result_json FROM game_results r
       JOIN game_sessions s ON s.id = r.session_id
       JOIN activity_students a ON a.id = s.activity_student_id
      WHERE a.student_id = ? AND s.game_type = ? ORDER BY r.created_at ASC`,
  ).bind(studentId, game).all<{ created_at: string; raw_result_json: string }>();
  const out: StoredResult[] = [];
  for (const r of results) {
    try { out.push({ createdAt: r.created_at, metrics: JSON.parse(r.raw_result_json).computed }); } catch { /* skip corrupt row */ }
  }
  return out;
}

export async function recomputeStudentMetrics(db: D1Database, studentId: string, game: GameType): Promise<GameAggregate> {
  const agg = aggregateGame(game, await loadGameResults(db, studentId, game));
  if (agg.sessionCount === 0) {
    await db.prepare('DELETE FROM student_metrics WHERE student_id = ? AND game_type = ?').bind(studentId, game).run();
    return agg;
  }
  await db.prepare(
    `INSERT INTO student_metrics (student_id, game_type, accuracy, speed_score, independence_score, help_response_score, trend, sample_count, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(student_id, game_type) DO UPDATE SET accuracy=excluded.accuracy, speed_score=excluded.speed_score,
       independence_score=excluded.independence_score, help_response_score=excluded.help_response_score,
       trend=excluded.trend, sample_count=excluded.sample_count, updated_at=excluded.updated_at`,
  ).bind(studentId, game, agg.accuracy, agg.speedScore, agg.independentAccuracy, agg.helpResponsiveness, agg.trend.direction, agg.sampleCount, nowIso()).run();
  return agg;
}

const SKILL_TITLES: Record<GameType, string> = {
  memory: 'حافظه و یادآوری',
  attention: 'توجه و کنترل پاسخ',
  problem_solving: 'حل مسئله',
};
const GAME_NAMES: Record<GameType, string> = { memory: 'به خاطر بسپار', attention: 'پیداش کن', problem_solving: 'راهش را پیدا کن' };
const TREND_LABELS = {
  up: 'در فعالیت‌های انجام‌شده، عملکرد مشاهده‌شده افزایش یافته است.',
  stable: 'در فعالیت‌های انجام‌شده، عملکرد مشاهده‌شده تقریباً ثابت بوده است.',
  down: 'در فعالیت‌های انجام‌شده، عملکرد مشاهده‌شده کاهش یافته است.',
  insufficient: 'برای نمایش روند، فعالیت‌های بیشتری لازم است.',
};

export function skillCard(agg: GameAggregate) {
  const enough = agg.sufficientData;
  const showTrend = agg.trend.direction !== 'insufficient';
  return {
    game: agg.game,
    title: SKILL_TITLES[agg.game],
    gameName: GAME_NAMES[agg.game],
    status: agg.status,
    statusLabel: STATUS_LABELS_FA[agg.status],
    sufficientData: enough,
    message: enough ? null : 'داده کافی نیست.',
    sessionCount: agg.sessionCount,
    sampleCount: agg.sampleCount,
    // No conclusions from insufficient data: numeric values are withheld until enough samples exist.
    accuracy: enough ? agg.accuracy : null,
    averageResponseTime: enough ? agg.averageResponseTime : null,
    highestDifficulty: enough ? agg.highestDifficulty : null,
    independentAccuracy: enough ? agg.independentAccuracy : null,
    guidedAccuracy: enough ? agg.guidedAccuracy : null,
    helpResponsiveness: enough ? agg.helpResponsiveness : null,
    ruleAdaptation: enough ? agg.ruleAdaptation : null,
    reverseTaskAccuracy: enough ? agg.reverseTaskAccuracy : null,
    trend: {
      title: 'روند عملکرد مشاهده‌شده',
      direction: agg.trend.direction,
      confidence: agg.trend.confidence,
      sessionCount: agg.trend.sessionCount,
      label: TREND_LABELS[agg.trend.direction],
      note: agg.trend.confidence === 'preliminary' ? 'این روند اولیه است؛ با ۳ جلسه یا بیشتر معنادارتر می‌شود.' : null,
    },
    series: showTrend
      ? agg.series.map((s, i) => ({ session: i + 1, createdAt: s.createdAt, accuracy: s.accuracy, averageResponseTime: s.averageResponseTime, difficultyReached: s.difficultyReached }))
      : [],
  };
}

export async function buildStudentReport(db: D1Database, student: { id: string; display_name: string }) {
  const aggs: Partial<Record<GameType, GameAggregate>> = {};
  for (const g of GAME_TYPES) aggs[g] = aggregateGame(g, await loadGameResults(db, student.id, g));
  const done = await db.prepare(
    `SELECT COUNT(*) AS n, MAX(completed_at) AS last FROM activity_students WHERE student_id = ? AND status = 'completed'`,
  ).bind(student.id).first<{ n: number; last: string | null }>();
  const suggestions = recommend(aggs).map((s) => ({ ...s, label: 'پیشنهاد سیستم', gameName: GAME_NAMES[s.gameType] }));
  return {
    student: { id: student.id, name: student.display_name },
    completedActivities: done?.n ?? 0,
    lastActivityAt: done?.last ?? null,
    skills: GAME_TYPES.map((g) => skillCard(aggs[g]!)),
    suggestions,
    suggestionFallback: suggestions.length ? null : NO_SUGGESTION_TEXT_FA,
    notice: 'همه‌ی نتایج فقط «عملکرد مشاهده‌شده در فعالیت‌های این سیستم» است و تشخیص یا رتبه‌بندی نیست. تصمیم نهایی با معلم است.',
  };
}
