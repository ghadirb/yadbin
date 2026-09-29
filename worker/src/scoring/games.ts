import type { AttentionEvent, GameMetrics, MemoryEvent, ProblemEvent } from './types';

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round = (x: number | null, d = 4) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function scoreMemory(events: MemoryEvent[]): GameMetrics {
  const n = events.length;
  const correct = events.filter((e) => e.correct);
  const reverse = events.filter((e) => e.isReverse);
  const rt = events.filter((e) => e.responseTime > 0).map((e) => e.responseTime);
  return {
    game: 'memory',
    sampleCount: n,
    accuracy: n ? round(correct.length / n) : null,
    averageResponseTime: round(mean(rt), 1),
    difficultyReached: n ? Math.max(...events.map((e) => e.difficulty)) : 1,
    hintsUsed: 0,
    independenceScore: null,
    helpResponseScore: null,
    details: {
      highestSuccessfulLength: correct.length ? Math.max(...correct.map((e) => e.sequenceLength)) : 0,
      reverseTaskAccuracy: reverse.length ? round(reverse.filter((e) => e.correct).length / reverse.length) : null,
      reverseCount: reverse.length,
      mistakes: events.reduce((a, e) => a + e.mistakes, 0),
    },
  };
}

export function scoreAttention(events: AttentionEvent[]): GameMetrics {
  const n = events.length;
  const acc = (list: AttentionEvent[]): number | null => {
    const t = list.reduce((a, e) => a + e.targetCount, 0);
    if (!t) return null;
    const c = list.reduce((a, e) => a + e.correctTargets, 0);
    const err = list.reduce((a, e) => a + e.wrongTargets + e.falseClicks, 0);
    return clamp01(c / (t + err));
  };
  const before = events.filter((e) => e.phase === 'before');
  const after = events.filter((e) => e.phase === 'after');
  const accBefore = before.length >= 2 ? acc(before) : null;
  const accAfter = after.length >= 2 ? acc(after) : null;
  const ruleAdaptation =
    accBefore !== null && accAfter !== null && accBefore > 0 ? clamp01(accAfter / accBefore) : null;
  const totalTargets = events.reduce((a, e) => a + e.targetCount, 0);
  const correct = events.reduce((a, e) => a + e.correctTargets, 0);
  const errors = events.reduce((a, e) => a + e.wrongTargets + e.falseClicks, 0);
  const missed = events.reduce((a, e) => a + e.missedTargets, 0);
  const rt = events.filter((e) => e.reactionTime > 0).map((e) => e.reactionTime);
  return {
    game: 'attention',
    sampleCount: n,
    accuracy: n ? round(acc(events)) : null,
    averageResponseTime: round(mean(rt), 1),
    difficultyReached: n ? Math.max(...events.map((e) => e.difficulty)) : 1,
    hintsUsed: 0,
    independenceScore: null,
    helpResponseScore: null,
    details: {
      falseClickRate: correct + errors ? round(errors / (correct + errors)) : null,
      missRate: totalTargets ? round(missed / totalTargets) : null,
      ruleAdaptation: round(ruleAdaptation),
      performanceBeforeRuleChange: round(accBefore),
      performanceAfterRuleChange: round(accAfter),
      ruleChangeTrials: after.length,
    },
  };
}

export function scoreProblemSolving(events: ProblemEvent[]): GameMetrics {
  const n = events.length;
  const correct = events.filter((e) => e.correct);
  const independentCorrect = events.filter((e) => e.correct && e.hintsUsed === 0).length;
  const helpItems = events.filter((e) => e.hintsUsed > 0);
  const helpCorrect = helpItems.filter((e) => e.correct).length;
  const rt = events.filter((e) => e.responseTime > 0).map((e) => e.responseTime);
  return {
    game: 'problem_solving',
    sampleCount: n,
    accuracy: n ? round(correct.length / n) : null, // problemSolvingAccuracy (guided)
    averageResponseTime: round(mean(rt), 1),
    difficultyReached: n ? Math.max(...events.map((e) => e.difficulty)) : 1,
    hintsUsed: events.reduce((a, e) => a + e.hintsUsed, 0),
    independenceScore: n ? round(independentCorrect / n) : null,
    helpResponseScore: helpItems.length ? round(helpCorrect / helpItems.length) : null,
    details: {
      independentCorrect,
      helpItems: helpItems.length,
      helpCorrect,
      correctWithoutHint: independentCorrect,
      correctAfterHint1: events.filter((e) => e.correct && e.hintsUsed === 1).length,
      correctAfterHint2: events.filter((e) => e.correct && e.hintsUsed === 2).length,
      correctAfterExample: events.filter((e) => e.correct && e.hintsUsed >= 3).length,
    },
  };
}
