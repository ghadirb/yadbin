import { baseLevelForAge, clamp, DEFAULT_KIDS_CONFIG, levelCeiling, levelFloor, type KidsConfig } from './config';

/** Per-child, per-game adaptive state. Plain JSON (stored in D1 and in IndexedDB). */
export interface AdaptiveState {
  level: number;
  /** performance (0..1) of recent sessions, oldest first (capped). */
  history: number[];
  /** sessions played since the level last changed. */
  sessionsAtLevel: number;
  /** sessions left before another change is allowed. */
  cooldown: number;
  plays: number;
}
export type AdaptiveReason = 'insufficient_data' | 'cooldown' | 'sustained_success' | 'struggling' | 'emergency' | 'fluctuating' | 'steady' | 'at_ceiling' | 'at_floor' | 'bounds_correction';
export interface AdaptiveDecision { delta: -1 | 0 | 1; reason: AdaptiveReason; level: number }

/** Initial difficulty = age baseline (spec §4). Observed performance takes over after the first sessions. */
export function initialAdaptiveState(age: number, cfg: KidsConfig = DEFAULT_KIDS_CONFIG): AdaptiveState {
  return { level: baseLevelForAge(age, cfg), history: [], sessionsAtLevel: 0, cooldown: 0, plays: 0 };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

/**
 * Pure transition. Goal: maximum growth with minimum frustration, never maximum difficulty.
 *  - never moves more than ONE level per session, and never past the hard floor / ceiling;
 *  - not enough data ⇒ hold; right after a change ⇒ hold (cooldown);
 *  - up only after `window` consecutive strong sessions that are not fluctuating;
 *  - down after `window` consecutive weak sessions, or at once after one catastrophic session;
 *  - fluctuating results ⇒ hold.
 */
export function adapt(state: AdaptiveState, performance: number, age: number, cfg: KidsConfig = DEFAULT_KIDS_CONFIG): { state: AdaptiveState; decision: AdaptiveDecision } {
  const a = cfg.adaptive;
  const lo = levelFloor(age, cfg), hi = levelCeiling(age, cfg);
  const p = clamp(Number.isFinite(performance) ? performance : 0, 0, 1);
  const history = [...state.history, p].slice(-a.historySize);
  const next: AdaptiveState = { level: state.level, history, sessionsAtLevel: state.sessionsAtLevel + 1, cooldown: Math.max(0, state.cooldown - 1), plays: state.plays + 1 };
  const done = (delta: -1 | 0 | 1, reason: AdaptiveReason): { state: AdaptiveState; decision: AdaptiveDecision } => {
    if (delta !== 0) { next.level = clamp(state.level + delta, 1, cfg.maxLevel); next.sessionsAtLevel = 0; next.cooldown = a.cooldownSessions; next.history = [p]; }
    return { state: next, decision: { delta, reason, level: next.level } };
  };

  // Age changed / config tightened: walk back inside the bounds one step at a time (never a jump).
  if (state.level > hi) return done(-1, 'bounds_correction');
  if (state.level < lo) return done(1, 'bounds_correction');

  if (p < a.emergencyDownPerformance && state.level > lo && state.sessionsAtLevel >= 1) return done(-1, 'emergency');
  if (next.sessionsAtLevel < a.minSessionsAtLevel) return done(0, 'insufficient_data');
  if (state.cooldown > 0) return done(0, 'cooldown');

  const recent = history.slice(-a.window);
  if (recent.length < a.window) return done(0, 'insufficient_data');
  if (sd(history.slice(-Math.max(3, a.window))) > a.fluctuationSd) return done(0, 'fluctuating');
  if (recent.every((x) => x >= a.upPerformance)) return state.level >= hi ? done(0, 'at_ceiling') : done(1, 'sustained_success');
  if (recent.every((x) => x < a.downPerformance)) return state.level <= lo ? done(0, 'at_floor') : done(-1, 'struggling');
  return done(0, 'steady');
}
