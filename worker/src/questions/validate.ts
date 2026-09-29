import type { ProblemQuestion } from './bank';

/** A broken/incomplete question must never crash a session: it is skipped and replaced. */
export function isValidProblem(q: unknown): q is ProblemQuestion {
  const x = q as Partial<ProblemQuestion> | null;
  return !!x && typeof x.id === 'string' && typeof x.question === 'string' && x.question.length > 0 &&
    Array.isArray(x.options) && x.options.length >= 2 && x.options.every((o) => typeof o === 'string' && o.length > 0) &&
    Number.isInteger(x.correctOption) && x.correctOption! >= 0 && x.correctOption! < x.options.length &&
    typeof x.hint1 === 'string' && typeof x.hint2 === 'string' && !!x.example && typeof x.example.question === 'string' &&
    (x.difficulty === 1 || x.difficulty === 2 || x.difficulty === 3);
}
