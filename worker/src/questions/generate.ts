import { makeRng, randInt, shuffle } from '../utils/rng';
import type { GameType } from '../scoring/types';
import { PROBLEM_BANK } from './bank';
import { isValidProblem } from './validate';

export type DifficultyMode = 'adaptive' | 'easy' | 'medium' | 'hard';
export const MODE_TO_LEVEL: Record<Exclude<DifficultyMode, 'adaptive'>, 1 | 2 | 3> = { easy: 1, medium: 2, hard: 3 };

const SYMBOLS = ['red', 'blue', 'green', 'yellow', 'star', 'moon', 'heart', 'sun', 'triangle'];

export function memoryQuestions(seed: string, difficulty: 1 | 2 | 3, count: number) {
  const rng = makeRng(`${seed}:mem:${difficulty}`);
  const seen = new Set<string>();
  const out = [];
  const range = difficulty === 1 ? [3, 5] : difficulty === 2 ? [5, 6] : [6, 8];
  const duration = difficulty === 1 ? 1500 : difficulty === 2 ? 1200 : 1000;
  for (let i = 0; i < count; i++) {
    let seq: string[] = [];
    for (let tries = 0; tries < 30; tries++) {
      const len = randInt(rng, range[0], range[1]);
      seq = shuffle(SYMBOLS, rng).slice(0, len);
      if (!seen.has(seq.join(','))) break;
    }
    seen.add(seq.join(','));
    out.push({
      id: `mem_${difficulty}_${i + 1}`, game: 'memory' as const, type: 'sequence', difficulty,
      sequence: seq, displayDuration: duration,
      isReverse: difficulty === 3 && rng() < 0.5, // Reverse Task only at Level 3
      version: 1,
    });
  }
  return out;
}

const COLORS = ['red', 'blue', 'green', 'yellow'];
export function attentionQuestions(seed: string, difficulty: 1 | 2 | 3, count: number) {
  const rng = makeRng(`${seed}:att:${difficulty}`);
  const grid = difficulty === 1 ? 3 : 4;
  const cellsN = grid * grid;
  const changeAt = difficulty === 3 ? Math.max(2, Math.floor(count / 2)) : -1;
  const out = [];
  for (let i = 0; i < count; i++) {
    const changed = changeAt >= 0 && i >= changeAt;
    // Hard: «آبی را انتخاب کن، قرمز را انتخاب نکن» → after the change: «قرمز را انتخاب کن، آبی را انتخاب نکن».
    const select = difficulty === 3 ? (changed ? 'red' : 'blue') : COLORS[randInt(rng, 0, 3)];
    const avoid = difficulty === 3 ? (changed ? 'blue' : 'red') : null;
    const targetCount = randInt(rng, 2, difficulty === 1 ? 3 : 4);
    const avoidCount = avoid ? randInt(rng, 2, 3) : 0;
    const others = COLORS.filter((c) => c !== select && c !== avoid);
    const cells: string[] = [
      ...Array(targetCount).fill(select),
      ...Array(avoidCount).fill(avoid),
    ];
    while (cells.length < cellsN) cells.push(others[randInt(rng, 0, others.length - 1)]);
    out.push({
      id: `att_${difficulty}_${i + 1}`, game: 'attention' as const, type: 'grid', difficulty,
      gridSize: grid, cells: shuffle(cells, rng), rule: { select, avoid }, targetCount,
      ruleChanged: changed, phase: difficulty === 3 ? (changed ? 'after' : 'before') : 'none',
      timeLimit: difficulty === 1 ? 8000 : 6000, version: 1,
    });
  }
  return out;
}

export function problemQuestions(seed: string, difficulty: 1 | 2 | 3, count: number, borrow: boolean) {
  const rng = makeRng(`${seed}:prob:${difficulty}`);
  const valid = PROBLEM_BANK.filter(isValidProblem);
  const near = [1, 2, 3].filter((d) => d !== difficulty).sort((a, b) => Math.abs(a - difficulty) - Math.abs(b - difficulty));
  const order = borrow ? [difficulty, ...near] : [difficulty];
  const picked: typeof PROBLEM_BANK = [];
  for (const d of order) {
    for (const q of shuffle(valid.filter((x) => x.difficulty === d), rng)) {
      if (picked.length >= count) break;
      picked.push(q);
    }
  }
  // Shuffle options per question but keep the index of the correct option consistent.
  return picked.map((q) => {
    const idx = shuffle(q.options.map((_, i) => i), rng);
    return { ...q, options: idx.map((i) => q.options[i]), correctOption: idx.indexOf(q.correctOption) };
  });
}

/**
 * Question pools per difficulty level for the client game engine.
 * Adaptive sends one pool per level (client falls back to the nearest level if a pool runs out).
 * Fixed levels send a single pool, borrowing nearby-level problems if the level has too few.
 */
export function buildPools(game: GameType, seed: string, levels: (1 | 2 | 3)[], count: number) {
  const pools: Record<string, unknown[]> = {};
  const borrow = levels.length === 1;
  for (const l of levels) {
    if (game === 'memory') pools[l] = memoryQuestions(seed, l, count);
    else if (game === 'attention') pools[l] = attentionQuestions(seed, l, count);
    else pools[l] = problemQuestions(seed, l, count, borrow);
  }
  return pools;
}
