import type { GameType, Question } from './types';

const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

/** A broken/incomplete question is skipped and replaced; it must never crash the game. */
export function isValidQuestion(game: GameType, q: any): q is Question {
  if (!q || typeof q !== 'object' || !isStr(q.id) || ![1, 2, 3].includes(q.difficulty)) return false;
  if (game === 'memory')
    return Array.isArray(q.sequence) && q.sequence.length >= 2 && q.sequence.every(isStr) && Number.isFinite(q.displayDuration) && q.displayDuration > 0;
  if (game === 'attention')
    return Number.isInteger(q.gridSize) && Array.isArray(q.cells) && q.cells.length === q.gridSize ** 2 && q.cells.every(isStr) &&
      !!q.rule && isStr(q.rule.select) && Number.isInteger(q.targetCount) && q.targetCount > 0 &&
      q.cells.filter((c: string) => c === q.rule.select).length === q.targetCount;
  if (game === 'problem_solving')
    return isStr(q.question) && Array.isArray(q.options) && q.options.length >= 2 && q.options.every(isStr) &&
      Number.isInteger(q.correctOption) && q.correctOption >= 0 && q.correctOption < q.options.length &&
      isStr(q.hint1) && isStr(q.hint2) && !!q.example && isStr(q.example.question);
  return false;
}
