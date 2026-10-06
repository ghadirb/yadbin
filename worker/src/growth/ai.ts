import type { Env } from '../env';
import { modelTextWith } from '../ai/builder';
import { aiAllowed, consumeAi } from '../subscription/gating';
import { AI_SYSTEM, buildAiFacts, validateAiText, type AiFacts } from './compute';
import { buildGrowth, type GrowthFilters } from './service';

export type TextProvider = (system: string, facts: string) => Promise<string | null>;

/**
 * Optional AI wording of the growth analysis.
 *  1. the backend computes the statistics (buildGrowth) — the model never sees raw results, names, ids or dates;
 *  2. only the small anonymous AiFacts object is sent;
 *  3. the reply is validated (no unknown numbers, no diagnosis / cause / ranking words); anything doubtful is thrown away;
 *  4. on ANY failure (no provider, quota used up, timeout, rejected text) the deterministic analysis is returned — the page never breaks.
 * An AI request is counted against the plan quota only when its text was accepted.
 */
export async function createGrowthSummary(env: Env, teacherId: string, student: { id: string; display_name: string }, filters: GrowthFilters, provider: TextProvider) {
  const g = await buildGrowth(env.DB, teacherId, student, filters);
  const facts: AiFacts = buildAiFacts(g.range, g.cognitive.skills, g.overview, g.assessments);
  const base = { student: g.student, range: g.range, rangeLabel: g.rangeLabel, statements: g.analysis.statements, notice: g.analysis.notice };
  const rules = { ...base, source: 'rules' as const, text: g.analysis.text, sufficient: g.analysis.sufficient };

  if (!g.analysis.sufficient) return { ...rules, aiUsed: false, reason: 'insufficient_data' as const };
  const quota = await aiAllowed(env, teacherId);
  if (!quota.allowed) return { ...rules, aiUsed: false, reason: 'ai_limit_reached' as const, aiLimitReached: true };

  let text: string | null = null;
  try { text = await provider(AI_SYSTEM, JSON.stringify(facts)); } catch { text = null; }
  if (!text) return { ...rules, aiUsed: false, reason: 'ai_unavailable' as const };
  const check = validateAiText(text, facts);
  if (!check.ok) return { ...rules, aiUsed: false, reason: 'ai_rejected' as const, rejected: check.reason };
  await consumeAi(env, teacherId);
  return { ...base, source: 'ai' as const, sufficient: true, text: check.text, aiUsed: true, reason: null, rulesText: g.analysis.text };
}

export const defaultProvider = (env: Env): TextProvider => (system, facts) => modelTextWith(env, system, facts);
