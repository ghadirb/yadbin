// Pure builders that turn raw child interactions into the event records defined in the spec.
import type { AttentionEvent, MemoryEvent, ProblemEvent } from '../scoring';

const clampMs = (n: number) => Math.max(0, Math.min(600_000, Math.round(n)));

export function buildMemoryEvent(q: any, taps: string[], responseTimeMs: number): { event: MemoryEvent; correct: boolean } {
  const target: string[] = q.isReverse ? [...q.sequence].reverse() : q.sequence;
  let mistakes = 0;
  for (let i = 0; i < taps.length; i++) if (taps[i] !== target[i]) mistakes++;
  const correct = taps.length === target.length && mistakes === 0;
  return {
    correct,
    event: {
      sequenceLength: q.sequence.length, displayDuration: q.displayDuration, difficulty: q.difficulty,
      isReverse: !!q.isReverse, correct, attempts: 1, responseTime: clampMs(responseTimeMs), mistakes: Math.min(50, mistakes),
    },
  };
}

export function buildAttentionEvent(q: any, selected: number[], firstTapMs: number | null, totalMs: number): AttentionEvent {
  const sel = [...new Set(selected)];
  let correctTargets = 0, wrongTargets = 0, falseClicks = 0;
  for (const i of sel) {
    const color = q.cells[i];
    if (color === q.rule.select) correctTargets++;
    else if (q.rule.avoid && color === q.rule.avoid) wrongTargets++;
    else falseClicks++;
  }
  return {
    gridSize: q.gridSize, targetType: q.rule.select, targetCount: q.targetCount, correctTargets, wrongTargets,
    missedTargets: Math.max(0, q.targetCount - correctTargets), falseClicks, reactionTime: firstTapMs === null ? 0 : clampMs(firstTapMs),
    totalTime: clampMs(totalMs), difficulty: q.difficulty, ruleChanged: !!q.ruleChanged, phase: q.phase ?? 'none',
  };
}

export function buildProblemEvent(q: any, attempts: number, hintsUsed: number, finalAnswer: number | null, responseTimeMs: number): { event: ProblemEvent; correct: boolean } {
  const correct = finalAnswer === q.correctOption;
  return {
    correct,
    event: { questionId: q.id, difficulty: q.difficulty, attempts: Math.max(1, Math.min(20, attempts)), hintsUsed: Math.max(0, Math.min(3, hintsUsed)), responseTime: clampMs(responseTimeMs), finalAnswer },
  };
}
