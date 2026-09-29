import { describe, expect, it } from 'vitest';
import { aggregateGame, nextDifficulty, performanceStatus, recommend, scoreAttention, scoreMemory, scoreProblemSolving, trendFromSeries } from '../src/scoring';
import { attentionQuestions, buildPools, memoryQuestions, problemQuestions } from '../src/questions/generate';
import { PROBLEM_BANK } from '../src/questions/bank';
import { isValidProblem } from '../src/questions/validate';

const mem = (correct: boolean, o: any = {}) => ({ sequenceLength: 4, displayDuration: 1500, difficulty: 1, isReverse: false, correct, attempts: 1, responseTime: 2000, mistakes: correct ? 0 : 1, ...o });

describe('Memory scoring', () => {
  it('computes accuracy, avg RT, highest length, reverse accuracy', () => {
    const m = scoreMemory([mem(true, { sequenceLength: 5 }), mem(true, { sequenceLength: 7, isReverse: true, difficulty: 3, responseTime: 4000 }), mem(false, { isReverse: true, difficulty: 3 })]);
    expect(m.accuracy).toBeCloseTo(0.6667, 3);
    expect(m.averageResponseTime).toBeCloseTo(2666.7, 1);
    expect(m.details.highestSuccessfulLength).toBe(7);
    expect(m.details.reverseTaskAccuracy).toBe(0.5);
    expect(m.difficultyReached).toBe(3);
  });
  it('handles no events without NaN', () => {
    const m = scoreMemory([]);
    expect(m.accuracy).toBeNull(); expect(m.sampleCount).toBe(0);
  });
});

describe('Attention scoring', () => {
  const t = (o: any = {}) => ({ gridSize: 4, targetType: 'blue', targetCount: 3, correctTargets: 3, wrongTargets: 0, missedTargets: 0, falseClicks: 0, reactionTime: 900, totalTime: 3000, difficulty: 3, ruleChanged: false, phase: 'before', ...o });
  it('computes rates and rule adaptation', () => {
    const ev = [t(), t(), t({ phase: 'after', ruleChanged: true, correctTargets: 1, wrongTargets: 2, missedTargets: 2 }), t({ phase: 'after', ruleChanged: true, correctTargets: 1, wrongTargets: 2, missedTargets: 2 })] as any;
    const m = scoreAttention(ev);
    expect(m.details.performanceBeforeRuleChange).toBe(1);
    expect(m.details.performanceAfterRuleChange).toBeCloseTo(2 / 10, 3);
    expect(m.details.ruleAdaptation).toBeCloseTo(0.2, 3);
    expect(m.details.missRate).toBeCloseTo(4 / 12, 3);
  });
  it('no rule adaptation without enough trials on both sides', () => {
    expect(scoreAttention([t(), t({ phase: 'after' })] as any).details.ruleAdaptation).toBeNull();
  });
});

describe('Problem-solving scoring', () => {
  const p = (correct: boolean, hintsUsed = 0) => ({ questionId: 'x', difficulty: 2, attempts: 1, hintsUsed, responseTime: 3000, finalAnswer: 1, correct });
  it('separates independent accuracy from guided/help response', () => {
    const m = scoreProblemSolving([p(true, 0), p(true, 0), p(true, 1), p(true, 2), p(false, 3), p(false, 0)]);
    expect(m.accuracy).toBeCloseTo(4 / 6, 3);          // guided: all correct answers
    expect(m.independenceScore).toBeCloseTo(2 / 6, 3); // independent only
    expect(m.helpResponseScore).toBeCloseTo(2 / 3, 3); // 3 items used help, 2 solved
    expect(m.details.correctAfterHint1).toBe(1);
    expect(m.details.correctAfterHint2).toBe(1);
  });
  it('two students with equal correct answers differ in independence', () => {
    const a = scoreProblemSolving([p(true), p(true)]);
    const b = scoreProblemSolving([p(true, 1), p(true, 2)]);
    expect(a.accuracy).toBe(b.accuracy);
    expect(a.independenceScore).toBe(1); expect(b.independenceScore).toBe(0);
  });
});

describe('Status / trend / adaptive', () => {
  it('insufficient data => no conclusion', () => {
    expect(performanceStatus(0.95, 7)).toBe('insufficient');
    expect(performanceStatus(null, 100)).toBe('insufficient');
  });
  it('status thresholds', () => {
    expect(performanceStatus(0.8, 10)).toBe('good');
    expect(performanceStatus(0.79, 10)).toBe('average');
    expect(performanceStatus(0.5, 10)).toBe('average');
    expect(performanceStatus(0.49, 10)).toBe('needs_practice');
  });
  it('trend needs >= 2 sessions; 3+ is moderate confidence', () => {
    expect(trendFromSeries([0.6]).direction).toBe('insufficient');
    expect(trendFromSeries([0.6, 0.7])).toMatchObject({ direction: 'up', confidence: 'preliminary' });
    expect(trendFromSeries([0.62, 0.65, 0.67, 0.72])).toMatchObject({ direction: 'up', confidence: 'moderate' });
    expect(trendFromSeries([0.7, 0.71, 0.7])).toMatchObject({ direction: 'stable' });
    expect(trendFromSeries([0.8, 0.7, 0.6])).toMatchObject({ direction: 'down' });
  });
  it('adaptive: >=80% up, 50-79% same, <50% down, clamped 1..3', () => {
    expect(nextDifficulty(1, 1)).toBe(2); expect(nextDifficulty(3, 1)).toBe(3);
    expect(nextDifficulty(2, 0.67)).toBe(2); expect(nextDifficulty(2, 0.33)).toBe(1); expect(nextDifficulty(1, 0)).toBe(1);
  });
  it('one mistake in a block of 3 does not lower the level', () => {
    expect(nextDifficulty(2, 2 / 3)).toBe(2);
  });
});

