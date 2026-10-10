import { shuffle } from '../rng';
import type { GameInput, Theme } from '../types';
import { GAME_SPECS } from './specs';
import { BaseGame } from './base';

export interface AttentionView { round: number; rounds: number; grid: number; cells: string[]; target: string; found: number[]; wrong: number[]; targets: number; timeLimitMs: number; done: boolean }
interface P { rounds: number; grid: number; targets: number; timeLimitMs: number; similar: boolean }

/** "Find the friend": tap every copy of the target among distractors. */
export class VisualAttentionGame extends BaseGame<AttentionView> {
  private idx = 0; private cells: string[] = []; private target = ''; private targetCells = new Set<number>();
  private found = new Set<number>(); private wrong = new Set<number>(); private falseTaps = 0; private roundStart = 0; private firstFound: number | null = null;
  constructor(level: number, seed: string, theme: Theme) { super(GAME_SPECS.visual_attention, level, seed, theme); }
  private get p() { return this.difficulty as unknown as P; }
  protected onStart(now: number) { this.newRound(now); }
  private newRound(now: number) {
    const n = this.p.grid * this.p.grid; const pool = shuffle(this.theme.emojis, this.rng);
    this.target = pool[0];
    // "similar" distractors reuse only 2 other symbols (harder to filter); otherwise 4 different ones.
    const distract = pool.slice(1, this.p.similar ? 3 : 6);
    const cells = Array.from({ length: n }, (_, i) => distract[i % distract.length]);
    const spots = shuffle(Array.from({ length: n }, (_, i) => i), this.rng).slice(0, this.p.targets);
    spots.forEach((s) => (cells[s] = this.target));
    this.cells = shuffle(cells, this.rng).slice(); this.targetCells = new Set(this.cells.map((c, i) => (c === this.target ? i : -1)).filter((i) => i >= 0));
    this.found.clear(); this.wrong.clear(); this.falseTaps = 0; this.roundStart = now; this.firstFound = null;
  }
  view(): AttentionView { return { round: this.idx, rounds: this.p.rounds, grid: this.p.grid, cells: [...this.cells], target: this.target, found: [...this.found], wrong: [...this.wrong], targets: this.targetCells.size, timeLimitMs: this.p.timeLimitMs, done: this.done }; }
  private endRound(now: number, timedOut: boolean) {
    const missed = this.targetCells.size - this.found.size;
    this.record({ correct: missed === 0 && this.falseTaps === 0, rtMs: this.firstFound === null ? null : Math.round(this.firstFound - this.roundStart), errors: this.falseTaps + missed, attempts: this.found.size + this.falseTaps });
    void timedOut;
    this.idx++;
    if (this.idx >= this.p.rounds) this.finishNaturally(); else this.newRound(now);
  }
  handleInput(input: GameInput, now: number): AttentionView {
    if (this.done) return this.view();
    if (input.type === 'tap') {
      const i = Number(input.index);
      if (!Number.isInteger(i) || i < 0 || i >= this.cells.length || this.found.has(i) || this.wrong.has(i)) return this.view();
      if (this.targetCells.has(i)) { this.found.add(i); this.firstFound ??= now; if (this.found.size === this.targetCells.size) this.endRound(now, false); }
      else { this.wrong.add(i); this.falseTaps++; }
    } else if (input.type === 'timeout') this.endRound(now, true);
    return this.view();
  }
}
