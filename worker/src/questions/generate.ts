import { makeRng, randInt, shuffle } from '../utils/rng';
import type { GameType } from '../scoring/types';
import { PROBLEM_BANK } from './bank';
import { isValidProblem } from './validate';

export type DifficultyMode = 'adaptive' | 'easy' | 'medium' | 'hard';
export const MODE_TO_LEVEL: Record<Exclude<DifficultyMode, 'adaptive'>, 1 | 2 | 3> = { easy: 1, medium: 2, hard: 3 };

const SYMBOLS = ['red', 'blue', 'green', 'yellow', 'star', 'moon', 'heart', 'sun', 'triangle'];

export type Tuning = -1 | 0 | 1; // -1 = younger / introductory, 0 = v1.1 defaults (unchanged), +1 = older / advanced

export function memoryQuestions(seed: string, difficulty: 1 | 2 | 3, count: number, tuning: Tuning = 0) {
  const rng = makeRng(`${seed}:mem:${difficulty}`);
  const seen = new Set<string>();
  const out = [];
  // Fewer items + longer display for younger children; more items + shorter display for older ones (max 8: only 9 symbols exist).
  const RANGES = { '-1': [[3, 4], [4, 5], [5, 6]], '0': [[3, 5], [5, 6], [6, 8]], '1': [[4, 6], [6, 7], [7, 8]] } as const;
  const DURATIONS = { '-1': [1950, 1560, 1300], '0': [1500, 1200, 1000], '1': [1275, 1020, 850] } as const;
  const range: readonly number[] = RANGES[String(tuning) as '0'][difficulty - 1];
  const duration = DURATIONS[String(tuning) as '0'][difficulty - 1];
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
export function attentionQuestions(seed: string, difficulty: 1 | 2 | 3, count: number, tuning: Tuning = 0) {
  const rng = makeRng(`${seed}:att:${difficulty}`);
  // Younger: small grid, few targets, more time. Older: bigger grid, more targets, less time.
  const grid = tuning === 0 ? (difficulty === 1 ? 3 : 4) : tuning === -1 ? 3 : difficulty === 1 ? 4 : 5;
  const maxTargets = tuning === 0 ? (difficulty === 1 ? 3 : 4) : tuning === -1 ? 3 : difficulty === 1 ? 4 : 5;
  const timeLimit = tuning === 0 ? (difficulty === 1 ? 8000 : 6000) : tuning === -1 ? (difficulty === 1 ? 12000 : 9000) : (difficulty === 1 ? 6000 : 4500);
  const cellsN = grid * grid;
  const changeAt = difficulty === 3 ? Math.max(2, Math.floor(count / 2)) : -1;
  const out = [];
  for (let i = 0; i < count; i++) {
    const changed = changeAt >= 0 && i >= changeAt;
    // Hard: «آبی را انتخاب کن، قرمز را انتخاب نکن» → after the change: «قرمز را انتخاب کن، آبی را انتخاب نکن».
    const select = difficulty === 3 ? (changed ? 'red' : 'blue') : COLORS[randInt(rng, 0, 3)];
    const avoid = difficulty === 3 ? (changed ? 'blue' : 'red') : null;
    const targetCount = randInt(rng, 2, maxTargets);
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
      timeLimit, version: 1,
    });
  }
  return out;
}

export function problemQuestions(seed: string, difficulty: 1 | 2 | 3, count: number, borrow: boolean, tuning: Tuning = 0) {
  const rng = makeRng(`${seed}:prob:${difficulty}`);
  const valid = PROBLEM_BANK.filter(isValidProblem);
  const near = [1, 2, 3].filter((d) => d !== difficulty).sort((a, b) => Math.abs(a - difficulty) - Math.abs(b - difficulty));
  const order = borrow ? [difficulty, ...near] : [difficulty];
  const picked: typeof PROBLEM_BANK = [];
  for (const d of order) {
    const level = shuffle(valid.filter((x) => x.difficulty === d), rng);
    // Younger: short, simple rules first. Older: multi-step / pattern problems first. (tuning 0 keeps the shuffled order untouched.)
    if (tuning !== 0) {
      const pref = (q: { type: string }) => (tuning === -1 ? (q.type === 'multi_step' ? 2 : q.type === 'simple_problem' || q.type === 'visual_logic' ? 0 : 1) : q.type === 'multi_step' ? 0 : q.type === 'pattern' ? 1 : 2);
      level.sort((a, b) => pref(a) - pref(b));
    }
    for (const q of level) {
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
export function buildPools(game: GameType, seed: string, levels: (1 | 2 | 3)[], count: number, tuning: Tuning = 0) {
  const pools: Record<string, unknown[]> = {};
  const borrow = levels.length === 1;
  for (const l of levels) {
    if (game === 'memory') pools[l] = memoryQuestions(seed, l, count, tuning);
    else if (game === 'attention') pools[l] = attentionQuestions(seed, l, count, tuning);
    else pools[l] = problemQuestions(seed, l, count, borrow, tuning);
  }
  return pools;
}
