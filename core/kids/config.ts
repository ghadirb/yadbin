import type { GameId } from './types';

/** Everything tunable lives here (spec §25: hard ceiling must be configurable). */
export interface KidsConfig {
  minAge: number;
  maxAge: number;
  /** Highest difficulty level any game offers. */
  maxLevel: number;
  /** age (years) → baseline level. Ages outside the table use the nearest edge. */
  ageBaseLevel: Record<number, number>;
  /** HARD CEILING: a child never plays more than this many levels above their age baseline. (age_band 7 → max_allowed_band 8 ⇒ 1) */
  maxLevelsAboveBase: number;
  /** A child is never pushed more than this many levels below baseline either. */
  maxLevelsBelowBase: number;
  adaptive: {
    /** sessions needed at the current level before ANY change (fail-safe: not enough data → hold). */
    minSessionsAtLevel: number;
    upPerformance: number;   // each of the last `window` sessions must be ≥ this to go up
    downPerformance: number; // each of the last `window` sessions must be < this to go down
    window: number;
    /** A single catastrophic session (e.g. abandoned in tears) may lower the level by one on its own. */
    emergencyDownPerformance: number;
    /** Population std-dev above which performance is "fluctuating" → hold the level. */
    fluctuationSd: number;
    /** After any change, wait this many sessions before the next change (gradual progression). */
    cooldownSessions: number;
    historySize: number;
  };
  growth: {
    /** Number of most-recent signals averaged into a skill score (moving average). */
    window: number;
    /** Fewer signals than this ⇒ no score and no trend is claimed. */
    minSignals: number;
    /** Minimum signals needed (per half) before a trend is claimed. */
    minPerHalfForTrend: number;
    /** Score-point change that counts as «بهبود»/«کاهش»; smaller ⇒ «پایدار». */
    trendThreshold: number;
  };
  journey: {
    gamesPerJourney: number;
    targetMinutes: number;
    /** Soft daily cap: past it the child is told it is a good time to stop. */
    maxDailyMinutes: number;
    /** After this many games with short gaps, suggest a short rest. */
    restAfterGamesInRow: number;
    /** Gap shorter than this keeps games "in a row". */
    inRowGapMs: number;
    recentDays: number;
  };
}

export const DEFAULT_KIDS_CONFIG: KidsConfig = {
  minAge: 4,
  maxAge: 12,
  maxLevel: 10,
  ageBaseLevel: { 4: 1, 5: 2, 6: 3, 7: 4, 8: 5, 9: 6, 10: 7, 11: 8, 12: 9 },
  maxLevelsAboveBase: 1,
  maxLevelsBelowBase: 2,
  adaptive: { minSessionsAtLevel: 2, upPerformance: 0.82, downPerformance: 0.45, window: 2, emergencyDownPerformance: 0.2, fluctuationSd: 0.22, cooldownSessions: 2, historySize: 8 },
  growth: { window: 6, minSignals: 3, minPerHalfForTrend: 2, trendThreshold: 5 },
  journey: { gamesPerJourney: 3, targetMinutes: 12, maxDailyMinutes: 25, restAfterGamesInRow: 3, inRowGapMs: 3 * 60_000, recentDays: 14 },
};

export type PartialConfig = { [K in keyof KidsConfig]?: KidsConfig[K] extends object ? Partial<KidsConfig[K]> : KidsConfig[K] };

export function resolveConfig(p: PartialConfig = {}): KidsConfig {
  const d = DEFAULT_KIDS_CONFIG;
  return {
    ...d, ...(p as object),
    ageBaseLevel: { ...d.ageBaseLevel, ...(p.ageBaseLevel ?? {}) },
    adaptive: { ...d.adaptive, ...(p.adaptive ?? {}) },
    growth: { ...d.growth, ...(p.growth ?? {}) },
    journey: { ...d.journey, ...(p.journey ?? {}) },
  } as KidsConfig;
}

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function isSupportedAge(age: number, cfg: KidsConfig = DEFAULT_KIDS_CONFIG): boolean {
  return Number.isInteger(age) && age >= cfg.minAge && age <= cfg.maxAge;
}

/** Age is only the STARTING POINT (spec §5). */
export function baseLevelForAge(age: number, cfg: KidsConfig = DEFAULT_KIDS_CONFIG): number {
  const a = clamp(Math.round(age), cfg.minAge, cfg.maxAge);
  return clamp(cfg.ageBaseLevel[a] ?? 1, 1, cfg.maxLevel);
}
export const levelFloor = (age: number, cfg: KidsConfig = DEFAULT_KIDS_CONFIG) => clamp(baseLevelForAge(age, cfg) - cfg.maxLevelsBelowBase, 1, cfg.maxLevel);
/** The hard ceiling for this child (spec §25). */
export const levelCeiling = (age: number, cfg: KidsConfig = DEFAULT_KIDS_CONFIG) => clamp(baseLevelForAge(age, cfg) + cfg.maxLevelsAboveBase, 1, cfg.maxLevel);

/** 7 → "7", one above → "7+", two above → "7++", one below → "7-". Internal / parent-facing only. */
export function levelBandLabel(level: number, age: number, cfg: KidsConfig = DEFAULT_KIDS_CONFIG): string {
  const d = level - baseLevelForAge(age, cfg);
  const a = String(clamp(Math.round(age), cfg.minAge, cfg.maxAge));
  return d === 0 ? a : d > 0 ? a + '+'.repeat(d) : a + '-'.repeat(-d);
}

