import { MIN_SAMPLES, performanceStatus, trendFromSeries, type TrendResult } from './status';
import type { GameMetrics, GameType, PerformanceStatus } from './types';

export interface StoredResult { createdAt: string; metrics: GameMetrics }

export interface GameAggregate {
  game: GameType;
  sessionCount: number;
  sampleCount: number;
  accuracy: number | null;
  averageResponseTime: number | null;
  highestDifficulty: number | null;
  independentAccuracy: number | null;
  helpResponsiveness: number | null;
  guidedAccuracy: number | null;
  ruleAdaptation: number | null;
  reverseTaskAccuracy: number | null;
  speedScore: number | null; // internal 0..100, never shown to children
  status: PerformanceStatus;
  trend: TrendResult;
  series: { createdAt: string; accuracy: number | null; averageResponseTime: number | null; difficultyReached: number; sampleCount: number }[];
  sufficientData: boolean;
}

const r4 = (x: number | null) => (x === null ? null : Math.round(x * 10000) / 10000);
function weighted(pairs: [number | null, number][]): number | null {
  let s = 0, w = 0;
  for (const [v, wt] of pairs) if (v !== null && wt > 0) { s += v * wt; w += wt; }
  return w ? s / w : null;
}
const meanOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function speedScoreFromMs(ms: number | null): number | null {
  if (ms === null) return null;
  // 100 at <=1500ms, 0 at >=8000ms, linear. Internal use only.
  return Math.round(Math.max(0, Math.min(100, ((8000 - ms) / 6500) * 100)));
}

export function aggregateGame(game: GameType, results: StoredResult[]): GameAggregate {
  const sorted = [...results].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ms = sorted.map((r) => r.metrics);
  const sampleCount = ms.reduce((a, m) => a + m.sampleCount, 0);
  const accuracy = weighted(ms.map((m) => [m.accuracy, m.sampleCount]));
  const avgRt = weighted(ms.map((m) => [m.averageResponseTime, m.sampleCount]));
  const series = sorted.map((r) => ({
    createdAt: r.createdAt,
    accuracy: r.metrics.accuracy,
    averageResponseTime: r.metrics.averageResponseTime,
    difficultyReached: r.metrics.difficultyReached,
    sampleCount: r.metrics.sampleCount,
  }));
  const accSeries = series.map((s) => s.accuracy).filter((x): x is number => x !== null);
  return {
    game,
    sessionCount: sorted.length,
    sampleCount,
    accuracy: r4(accuracy),
    averageResponseTime: avgRt === null ? null : Math.round(avgRt),
    highestDifficulty: ms.length ? Math.max(...ms.map((m) => m.difficultyReached)) : null,
    independentAccuracy: r4(weighted(ms.map((m) => [m.independenceScore, m.sampleCount]))),
    helpResponsiveness: r4(weighted(ms.map((m) => [m.helpResponseScore, m.details.helpItems ?? 0]))),
    guidedAccuracy: game === 'problem_solving' ? r4(accuracy) : null,
    ruleAdaptation: r4(meanOf(ms.map((m) => m.details.ruleAdaptation ?? null))),
    reverseTaskAccuracy: r4(weighted(ms.map((m) => [m.details.reverseTaskAccuracy ?? null, m.details.reverseCount ?? 0]))),
    speedScore: speedScoreFromMs(avgRt),
    status: performanceStatus(accuracy, sampleCount),
    trend: trendFromSeries(accSeries),
    series,
    sufficientData: sampleCount >= MIN_SAMPLES,
  };
}
