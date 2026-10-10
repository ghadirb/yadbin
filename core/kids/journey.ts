import { baseLevelForAge, clamp, DEFAULT_KIDS_CONFIG, levelCeiling, levelFloor, type KidsConfig } from './config';
import { sessionSeed, themeFor } from './content';
import { GAME_SPECS } from './games/specs';
import { dayDiff, localDay, type SkillGrowth } from './growth';
import { makeRng } from './rng';
import { GAME_IDS, type GameId, type Skill } from './types';

export interface RecentSession { gameId: GameId; at: string; durationMs: number; performance: number }
export interface JourneyInput {
  childKey: string; age: number; day: string; nowIso: string;
  recent: RecentSession[];
  levels: Partial<Record<GameId, number>>;
  growth?: Pick<SkillGrowth, 'skill' | 'score' | 'trend' | 'samples'>[];
  playCounts?: Partial<Record<GameId, number>>;
  lastTheme?: Partial<Record<GameId, string>>;
  cfg?: KidsConfig;
}
export interface JourneyItem { order: number; gameId: GameId; skill: Skill; level: number; seed: string; themeId: string }
export interface Journey { day: string; items: JourneyItem[]; estimatedMinutes: number }

/**
 * Daily Journey (spec §11, §38): a few short games chosen for age, history, under-practised skills, current trend,
 * variety and recent fatigue. Deterministic for (child, day): the same inputs always give the same journey.
 */
export function buildDailyJourney(inp: JourneyInput): Journey {
  const cfg = inp.cfg ?? DEFAULT_KIDS_CONFIG;
  const rng = makeRng(`${inp.childKey}|${inp.day}|journey`);
  const last = new Map<GameId, string>();
  for (const s of [...inp.recent].sort((a, b) => a.at.localeCompare(b.at))) last.set(s.gameId, s.at);
  const recentIds = [...inp.recent].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3).map((s) => s.gameId);
  const sk = new Map(inp.growth?.map((g) => [g.skill, g]) ?? []);
  const candidates = GAME_IDS.filter((g) => inp.age >= GAME_SPECS[g].ageRange[0] && inp.age <= GAME_SPECS[g].ageRange[1]);
  const scored = candidates.map((g) => {
    const spec = GAME_SPECS[g];
    const lastAt = last.get(g);
    const daysSince = lastAt ? dayDiff(inp.day, localDay(lastAt)) : 99;
    let s = Math.min(daysSince, 7) / 7 * 3;                                  // neglected games first
    const g2 = sk.get(spec.skill);
    if (g2 && g2.samples >= cfg.growth.minSignals && g2.score !== null) s += ((100 - g2.score) / 100) * 2 + (g2.trend === 'down' ? 1 : 0);
    else s += 1.5;                                                            // unmeasured skill: gather data
    const idx = recentIds.indexOf(g);
    if (idx >= 0) s -= idx === 0 ? 3 : 1.5;                                   // variety: avoid repeating the last games
    if (daysSince === 0) s -= 1;
    return { g, s: s + rng() * 0.3 };
  }).sort((a, b) => b.s - a.s);

  const chosen: GameId[] = []; const skills = new Set<Skill>();
  for (const { g } of scored) { const k = GAME_SPECS[g].skill; if (!skills.has(k) && chosen.length < cfg.journey.gamesPerJourney) { chosen.push(g); skills.add(k); } }
  const items: JourneyItem[] = chosen.map((gameId, i) => {
    const lo = levelFloor(inp.age, cfg), hi = levelCeiling(inp.age, cfg);
    const level = clamp(inp.levels[gameId] ?? baseLevelForAge(inp.age, cfg), lo, hi);
    const plays = inp.playCounts?.[gameId] ?? 0;
    return { order: i + 1, gameId, skill: GAME_SPECS[gameId].skill, level, seed: sessionSeed(inp.childKey, inp.day, gameId, plays), themeId: themeFor(inp.childKey, gameId, plays, inp.lastTheme?.[gameId]).id };
  });
  return { day: inp.day, items, estimatedMinutes: Math.max(1, Math.round(items.reduce((a, it) => a + GAME_SPECS[it.gameId].sessionDurationSec, 0) / 60 * 0.7)) };
}

export interface RestAdvice { rest: boolean; reason: 'in_a_row' | 'daily_cap' | null; restMinutes: number }
/** Fatigue / session protection (spec §39). Today's sessions only; `at` = end time. */
export function restAdvice(todays: { at: string; durationMs: number }[], nowMs: number, cfg: KidsConfig = DEFAULT_KIDS_CONFIG): RestAdvice {
  const j = cfg.journey;
  const total = todays.reduce((a, s) => a + s.durationMs, 0);
  if (total >= j.maxDailyMinutes * 60_000) return { rest: true, reason: 'daily_cap', restMinutes: 0 };
  const s = [...todays].sort((a, b) => b.at.localeCompare(a.at));
  let run = 0, ref = nowMs;
  for (const x of s) { const end = Date.parse(x.at); if (ref - end > j.inRowGapMs + (run ? x.durationMs : 0)) break; run++; ref = end - x.durationMs; }
  return run >= j.restAfterGamesInRow ? { rest: true, reason: 'in_a_row', restMinutes: 5 } : { rest: false, reason: null, restMinutes: 0 };
}
export const REST_TEXT = { in_a_row: '🌱 وقت یک استراحت کوتاهه!', daily_cap: '🌟 برای امروز کافیه؛ فردا ماجراجویی تازه‌ای منتظرته!' } as const;
