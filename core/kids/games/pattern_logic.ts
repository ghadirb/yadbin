import { pick, shuffle } from '../rng';
import type { GameInput, Rng, Theme } from '../types';
import { GAME_SPECS } from './specs';
import { BaseGame } from './base';

export interface PItem { s: string; c?: string; n?: number }
export interface PatternView { round: number; rounds: number; sequence: (PItem | null)[]; options: PItem[]; done: boolean }
interface P { rounds: number; kind: string; options: number; length: number }
export const itemKey = (i: PItem) => `${i.s}|${i.c ?? ''}|${i.n ?? ''}`;
const COLORS = ['c-red', 'c-blue', 'c-green', 'c-yellow'];
const SHAPES = ['●', '■', '▲', '★'];

export interface PatternRound { sequence: PItem[]; answer: PItem; options: PItem[]; answerIndex: number; hidden: number }

/** Generates one pattern. Exactly one option is correct (distractors are forced to differ from the answer). */
export function makePattern(kind: string, length: number, optionCount: number, rng: Rng, symbols: string[]): PatternRound {
  const syms = shuffle(symbols, rng);
  let full: PItem[] = [];
  const cyc = (cycle: PItem[]) => Array.from({ length }, (_, i) => cycle[i % cycle.length]);
  if (kind === 'ab') full = cyc([{ s: syms[0] }, { s: syms[1] }]);
  else if (kind === 'aab') full = cyc([{ s: syms[0] }, { s: syms[0] }, { s: syms[1] }]);
  else if (kind === 'abc') full = cyc([{ s: syms[0] }, { s: syms[1] }, { s: syms[2] }]);
  else if (kind === 'abcd') full = cyc([{ s: syms[0] }, { s: syms[1] }, { s: syms[2] }, { s: syms[3] }]);
  else if (kind === 'growth') { const step = pick([1, 1, 2], rng); full = Array.from({ length }, (_, i) => ({ s: syms[0], n: 1 + i * step })); }
  else if (kind === 'twoattr') { const sh = shuffle(SHAPES, rng), co = shuffle(COLORS, rng); full = cyc([{ s: sh[0], c: co[0] }, { s: sh[1], c: co[1] }, { s: sh[0], c: co[2] }]); }
  else { // mirror: a b c b a …  (answer is the symmetric partner)
    const half = [{ s: syms[0] }, { s: syms[1] }, { s: syms[2] }, { s: syms[3] }, { s: syms[4] }];
    const k = Math.max(3, Math.min(5, Math.floor(length / 2)));
    const left = half.slice(0, k); full = [...left, ...left.slice(0, -1).reverse()].slice(0, length);
    while (full.length < length) full.push(full[full.length - 1]);
  }
  const hidden = full.length - 1; const answer = full[hidden];
  // distractors: other items from the same family so the choice is meaningful, always different from the answer
  const family: PItem[] = kind === 'growth' ? Array.from({ length: 12 }, (_, i) => ({ s: syms[0], n: i + 1 }))
    : kind === 'twoattr' ? SHAPES.flatMap((s) => COLORS.map((c) => ({ s, c }))) : syms.map((s) => ({ s }));
  const wrong = shuffle(family.filter((f) => itemKey(f) !== itemKey(answer)), rng).slice(0, optionCount - 1);
  const options = shuffle([answer, ...wrong], rng);
  return { sequence: full, answer, options, answerIndex: options.findIndex((o) => itemKey(o) === itemKey(answer)), hidden };
}

export class PatternLogicGame extends BaseGame<PatternView> {
  private idx = 0; private cur!: PatternRound; private shownAt = 0;
  constructor(level: number, seed: string, theme: Theme) { super(GAME_SPECS.pattern_logic, level, seed, theme); }
  private get p() { return this.difficulty as unknown as P; }
  protected onStart(now: number) { this.next(now); }
  private next(now: number) { this.cur = makePattern(this.p.kind, this.p.length, this.p.options, this.rng, this.theme.emojis); this.shownAt = now; }
  view(): PatternView { return { round: this.idx, rounds: this.p.rounds, sequence: this.cur ? this.cur.sequence.map((x, i) => (i === this.cur.hidden ? null : x)) : [], options: this.cur?.options ?? [], done: this.done }; }
  handleInput(input: GameInput, now: number): PatternView {
    if (this.done || input.type !== 'choose') return this.view();
    const i = Number(input.index); if (!Number.isInteger(i) || i < 0 || i >= this.cur.options.length) return this.view();
    const ok = i === this.cur.answerIndex;
    this.record({ correct: ok, rtMs: Math.round(now - this.shownAt), errors: ok ? 0 : 1, attempts: 1 });
    this.idx++;
    if (this.idx >= this.p.rounds) this.finishNaturally(); else this.next(now);
    return this.view();
  }
  /** Used by bots / tests only. */
  correctIndex() { return this.cur.answerIndex; }
}
