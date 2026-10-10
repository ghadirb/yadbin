import { shuffle } from '../rng';
import type { GameInput, Theme, DifficultyParams } from '../types';
import { GAME_SPECS } from './specs';
import { BaseGame } from './base';

export interface Card { id: number; symbol: string; faceUp: boolean; matched: boolean }
export interface MemoryView { phase: 'peek' | 'play' | 'done'; cards: Card[]; peekMs: number; locked: boolean; matchedPairs: number; pairs: number }

/** Cards are shown briefly (peek), then the child finds the pairs. Each pair attempt is one trial. */
export class MemoryMatchGame extends BaseGame<MemoryView> {
  private cards: Card[] = [];
  private phase: MemoryView['phase'] = 'peek';
  private first: number | null = null;
  private pending: [number, number] | null = null;
  private lastAt = 0;
  private attempts = 0;
  constructor(level: number, seed: string, theme: Theme) { super(GAME_SPECS.memory_match, level, seed, theme); }
  private get p() { return this.difficulty as DifficultyParams & { pairs: number; peekMs: number; maxAttemptsPerPair: number }; }
  protected onStart(now: number) {
    const symbols = shuffle(this.theme.emojis, this.rng).slice(0, this.p.pairs);
    this.cards = shuffle([...symbols, ...symbols], this.rng).map((symbol, id) => ({ id, symbol, faceUp: true, matched: false }));
    this.lastAt = now; this.phase = 'peek';
  }
  view(): MemoryView { return { phase: this.done ? 'done' : this.phase, cards: this.cards.map((c) => ({ ...c })), peekMs: this.p.peekMs, locked: !!this.pending, matchedPairs: this.cards.filter((c) => c.matched).length / 2, pairs: this.p.pairs }; }
  handleInput(input: GameInput, now: number): MemoryView {
    if (this.done) return this.view();
    if (input.type === 'peekEnd' && this.phase === 'peek') { this.cards.forEach((c) => (c.faceUp = false)); this.phase = 'play'; this.lastAt = now; }
    else if (input.type === 'flip' && this.phase === 'play' && !this.pending) {
      const c = this.cards[Number(input.index)];
      if (!c || c.matched || c.faceUp) return this.view();
      c.faceUp = true;
      if (this.first === null) { this.first = c.id; }
      else {
        const a = this.cards[this.first]; const ok = a.symbol === c.symbol;
        this.attempts++;
        this.record({ correct: ok, rtMs: Math.max(0, Math.round(now - this.lastAt)), errors: ok ? 0 : 1, attempts: 1 });
        this.first = null;
        if (ok) { a.matched = c.matched = true; this.lastAt = now; } else this.pending = [a.id, c.id];
        if (this.cards.every((x) => x.matched)) this.finishNaturally();
        else if (this.attempts >= this.p.pairs * this.p.maxAttemptsPerPair) { this.done = true; } // gentle stop, never a punishment
      }
    } else if (input.type === 'resolve' && this.pending) { this.pending.forEach((i) => (this.cards[i].faceUp = false)); this.pending = null; this.lastAt = now; }
    return this.view();
  }
}
