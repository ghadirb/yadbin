import type { DifficultyParams, GameId, GameSpec } from '../types';

const MAX = 10;
const at = <T>(arr: readonly T[], level: number): T => arr[Math.max(1, Math.min(arr.length, Math.round(level))) - 1];
const mk = (s: Omit<GameSpec, 'paramsFor' | 'totalLevels'> & { params: (level: number) => Record<string, number | boolean | string> }): GameSpec => ({
  ...s, totalLevels: MAX,
  paramsFor: (level: number): DifficultyParams => ({ level: Math.max(1, Math.min(MAX, Math.round(level))), ...s.params(level) }),
});

/** Each game: 10 difficulty levels (spec asks ≥5). Rows are indexed by level 1..10; the adaptive engine only changes `level`. */
export const GAME_SPECS: Record<GameId, GameSpec> = {
  memory_match: mk({
    id: 'memory_match', skill: 'memory', secondary: ['learning'], ageRange: [4, 12], sessionDurationSec: 150, errorsPerTrialRef: 1, rtFastMs: 1500, rtSlowMs: 6000,
    params: (l) => ({ pairs: at([3, 3, 4, 4, 5, 6, 6, 7, 8, 8], l), peekMs: at([2800, 2400, 2200, 1800, 1600, 1300, 1100, 900, 700, 500], l), maxAttemptsPerPair: 4 }),
  }),
  visual_attention: mk({
    id: 'visual_attention', skill: 'attention', secondary: ['processing_speed'], ageRange: [4, 12], sessionDurationSec: 150, errorsPerTrialRef: 1.5, rtFastMs: 1200, rtSlowMs: 7000,
    params: (l) => ({ rounds: 8, grid: at([3, 3, 4, 4, 4, 5, 5, 5, 6, 6], l), targets: at([1, 1, 1, 2, 2, 2, 3, 3, 3, 4], l), timeLimitMs: at([14000, 13000, 12000, 12000, 11000, 10500, 10000, 9500, 9000, 8500], l), similar: l >= 6 }),
  }),
  pattern_logic: mk({
    id: 'pattern_logic', skill: 'logic', secondary: ['learning'], ageRange: [4, 12], sessionDurationSec: 180, errorsPerTrialRef: 1, rtFastMs: 2000, rtSlowMs: 12000,
    params: (l) => ({ rounds: 8, kind: at(['ab', 'ab', 'aab', 'abc', 'growth', 'twoattr', 'twoattr', 'abcd', 'mirror', 'mirror'], l), options: at([3, 3, 3, 4, 4, 4, 5, 5, 5, 5], l), length: at([5, 6, 6, 7, 5, 7, 8, 9, 9, 9], l) }),
  }),
  reaction_control: mk({
    id: 'reaction_control', skill: 'response_control', secondary: ['processing_speed'], ageRange: [4, 12], sessionDurationSec: 120, errorsPerTrialRef: 0.5, rtFastMs: 350, rtSlowMs: 1500,
    params: (l) => ({ trials: at([12, 12, 14, 14, 16, 16, 18, 18, 20, 20], l), windowMs: at([1900, 1700, 1600, 1450, 1300, 1200, 1100, 1000, 900, 800], l), gapMs: at([900, 850, 800, 750, 700, 650, 600, 550, 500, 450], l), noGoRatio: at([0.2, 0.2, 0.25, 0.25, 0.3, 0.3, 0.35, 0.35, 0.4, 0.4], l) }),
  }),
  path_puzzle: mk({
    id: 'path_puzzle', skill: 'problem_solving', secondary: ['learning'], ageRange: [4, 12], sessionDurationSec: 210, errorsPerTrialRef: 4, rtFastMs: 2500, rtSlowMs: 20000,
    params: (l) => ({ rounds: 3, size: at([4, 4, 5, 5, 5, 6, 6, 6, 7, 7], l), stars: at([0, 1, 1, 1, 2, 2, 2, 3, 3, 3], l), walls: at([2, 3, 4, 6, 7, 9, 11, 13, 16, 18], l) }),
  }),
  rule_switch: mk({
    id: 'rule_switch', skill: 'cognitive_flexibility', secondary: ['processing_speed', 'learning'], ageRange: [4, 12], sessionDurationSec: 150, errorsPerTrialRef: 0.6, rtFastMs: 500, rtSlowMs: 3500,
    params: (l) => ({ trials: at([12, 14, 14, 16, 18, 18, 20, 22, 24, 24], l), switchEvery: at([6, 6, 5, 5, 4, 4, 3, 3, 3, 2], l), cueAlways: l <= 6 }),
  }),
};
export const gameSpec = (id: GameId) => GAME_SPECS[id];
