import { clamp, DEFAULT_KIDS_CONFIG, type KidsConfig } from './config';
import { GAME_SPECS } from './games/specs';
import { SKILL_META } from './content';
import { GAME_IDS, SKILLS, type GameId, type Skill } from './types';

export interface SignalRecord { skill: Skill; value: number; weight: number; at: string }
export type TrendDir = 'up' | 'stable' | 'down' | 'insufficient';
export type SkillLabel = 'very_good' | 'good' | 'average' | 'practice' | 'collecting';
export const LABEL_FA: Record<SkillLabel, string> = { very_good: 'بسیار خوب', good: 'خوب', average: 'متوسط', practice: 'در حال تمرین', collecting: 'در حال جمع‌آوری' };
export const ARROW: Record<TrendDir, string> = { up: '↑', stable: '→', down: '↓', insufficient: '…' };
export const TREND_FA: Record<TrendDir, string> = { up: 'رو به رشد', stable: 'پایدار', down: 'کمی کمتر از قبل', insufficient: 'هنوز داده کافی نیست' };

/** Tehran is a fixed UTC+03:30 (same convention as the Teacher growth module). */
export const TEHRAN_OFFSET_MIN = 210;
export const localDay = (iso: string) => new Date(Date.parse(iso) + TEHRAN_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

const wmean = (xs: { v: number; w: number }[]) => { let s = 0, w = 0; for (const x of xs) { s += x.v * x.w; w += x.w; } return w ? s / w : null; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export interface SkillGrowth { skill: Skill; score: number | null; samples: number; trend: TrendDir; label: SkillLabel; series: { day: string; value: number }[] }

export function labelFor(score: number | null): SkillLabel { return score === null ? 'collecting' : score >= 80 ? 'very_good' : score >= 65 ? 'good' : score >= 45 ? 'average' : 'practice'; }

/**
 * Trend = MEDIAN of the latest k signals vs MEDIAN of the k before (k ≤ 3). Medians + a minimum sample size mean one weak
 * game can never flip the arrow (spec §15). Fewer than 2k signals ⇒ «insufficient», no claim is made.
 */
export function trendOf(values: number[], cfg: KidsConfig = DEFAULT_KIDS_CONFIG): TrendDir {
  const k = Math.min(3, Math.floor(values.length / 2));
  if (k < cfg.growth.minPerHalfForTrend) return 'insufficient';
  const recent = median(values.slice(-k)), earlier = median(values.slice(-2 * k, -k));
  const d = recent - earlier;
  return d >= cfg.growth.trendThreshold ? 'up' : d <= -cfg.growth.trendThreshold ? 'down' : 'stable';
}

/** Score = average of the moving-average window's mean and median (robust to a single outlier). */
export function scoreOf(values: { v: number; w: number }[], cfg: KidsConfig = DEFAULT_KIDS_CONFIG): number | null {
  const win = values.slice(-cfg.growth.window);
  if (win.length < cfg.growth.minSignals) return null;
  const m = wmean(win) as number;
  return Math.round(clamp(0.5 * m + 0.5 * median(win.map((x) => x.v)), 0, 100));
}

/** Per-day weighted average, smoothed with a 3-point moving average, for charts. */
export function dailySeries(signals: SignalRecord[]): { day: string; value: number }[] {
  const byDay = new Map<string, { v: number; w: number }[]>();
  for (const s of signals) { const d = localDay(s.at); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push({ v: s.value, w: s.weight }); }
  const days = [...byDay.keys()].sort();
  const raw = days.map((d) => wmean(byDay.get(d)!) as number);
  return days.map((day, i) => ({ day, value: Math.round(mean3(raw, i)) }));
}
const mean3 = (a: number[], i: number) => { const s = a.slice(Math.max(0, i - 2), i + 1); return s.reduce((x, y) => x + y, 0) / s.length; };

export function computeSkillGrowth(signals: SignalRecord[], cfg: KidsConfig = DEFAULT_KIDS_CONFIG): SkillGrowth[] {
  const sorted = [...signals].sort((a, b) => a.at.localeCompare(b.at));
  return SKILLS.map((skill) => {
    const mine = sorted.filter((s) => s.skill === skill);
    const score = scoreOf(mine.map((s) => ({ v: s.value, w: s.weight })), cfg);
    const trend = score === null ? 'insufficient' : trendOf(mine.map((s) => s.value), cfg);
    return { skill, score, samples: mine.length, trend, label: labelFor(score), series: dailySeries(mine) };
  });
}

export interface SessionSummary { gameId: GameId; at: string; durationMs: number; level: number; performance: number; completed: boolean }
export interface ActivityStats { games: number; minutes: number; activeDays: number; gamesByGame: Partial<Record<GameId, number>> }
export function activityStats(sessions: SessionSummary[]): ActivityStats {
  const by: Partial<Record<GameId, number>> = {};
  for (const s of sessions) by[s.gameId] = (by[s.gameId] ?? 0) + 1;
  return { games: sessions.length, minutes: Math.round(sessions.reduce((a, s) => a + s.durationMs, 0) / 60_000), activeDays: new Set(sessions.map((s) => localDay(s.at))).size, gamesByGame: by };
}

/** "Does the child do better in later attempts?" — compares the first and the latest sessions of the same game. */
export function learningCurve(sessions: SessionSummary[]): { trend: TrendDir; points: { at: string; performance: number }[] } {
  const pts = [...sessions].sort((a, b) => a.at.localeCompare(b.at)).map((s) => ({ at: s.at, performance: Math.round(s.performance * 100) }));
  return { trend: trendOf(pts.map((p) => p.performance)), points: pts.slice(-30) };
}

export interface Recommendation { skill: Skill; gameId: GameId; text: string }
/** Rule-based practice suggestion (spec §20): the lowest-scoring or declining skills with enough data, else the least practised. */
export function recommend(growth: SkillGrowth[], cfg: KidsConfig = DEFAULT_KIDS_CONFIG): Recommendation[] {
  const primary = (skill: Skill) => GAME_IDS.find((g) => GAME_SPECS[g].skill === skill);
  const candidates = growth.filter((g) => primary(g.skill) && g.skill !== 'learning' && g.skill !== 'processing_speed');
  const measured = candidates.filter((g) => g.score !== null).sort((a, b) => ((a.trend === 'down' ? -10 : 0) + (a.score as number)) - ((b.trend === 'down' ? -10 : 0) + (b.score as number)));
  const unmeasured = candidates.filter((g) => g.score === null).sort((a, b) => a.samples - b.samples);
  const picks = [...unmeasured.slice(0, 1), ...measured.filter((g) => g.label === 'practice' || g.label === 'average' || g.trend === 'down').slice(0, 2)].slice(0, 2);
  void cfg;
  return picks.map((g) => ({ skill: g.skill, gameId: primary(g.skill) as GameId, text: `بازی‌های «${SKILL_META[g.skill].name}» برای ۳ جلسهٔ آینده` }));
}
