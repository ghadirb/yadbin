import { z } from 'zod';
import type { Env } from '../env';
import { LEVEL_CODES } from '../education/catalog';
import { getOwnedStudent } from '../db/queries';
import { createGrowthSummary, defaultProvider } from '../growth/ai';
import { buildGrowth, type GrowthFilters } from '../growth/service';
import { json, readJson } from '../utils/http';
import { rateLimit } from '../utils/ratelimit';
import { parse } from '../validation/schemas';

const filterSchema = z.object({
  range: z.enum(['7d', '30d', '3m', '6m', 'all'], { error: 'بازهٔ زمانی معتبر نیست.' }).default('30d'),
  game: z.enum(['memory', 'attention', 'problem_solving'], { error: 'نوع فعالیت معتبر نیست.' }).optional(),
  skill: z.string().trim().max(40).optional(),
  level: z.enum(LEVEL_CODES, { error: 'سطح معتبر نیست.' }).optional(),
  subject: z.string().trim().max(60).optional(),
});

function fromQuery(req: Request): GrowthFilters {
  const q = new URL(req.url).searchParams, obj: Record<string, string> = {};
  for (const k of ['range', 'game', 'skill', 'level', 'subject']) { const v = q.get(k); if (v) obj[k] = v; }
  return parse(filterSchema, obj) as GrowthFilters;
}

/** GET /students/:id/growth — teacher + student ownership (a foreign id is a 404). Private: never part of a play link. */
export async function getGrowth(req: Request, env: Env, teacherId: string, id: string) {
  const student = await getOwnedStudent(env.DB, teacherId, id);
  const filters = fromQuery(req);
  await rateLimit(env, `growth:${teacherId}`, 120, 60);
  return json(await buildGrowth(env.DB, teacherId, student, filters));
}

/** POST /students/:id/growth/summary — optional AI wording of the analysis (falls back to the rule-based text). */
export async function postGrowthSummary(req: Request, env: Env, teacherId: string, id: string) {
  const student = await getOwnedStudent(env.DB, teacherId, id);
  const filters = parse(filterSchema, await readJson(req)) as GrowthFilters;
  await rateLimit(env, `growth-ai:${teacherId}`, 20, 3600);
  return json(await createGrowthSummary(env, teacherId, student, filters, defaultProvider(env)));
}
