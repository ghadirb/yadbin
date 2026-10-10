import { computeMetrics } from '../scoring';
import { makeRng } from '../rng';
import type { DifficultyParams, GameId, GameInput, GameInstance, GameSpec, Rng, SessionMetrics, SessionRaw, Skill, Theme, Trial } from '../types';

export abstract class BaseGame<V, P extends DifficultyParams = DifficultyParams> implements GameInstance<V> {
  readonly gameId: GameId; readonly skill: Skill; readonly ageRange: readonly [number, number]; readonly sessionDurationSec: number;
  readonly difficulty: P;
  protected trials: Trial[] = [];
  protected rng: Rng;
  protected startedAt = 0;
  protected done = false;
  protected completed = false;
  constructor(readonly spec: GameSpec, readonly level: number, readonly seed: string, protected theme: Theme) {
    this.gameId = spec.id; this.skill = spec.skill; this.ageRange = spec.ageRange; this.sessionDurationSec = spec.sessionDurationSec;
    this.difficulty = spec.paramsFor(level) as P;
    this.rng = makeRng(`${seed}|${spec.id}|${level}`);
  }
  start(nowMs: number): V { this.startedAt = nowMs; this.onStart(nowMs); return this.view(); }
  protected onStart(_nowMs: number): void {}
  abstract handleInput(input: GameInput, nowMs: number): V;
  abstract view(): V;
  isDone() { return this.done; }
  protected record(t: Trial) { this.trials.push(t); }
  protected finishNaturally() { this.done = true; this.completed = true; }
  protected snapshot(nowMs: number): SessionRaw {
    return { gameId: this.gameId, level: this.level, seed: this.seed, trials: this.trials.map((t) => ({ ...t })), completed: this.completed, durationMs: Math.max(0, Math.round(nowMs - this.startedAt)) };
  }
  finish(nowMs: number): SessionRaw { this.done = true; return this.snapshot(nowMs); }
  metrics(): SessionMetrics { return computeMetrics(this.snapshot(this.startedAt), this.spec); }
  score() { return this.metrics().performance; }
}
