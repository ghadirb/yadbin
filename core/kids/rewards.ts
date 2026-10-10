import type { GameId } from './types';

/** Motivation without competition (spec §23, §42): XP, stars, badges, worlds — only ever «me today vs me yesterday». */
export const WORLDS = [
  { code: 'forest', name: 'جنگل مهربان', emoji: '🌲', xp: 0 },
  { code: 'sea', name: 'دریای آبی', emoji: '🌊', xp: 120 },
  { code: 'desert', name: 'کویر طلایی', emoji: '🏜️', xp: 320 },
  { code: 'space', name: 'فضای ستاره‌ها', emoji: '🚀', xp: 650 },
  { code: 'castle', name: 'قلعهٔ رنگین‌کمان', emoji: '🏰', xp: 1100 },
] as const;

export const BADGES: Record<string, { name: string; emoji: string }> = {
  first_game: { name: 'اولین بازی', emoji: '🎈' },
  journey_done: { name: 'ماجراجویی امروز تمام شد', emoji: '🗺️' },
  streak_3: { name: 'سه روز پشت سر هم', emoji: '🔥' },
  streak_7: { name: 'یک هفتهٔ قهرمانی', emoji: '🏅' },
  personal_best: { name: 'رکورد خودم', emoji: '🌟' },
  level_up: { name: 'مرحلهٔ بعد باز شد', emoji: '🔓' },
  explorer: { name: 'کاوشگر هر شش بازی', emoji: '🧭' },
  comeback: { name: 'بعد از اشتباه دوباره امتحان کردم', emoji: '💪' },
};

export const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🦄', '🐙', '🦉', '🐧'];
export const isAvatar = (a: unknown): a is string => typeof a === 'string' && AVATARS.includes(a);

/** 1..3 stars. A child ALWAYS gets at least one star: finishing is never punished. */
export function starsFor(performance: number): 1 | 2 | 3 { return performance >= 0.85 ? 3 : performance >= 0.6 ? 2 : 1; }
export const xpFor = (stars: number, level: number) => 10 + stars * 5 + level * 2;
export const worldsFor = (xp: number) => WORLDS.filter((w) => xp >= w.xp).map((w) => w.code);

export interface RewardContext {
  performance: number; level: number; levelUp: boolean;
  /** best performance this child ever had in THIS game (before this session), null = first time. */
  previousBest: number | null;
  totalSessionsBefore: number;
  gamesPlayedBefore: GameId[];
  gameId: GameId;
  streakDays: number;
  journeyJustCompleted: boolean;
  recoveryDelta: number | null;
  xpBefore: number;
  badgesHeld: string[];
}
export interface RewardResult { stars: 1 | 2 | 3; xp: number; newBadges: string[]; personalBest: boolean; newWorlds: string[]; xpAfter: number }

export function evaluateRewards(c: RewardContext): RewardResult {
  const stars = starsFor(c.performance);
  const xp = xpFor(stars, c.level);
  const personalBest = c.previousBest !== null && c.performance > c.previousBest + 0.02;
  const earned: string[] = [];
  if (c.totalSessionsBefore === 0) earned.push('first_game');
  if (personalBest) earned.push('personal_best');
  if (c.levelUp) earned.push('level_up');
  if (c.journeyJustCompleted) earned.push('journey_done');
  if (c.streakDays >= 3) earned.push('streak_3');
  if (c.streakDays >= 7) earned.push('streak_7');
  if (new Set([...c.gamesPlayedBefore, c.gameId]).size >= 6) earned.push('explorer');
  if (c.recoveryDelta !== null && c.recoveryDelta >= 0.15) earned.push('comeback');
  const newBadges = earned.filter((b) => !c.badgesHeld.includes(b));
  const xpAfter = c.xpBefore + xp;
  const newWorlds = worldsFor(xpAfter).filter((w) => !worldsFor(c.xpBefore).includes(w));
  return { stars, xp, newBadges, personalBest, newWorlds, xpAfter };
}
