import type { GameInput, Rng, Theme } from '../types';
import { GAME_SPECS } from './specs';
import { BaseGame } from './base';

export type Stim = 'go' | 'nogo';
export interface ReactionView { index: number; trials: number; stimulus: Stim | null; windowMs: number; gapMs: number; done: boolean }
interface P { trials: number; windowMs: number; gapMs: number; noGoRatio: number }

/** Build the stimulus order: first two are always "go", never more than 3 identical in a row, exact no-go ratio. */
export function makeSequence(trials: number, noGoRatio: number, rng: Rng): Stim[] {
  const nogo = Math.round(trials * noGoRatio);
  for (let attempt = 0; attempt < 200; attempt++) {
    const arr: Stim[] = Array.from({ length: trials }, (_, i) => (i < nogo ? 'nogo' : 'go'));
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    const okStart = arr[0] === 'go' && arr[1] === 'go';
    const okRun = arr.every((v, i) => i < 3 || !(arr[i - 1] === v && arr[i - 2] === v && arr[i - 3] === v));
    if (okStart && okRun) return arr;
  }
  return Array.from({ length: trials }, (_, i) => (i % 4 === 3 ? 'nogo' : 'go')); // deterministic fallback
}

/** Go / No-go told as a story: tap the bunny (go), do NOT tap the sleeping wolf (no-go). View calls show → tap | timeout per stimulus. */
export class ReactionControlGame extends BaseGame<ReactionView> {
  private seq: Stim[] = []; private i = 0; private shownAt: number | null = null;
  constructor(level: number, seed: string, theme: Theme) { super(GAME_SPECS.reaction_control, level, seed, theme); }
  private get p() { return this.difficulty as unknown as P; }
  protected onStart() { this.seq = makeSequence(this.p.trials, this.p.noGoRatio, this.rng); }
  view(): ReactionView { return { index: this.i, trials: this.p.trials, stimulus: this.shownAt === null || this.done ? null : this.seq[this.i], windowMs: this.p.windowMs, gapMs: this.p.gapMs, done: this.done }; }
  handleInput(input: GameInput, now: number): ReactionView {
    if (this.done) return this.view();
    if (input.type === 'show' && this.shownAt === null) { this.shownAt = now; return this.view(); }
    if (this.shownAt === null) return this.view(); // taps in the gap are ignored (not an error)
    if (input.type === 'tap' || input.type === 'timeout') {
      const s = this.seq[this.i]; const tapped = input.type === 'tap';
      if (s === 'go') this.record({ correct: tapped, rtMs: tapped ? Math.max(0, Math.round(now - this.shownAt)) : null, errors: tapped ? 0 : 1, attempts: 1 });
      else this.record({ correct: !tapped, rtMs: null, errors: tapped ? 1 : 0, attempts: 1 });
      this.shownAt = null; this.i++;
      if (this.i >= this.p.trials) this.finishNaturally();
    }
    return this.view();
  }
  /** For bots / tests. */
  currentStimulus(): Stim | null { return this.done ? null : this.seq[this.i]; }
}