describe('Recommendation engine', () => {
  const ev = (f: (i: number) => any, n = 10) => Array.from({ length: n }, (_, i) => f(i));
  it('rule-change weakness -> attention with rule change', () => {
    const t = (o: any) => ({ gridSize: 4, targetType: 'blue', targetCount: 3, correctTargets: 3, wrongTargets: 0, missedTargets: 0, falseClicks: 0, reactionTime: 900, totalTime: 3000, difficulty: 3, ruleChanged: false, phase: 'before', ...o });
    const metrics = scoreAttention([...ev(() => t({}), 5), ...ev(() => t({ phase: 'after', correctTargets: 1, wrongTargets: 2, missedTargets: 2 }), 5)] as any);
    const agg = aggregateGame('attention', [{ createdAt: '2026-01-01', metrics }]);
    const s = recommend({ attention: agg });
    expect(s[0]).toMatchObject({ rule: 'attention_rule_change', gameType: 'attention' });
    expect(s[0].text).not.toMatch(/ADHD|اختلال|مشکل توجه/);
  });
  it('low independent accuracy -> medium problems', () => {
    const metrics = scoreProblemSolving(ev((i) => ({ questionId: 'x', difficulty: 2, attempts: 1, hintsUsed: 1, responseTime: 3000, finalAnswer: 1, correct: i < 4 })) as any);
    const agg = aggregateGame('problem_solving', [{ createdAt: '2026-01-01', metrics }]);
    expect(recommend({ problem_solving: agg })[0]).toMatchObject({ rule: 'problem_independent', difficultyMode: 'medium' });
  });
  it('help responsive -> slightly harder', () => {
    const metrics = scoreProblemSolving(ev((i) => ({ questionId: 'x', difficulty: 2, attempts: 1, hintsUsed: i < 3 ? 1 : 0, responseTime: 3000, finalAnswer: 1, correct: true })) as any);
    const agg = aggregateGame('problem_solving', [{ createdAt: '2026-01-01', metrics }]);
    // independent accuracy 0.7 (>=0.6) and all help items solved
    expect(recommend({ problem_solving: agg })[0]).toMatchObject({ rule: 'problem_help_responsive', difficultyMode: 'hard' });
  });
  it('no suggestions from insufficient data', () => {
    const agg = aggregateGame('memory', [{ createdAt: '2026-01-01', metrics: scoreMemory([mem(true), mem(true)]) }]);
    expect(recommend({ memory: agg })).toEqual([]);
  });
});

describe('Question generation & bank', () => {
  it('bank is fully valid, hints do not reveal the answer', () => {
    for (const q of PROBLEM_BANK) {
      expect(isValidProblem(q), q.id).toBe(true);
      const answer = q.options[q.correctOption];
      expect(q.hint1.includes(`جواب ${answer}`)).toBe(false);
    }
    expect(new Set(PROBLEM_BANK.map((q) => q.id)).size).toBe(PROBLEM_BANK.length);
  });
  it('invalid question is rejected (skipped, never crashes)', () => {
    expect(isValidProblem({ id: 'a' })).toBe(false);
    expect(isValidProblem({ ...PROBLEM_BANK[0], correctOption: 9 })).toBe(false);
    expect(isValidProblem(null)).toBe(false);
  });
  it('same seed => same set; different seed => different; no repeated memory sequences in a session', () => {
    expect(memoryQuestions('s1', 2, 10)).toEqual(memoryQuestions('s1', 2, 10));
    expect(memoryQuestions('s1', 2, 10)).not.toEqual(memoryQuestions('s2', 2, 10));
    const seqs = memoryQuestions('s3', 3, 10).map((q) => q.sequence.join(','));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
  it('memory level rules: lengths and Reverse only at level 3', () => {
    for (const q of memoryQuestions('a', 1, 12)) { expect(q.sequence.length).toBeGreaterThanOrEqual(3); expect(q.sequence.length).toBeLessThanOrEqual(5); expect(q.isReverse).toBe(false); expect(q.displayDuration).toBe(1500); }
    for (const q of memoryQuestions('a', 2, 12)) { expect(q.sequence.length).toBeGreaterThanOrEqual(5); expect(q.sequence.length).toBeLessThanOrEqual(6); expect(q.displayDuration).toBe(1200); }
    const l3 = memoryQuestions('a', 3, 12);
    l3.forEach((q) => { expect(q.sequence.length).toBeGreaterThanOrEqual(6); expect(q.sequence.length).toBeLessThanOrEqual(8); });
    expect(l3.some((q) => q.isReverse)).toBe(true);
  });
  it('attention grids: 3x3, 4x4, and hard has a rule change', () => {
    expect(attentionQuestions('a', 1, 4)[0].cells).toHaveLength(9);
    expect(attentionQuestions('a', 2, 4)[0].cells).toHaveLength(16);
    const hard = attentionQuestions('a', 3, 10);
    expect(hard[0].rule).toEqual({ select: 'blue', avoid: 'red' });
    expect(hard[9].rule).toEqual({ select: 'red', avoid: 'blue' });
    expect(hard.some((q) => q.phase === 'before') && hard.some((q) => q.phase === 'after')).toBe(true);
  });
  it('problem questions: shuffled options keep the correct index consistent', () => {
    const qs = problemQuestions('seed', 2, 7, false);
    for (const q of qs) {
      const orig = PROBLEM_BANK.find((b) => b.id === q.id)!;
      expect(q.options[q.correctOption]).toBe(orig.options[orig.correctOption]);
    }
  });
  it('adaptive pools cover all three levels', () => {
    expect(Object.keys(buildPools('problem_solving', 's', [1, 2, 3], 10))).toEqual(['1', '2', '3']);
  });
});
