import { ADAPTIVE_BLOCK_SIZE, nextDifficulty } from '../scoring';
import { isValidQuestion } from './validate';
import type { Question, SessionState } from './types';

/** Picks the next valid, unused question. Falls back to the nearest level when a pool runs out. */
export function pickNext(state: Pick<SessionState, 'game' | 'pools' | 'difficulty' | 'used'>): Question | null {
  const levels = [1, 2, 3].sort((a, b) => Math.abs(a - state.difficulty) - Math.abs(b - state.difficulty) || a - b);
  const preferred = [state.difficulty, ...levels.filter((l) => l !== state.difficulty)];
  for (const l of preferred) {
    for (const q of (state.pools[String(l)] ?? []) as any[]) {
      if (state.used.includes(q?.id)) continue;
      if (isValidQuestion(state.game, q)) return q;
      if (q?.id) state.used.push(q.id); // invalid: mark as consumed so it is skipped for good
    }
  }
  return null;
}

/** 0..1 quality of one item, used only for adaptive difficulty (never shown to the child). */
export function itemScore(game: SessionState['game'], e: any): number {
  if (game === 'attention') {
    const denom = (e.targetCount ?? 0) + (e.wrongTargets ?? 0) + (e.falseClicks ?? 0);
    return denom > 0 ? Math.max(0, Math.min(1, (e.correctTargets ?? 0) / denom)) : 0;
  }
  return e.correct ? 1 : 0;
}

/**
 * Adaptive rule: evaluated after every block of 3 items. >=80% up, 50-79% same, <50% down (clamped 1..3).
 * A single mistake cannot drop the level. In fixed-difficulty modes nothing changes.
 */
export function afterItem(state: SessionState, score: number): void {
  state.blockScores.push(score);
  if (state.difficultyMode !== 'adaptive' || state.blockScores.length < ADAPTIVE_BLOCK_SIZE) return;
  const acc = state.blockScores.reduce((a, b) => a + b, 0) / state.blockScores.length;
  state.difficulty = nextDifficulty(state.difficulty, acc) as 1 | 2 | 3;
  state.blockScores = [];
}
