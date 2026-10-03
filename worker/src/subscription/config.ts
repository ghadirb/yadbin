import type { Env } from '../env';

/**
 * Business limits live here (defaults) and can be overridden per deployment with Worker vars — no code change needed.
 * `null` means "unlimited". Nothing in the UI hard-codes these numbers: the app reads them from GET /api/subscription.
 */
export interface FreeLimits { maxClasses: number | null; maxStudents: number | null; maxAssessments: number | null; aiRequestsPerMonth: number | null }

const DEFAULTS = { TRIAL_DAYS: 7, FREE_MAX_CLASSES: 1, FREE_MAX_STUDENTS: 10, FREE_MAX_ASSESSMENTS: 3, FREE_AI_REQUESTS: 3 };

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export const trialDays = (env: Env): number => num(env.TRIAL_DAYS, DEFAULTS.TRIAL_DAYS);

export function freeLimits(env: Env): FreeLimits {
  return {
    maxClasses: num(env.FREE_MAX_CLASSES, DEFAULTS.FREE_MAX_CLASSES),
    maxStudents: num(env.FREE_MAX_STUDENTS, DEFAULTS.FREE_MAX_STUDENTS),
    maxAssessments: num(env.FREE_MAX_ASSESSMENTS, DEFAULTS.FREE_MAX_ASSESSMENTS),
    aiRequestsPerMonth: num(env.FREE_AI_REQUESTS, DEFAULTS.FREE_AI_REQUESTS),
  };
}

export const UNLIMITED: FreeLimits = { maxClasses: null, maxStudents: null, maxAssessments: null, aiRequestsPerMonth: null };

/** Pending payments older than this are treated as expired transactions. */
export const PAYMENT_TTL_MIN = 30;
