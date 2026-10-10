import { clamp } from './config';
import { GAME_SPECS } from './games/specs';
import type { GameId, GameSpec, SessionMetrics, SessionRaw, SkillSignal, Trial } from './types';

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Multi-dimensional metrics (spec §14). Pure & deterministic: the Worker recomputes them from raw trials. */
export function computeMetrics(raw: SessionRaw, spec: GameSpec = GAME_SPECS[raw.gameId]): SessionMetrics {
  const t = raw.trials;
  const n = t.length;
  const correct = t.filter((x) => x.correct).length;
  const accuracy = n ? correct / n : 0;
  const errors = t.reduce((a, x) => a + x.errors, 0);
  const attempts = t.reduce((a, x) => a + x.attempts, 0);
  let best = 0, run = 0;
  for (const x of t) { run = x.correct ? run + 1 : 0; best = Math.max(best, run); }
  const rts = t.map((x) => x.rtMs).filter((x): x is number => x !== null && x >= 0);
  const completion = raw.completed ? 1 : clamp(n / Math.max(1, expectedTrials(raw.gameId, raw.level)), 0, 1);

  let learningDelta: number | null = null;
  if (n >= 6) {
    const h = n >> 1;
    const acc = (xs: Trial[]) => xs.filter((x) => x.correct).length / xs.length;
    learningDelta = r4(acc(t.slice(n - h)) - acc(t.slice(0, h)));
  }
  let recoveryDelta: number | null = null;
  const after = t.filter((_, i) => i > 0 && (t[i - 1].errors > 0 || !t[i - 1].correct));
  if (after.length >= 2) recoveryDelta = r4(after.filter((x) => x.correct).length / after.length - accuracy);

  const sw = t.filter((x) => x.tag === 'switch' && x.rtMs !== null && x.correct).map((x) => x.rtMs as number);
  const rp = t.filter((x) => x.tag === 'repeat' && x.rtMs !== null && x.correct).map((x) => x.rtMs as number);
  const switchCostMs = sw.length >= 2 && rp.length >= 2 ? Math.round((mean(sw) as number) - (mean(rp) as number)) : null;

  const errPerTrial = n ? errors / n : 0;
  const clean = 1 - clamp(errPerTrial / spec.errorsPerTrialRef, 0, 1);
  const performance = n === 0 ? 0 : r4(clamp(0.65 * accuracy + 0.2 * completion + 0.15 * clean, 0, 1));
  return { trials: n, accuracy: r4(accuracy), medianRtMs: median(rts) === null ? null : Math.round(median(rts) as number), errors, attempts, completion: r4(completion), bestStreak: best, learningDelta, recoveryDelta, switchCostMs, performance };
}

/** How many trials a finished game of this kind normally has (used only to judge completion of abandoned games). */
export function expectedTrials(gameId: GameId, level: number): number {
  const p = GAME_SPECS[gameId].paramsFor(level) as Record<string, number>;
  return gameId === 'memory_match' ? p.pairs * 2 : (p.rounds ?? p.trials ?? 8);
}

export const speedValue = (rtMs: number, spec: GameSpec) => Math.round(100 * clamp((spec.rtSlowMs - rtMs) / (spec.rtSlowMs - spec.rtFastMs), 0, 1));

/** A harder level than the age baseline is worth slightly more; an easier one slightly less (±6% per level, bounded). */
export const difficultyWeight = (level: number, baseLevel: number) => clamp(1 + 0.06 * (level - baseLevel), 0.82, 1.12);

/** Turns one finished session into per-skill signals (0..100). The primary skill always gets a signal. */
export function skillSignals(raw: SessionRaw, metrics: SessionMetrics, baseLevel: number): SkillSignal[] {
  const spec = GAME_SPECS[raw.gameId];
  const w = difficultyWeight(raw.level, baseLevel);
  const out: SkillSignal[] = [{ skill: spec.skill, value: Math.round(clamp(metrics.performance * 100 * w, 0, 100)), weight: 1 }];
  if (spec.secondary.includes('processing_speed') && metrics.medianRtMs !== null && metrics.trials >= 3) {
    // speed only counts when answers were mostly right: fast random tapping must not look like speed
    out.push({ skill: 'processing_speed', value: Math.round(speedValue(metrics.medianRtMs, spec) * (0.5 + 0.5 * metrics.accuracy)), weight: 0.6 });
  }
  if (spec.secondary.includes('learning') && metrics.learningDelta !== null) {
    const rec = metrics.recoveryDelta ?? 0;
    out.push({ skill: 'learning', value: Math.round(clamp(55 + 90 * metrics.learningDelta + 40 * rec, 0, 100)), weight: 0.5 });
  }
  return out;
}
