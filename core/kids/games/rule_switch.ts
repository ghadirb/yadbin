import type { GameInput, Theme } from '../types';
import { GAME_SPECS } from './specs';
import { BaseGame } from './base';

export type Rule = 'color' | 'shape';
export interface Card { shape: 'circle' | 'square'; color: 'red' | 'blue' }
export interface RuleView { index: number; trials: number; rule: Rule; showCue: boolean; ruleJustChanged: boolean; card: Card | null; done: boolean }
interface P { trials: number; switchEvery: number; cueAlways: boolean }

/** Left bin = red / circle, right bin = blue / square (fixed mapping, shown with icons, never text-only). */
export const correctSide = (card: Card, rule: Rule): 'left' | 'right' => (rule === 'color' ? (card.color === 'red' ? 'left' : 'right') : (card.shape === 'circle' ? 'left' : 'right'));

export class RuleSwitchGame extends BaseGame<RuleView> {
  private i = 0; private rule: Rule = 'color'; private cards: Card[] = []; private rules: Rule[] = []; private shownAt = 0;
  constructor(level: number, seed: string, theme: Theme) { super(GAME_SPECS.rule_switch, level, seed, theme); }
  private get p() { return this.difficulty as unknown as P; }
  protected onStart(now: number) {
    const first: Rule = this.rng() < 0.5 ? 'color' : 'shape';
    this.rules = Array.from({ length: this.p.trials }, (_, i) => { const block = Math.floor(i / this.p.switchEvery); return block % 2 === 0 ? first : first === 'color' ? 'shape' : 'color'; });
    this.cards = Array.from({ length: this.p.trials }, () => ({ shape: this.rng() < 0.5 ? 'circle' : 'square', color: this.rng() < 0.5 ? 'red' : 'blue' }) as Card);
    this.rule = this.rules[0]; this.shownAt = now;
  }
  view(): RuleView {
    const changed = this.i > 0 && this.rules[this.i] !== this.rules[this.i - 1];
    return { index: this.i, trials: this.p.trials, rule: this.rules[Math.min(this.i, this.rules.length - 1)] ?? 'color', showCue: this.p.cueAlways || this.i === 0 || changed, ruleJustChanged: changed, card: this.done ? null : this.cards[this.i] ?? null, done: this.done };
  }
  handleInput(input: GameInput, now: number): RuleView {
    if (this.done || input.type !== 'choose' || (input.side !== 'left' && input.side !== 'right')) return this.view();
    const card = this.cards[this.i], rule = this.rules[this.i];
    const ok = correctSide(card, rule) === input.side;
    const isSwitch = this.i > 0 && this.rules[this.i] !== this.rules[this.i - 1];
    this.record({ correct: ok, rtMs: Math.round(now - this.shownAt), errors: ok ? 0 : 1, attempts: 1, tag: this.i === 0 ? undefined : isSwitch ? 'switch' : 'repeat' });
    this.i++; this.shownAt = now;
    if (this.i >= this.p.trials) this.finishNaturally();
    return this.view();
  }
}
