import { makeRng, seedFrom } from './rng';
import type { GameId, Skill, Theme } from './types';

/** Content bank (spec §12): themes change what the child SEES without changing what is measured. */
export const THEMES: Theme[] = [
  { id: 'animals', name: 'حیوانات', emojis: ['🐰', '🐱', '🐶', '🐼', '🦊', '🐸', '🐵', '🐯', '🦁', '🐮'], bg: 'bg-sun' },
  { id: 'fruits', name: 'میوه‌ها', emojis: ['🍎', '🍌', '🍇', '🍓', '🍊', '🍉', '🍒', '🍍', '🥝', '🍐'], bg: 'bg-mint' },
  { id: 'vehicles', name: 'وسیله‌ها', emojis: ['🚗', '🚌', '🚲', '🚁', '🚂', '⛵', '🚀', '🚜', '🛴', '🚒'], bg: 'bg-sky' },
  { id: 'sea', name: 'دریا', emojis: ['🐟', '🐙', '🐢', '🐬', '🦀', '🐳', '🦑', '🐠', '🐚', '⭐'], bg: 'bg-sea' },
  { id: 'space', name: 'فضا', emojis: ['🌙', '⭐', '🪐', '☄️', '🚀', '👽', '🌍', '☀️', '🛸', '🌟'], bg: 'bg-night' },
  { id: 'garden', name: 'باغ', emojis: ['🌻', '🌷', '🌳', '🍄', '🐝', '🦋', '🐞', '🌹', '🌵', '🍀'], bg: 'bg-leaf' },
];

/** Different theme from the last one played of this game whenever possible; deterministic per (child, game, play count). */
export function themeFor(childKey: string, gameId: GameId, playCount: number, lastThemeId?: string | null): Theme {
  const rng = makeRng(`${childKey}|${gameId}|${playCount}|theme`);
  const pool = THEMES.filter((t) => t.id !== lastThemeId);
  return pool[Math.floor(rng() * pool.length)];
}
export const sessionSeed = (childKey: string, day: string, gameId: GameId, playCount: number) => `${childKey}|${day}|${gameId}|${playCount}|${seedFrom(`${gameId}${playCount}`)}`;

/** Child-facing wording: a story, never a test (spec §3, §55). */
export const GAME_META: Record<GameId, { title: string; story: string; emoji: string; skillEmoji: string }> = {
  memory_match: { title: 'خانه‌ها را پیدا کن', story: 'کارت‌های شبیه هم را پیدا کن و برگردان!', emoji: '🐰', skillEmoji: '🧠' },
  visual_attention: { title: 'پیداش کن', story: 'دوستِ گم‌شده را بین بقیه پیدا کن!', emoji: '🔍', skillEmoji: '🎯' },
  pattern_logic: { title: 'ادامهٔ ماجرا', story: 'ببین بعدش چی می‌آید!', emoji: '🔷', skillEmoji: '🔷' },
  reaction_control: { title: 'بپر یا بایست', story: 'خرگوش را بگیر؛ اما گرگ را بیدار نکن!', emoji: '⚡', skillEmoji: '⚡' },
  path_puzzle: { title: 'راه را پیدا کن', story: 'ستاره‌ها را جمع کن و به خانه برس!', emoji: '🧩', skillEmoji: '🧩' },
  rule_switch: { title: 'قانون جادویی', story: 'قانون عوض می‌شود؛ تو هم با آن عوض شو!', emoji: '🎩', skillEmoji: '🔀' },
};
/** Parent-facing skill names + emoji. */
export const SKILL_META: Record<Skill, { name: string; emoji: string }> = {
  memory: { name: 'حافظه', emoji: '🧠' },
  attention: { name: 'توجه', emoji: '🎯' },
  processing_speed: { name: 'سرعت', emoji: '⚡' },
  problem_solving: { name: 'حل مسئله', emoji: '🧩' },
  logic: { name: 'منطق و الگو', emoji: '🔷' },
  response_control: { name: 'کنترل پاسخ', emoji: '🛑' },
  cognitive_flexibility: { name: 'انعطاف‌پذیری', emoji: '🔀' },
  learning: { name: 'یادگیری از تجربه', emoji: '🌱' },
};
