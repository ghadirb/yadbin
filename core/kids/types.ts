/**
 * Yadbin Kids — shared, deterministic core types.
 * Pure TypeScript: no DOM, no Workers APIs, no clock, no randomness except a seeded RNG passed in.
 * The same module runs on the device (offline play) and on the Worker (source of truth), so they can never drift.
 */
export const SKILLS = ['memory', 'attention', 'processing_speed', 'problem_solving', 'logic', 'response_control', 'cognitive_flexibility', 'learning'] as const;
export type Skill = (typeof SKILLS)[number];

export const GAME_IDS = ['memory_match', 'visual_attention', 'pattern_logic', 'reaction_control', 'path_puzzle', 'rule_switch'] as const;
export type GameId = (typeof GAME_IDS)[number];
export const isGameId = (x: unknown): x is GameId => typeof x === 'string' && (GAME_IDS as readonly string[]).includes(x);
export const isSkill = (x: unknown): x is Skill => typeof x === 'string' && (SKILLS as readonly string[]).includes(x);

/** One observed attempt inside a game (a card pair, a grid, a stimulus, a puzzle, a card to sort …). */
export interface Trial {
  correct: boolean;
  /** Reaction / choice time in ms (null when not meaningful, e.g. a withheld response). */
  rtMs: number | null;
  /** Mistakes made during this trial (wrong taps, bumps, detours …). */
  errors: number;
  attempts: number;
  /** Optional analytic tag (rule switching: 'switch' | 'repeat'). */
  tag?: 'switch' | 'repeat';
}

/** What a finished game hands to scoring. It never contains a score: scoring is recomputed from this. */
export interface SessionRaw {
  gameId: GameId;
  level: number;
  seed: string;
  trials: Trial[];
  /** True when the child reached the natural end of the game (all pairs found, all rounds done …). */
  completed: boolean;
  durationMs: number;
}

export interface SessionMetrics {
  trials: number;
  accuracy: number;            // 0..1
  medianRtMs: number | null;
  errors: number;
  attempts: number;
  completion: number;          // 0..1
  bestStreak: number;
  /** second-half accuracy minus first-half accuracy (null if too few trials). */
  learningDelta: number | null;
  /** accuracy on trials right after an error minus overall accuracy (null if no errors). */
  recoveryDelta: number | null;
  /** (mean rt on first trial after a rule switch) − (mean rt on repeat trials). */
  switchCostMs: number | null;
  /** 0..1 multi-dimensional performance used by the adaptive engine. Never shown to the child. */
  performance: number;
}

export interface SkillSignal { skill: Skill; /** 0..100 */ value: number; weight: number }

/** Difficulty parameters are plain JSON so the adaptive engine can treat every game the same way (spec §37). */
export type DifficultyParams = { level: number } & Record<string, number | boolean | string>;

export interface Theme { id: string; name: string; emojis: string[]; bg: string }

export interface GameInput { type: string; [k: string]: unknown }

/**
 * Standard game contract (spec §36). Time is passed in (`nowMs`), never read, so every game is a pure,
 * replayable state machine that a bot can drive in a unit test.
 */
export interface GameInstance<V = unknown> {
  readonly gameId: GameId;
  readonly skill: Skill;
  readonly ageRange: readonly [number, number];
  readonly difficulty: DifficultyParams;
  readonly sessionDurationSec: number;
  start(nowMs: number): V;
  handleInput(input: GameInput, nowMs: number): V;
  view(): V;
  isDone(): boolean;
  finish(nowMs: number): SessionRaw;
  score(): number;
  metrics(): SessionMetrics;
}

/** Static description of a game (what the Journey / adaptive engine need — nothing about its internals). */
export interface GameSpec {
  id: GameId;
  skill: Skill;
  /** Skills that additionally receive a (lighter) signal from this game. */
  secondary: Skill[];
  ageRange: readonly [number, number];
  sessionDurationSec: number;
  totalLevels: number;
  /** Errors per trial that already count as "very messy" (scales the cleanliness term). */
  errorsPerTrialRef: number;
  /** Reference choice/reaction times for the processing-speed signal. */
  rtFastMs: number;
  rtSlowMs: number;
  paramsFor(level: number): DifficultyParams;
}

export type Rng = () => number;
