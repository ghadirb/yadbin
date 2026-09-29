import type { PerformanceStatus, TrendDirection } from './types';

/** Minimum number of observed items before any conclusion is drawn. */
export const MIN_SAMPLES = 8;
export const STATUS_LABELS_FA: Record<PerformanceStatus, string> = {
  good: 'عملکرد خوب',
  average: 'عملکرد متوسط',
  needs_practice: 'نیاز به تمرین بیشتر',
  insufficient: 'داده کافی نیست',
};

export function performanceStatus(accuracy: number | null, sampleCount: number): PerformanceStatus {
  if (accuracy === null || sampleCount < MIN_SAMPLES) return 'insufficient';
  if (accuracy >= 0.8) return 'good';
  if (accuracy >= 0.5) return 'average';
  return 'needs_practice';
}

export interface TrendResult {
  direction: TrendDirection;
  sessionCount: number;
  /** 'preliminary' with 2 sessions, 'moderate' with 3+. */
  confidence: 'none' | 'preliminary' | 'moderate';
}

/** series: per-session accuracy (0..1), oldest first. Needs >= 2 sessions. */
export function trendFromSeries(series: number[]): TrendResult {
  const n = series.length;
  if (n < 2) return { direction: 'insufficient', sessionCount: n, confidence: 'none' };
  let change: number;
  if (n === 2) change = series[1] - series[0];
  else {
    // least-squares slope * (n-1) = fitted total change across sessions
    const xm = (n - 1) / 2;
    const ym = series.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    series.forEach((y, x) => { num += (x - xm) * (y - ym); den += (x - xm) ** 2; });
    change = (num / den) * (n - 1);
  }
  const direction: TrendDirection = change >= 0.05 ? 'up' : change <= -0.05 ? 'down' : 'stable';
  return { direction, sessionCount: n, confidence: n >= 3 ? 'moderate' : 'preliminary' };
}

/** Next difficulty, evaluated after each block of 3 items. One mistake alone can't drop the level. */
export function nextDifficulty(current: number, blockAccuracy: number): number {
  const next = blockAccuracy >= 0.8 ? current + 1 : blockAccuracy < 0.5 ? current - 1 : current;
  return Math.max(1, Math.min(3, next));
}
export const ADAPTIVE_BLOCK_SIZE = 3;
