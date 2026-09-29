import type { GameType } from '../scoring';

/** Tutorial items are local-only. They are never stored in the session events or sent to the server. */
export const TUTORIAL: Record<GameType, any> = {
  memory: { id: 'tut_mem', game: 'memory', difficulty: 1, type: 'sequence', sequence: ['red', 'star', 'blue'], displayDuration: 1500, isReverse: false },
  attention: { id: 'tut_att', game: 'attention', difficulty: 1, type: 'grid', gridSize: 3, cells: ['blue', 'red', 'green', 'yellow', 'blue', 'green', 'red', 'yellow', 'green'], rule: { select: 'blue', avoid: null }, targetCount: 2, ruleChanged: false, phase: 'none', timeLimit: 30000 },
  problem_solving: { id: 'tut_prob', game: 'problem_solving', difficulty: 1, type: 'pattern', question: '🟡 🟣 🟡 🟣 ؟', options: ['🟡', '🟣', '🟠'], correctOption: 0, hint1: 'به ترتیب شکل‌ها نگاه کن.', hint2: 'دو شکل به نوبت می‌آیند.', example: { question: '⭐ 🌙 ⭐ 🌙 ؟', answer: '⭐', explanation: 'بعد از ماه دوباره ستاره می‌آید.' }, version: 1 },
};
export const TUTORIAL_TEXT: Record<GameType, string> = {
  memory: 'چند شکل یکی‌یکی نشان داده می‌شود. آن‌ها را به همان ترتیب انتخاب کن.',
  attention: 'خانه‌های رنگی را ببین. فقط رنگی را که گفته می‌شود انتخاب کن.',
  problem_solving: 'یک سؤال کوتاه می‌آید. جواب را انتخاب کن. اگر لازم شد، راهنمایی بخواه.',
};
