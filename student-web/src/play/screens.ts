import { bigButton, clear, h, waitForClick } from '../components/dom';
import type { GameUi } from '../session/controller';
import { TUTORIAL, TUTORIAL_TEXT } from '../question-engine/tutorial';
import { playAttention } from '../games/attention';
import { playMemory } from '../games/memory';
import { playProblem } from '../games/problem';
import type { GameType } from '../scoring';

const GAME_TITLES: Record<GameType, string> = { memory: 'به خاطر بسپار', attention: 'پیداش کن', problem_solving: 'راهش را پیدا کن' };

function play(root: HTMLElement, game: GameType, q: any, info: any) {
  return game === 'memory' ? playMemory(root, q, info) : game === 'attention' ? playAttention(root, q, info) : playProblem(root, q, info);
}

export interface ProgressView { message: string; games: { gameName: string; completed: number }[] }

/** [loadProgress] returns the child's own progress (or null when offline/unavailable). No names, no scores. */
export function createDomUi(root: HTMLElement, loadProgress?: () => Promise<ProgressView | null>): GameUi {
  return {
    async welcome() {
      clear(root);
      const btn = bigButton('شروع بازی', () => {}, 'primary');
      root.append(h('section', { class: 'card center' },
        h('h1', {}, 'سلام 👋'),
        h('p', {}, 'این یک بازی کوتاه است.'),
        h('p', {}, 'اینجا قرار نیست نمره بگیری.'),
        h('p', {}, 'با دقت بازی کن و سعی کن بهترین کاری را که می‌توانی انجام بدهی.'),
        btn));
      await waitForClick(btn);
    },
    async tutorial(game) {
      clear(root);
      const go = bigButton('شروع تمرین', () => {}, 'primary');
      root.append(h('section', { class: 'card center' }, h('h2', {}, GAME_TITLES[game]), h('p', {}, TUTORIAL_TEXT[game]), go));
      await waitForClick(go);
      await play(root, game, TUTORIAL[game], null); // practice: result thrown away
      clear(root);
      const ready = bigButton('آماده‌ام', () => {}, 'primary');
      root.append(h('section', { class: 'card center' }, h('h2', {}, 'آفرین! 🎉'), h('p', {}, 'حالا بازی اصلی شروع می‌شود.'), ready));
      await waitForClick(ready);
    },
    playQuestion: (game, q, info) => play(root, game, q, info),
    end(kind, accuracy) {
      clear(root);
      const msg = kind === 'sent' ? ['آفرین! 🎉', 'فعالیت تمام شد. می‌توانی این صفحه را ببندی.']
        : kind === 'saved' ? ['آفرین! 🎉', 'نتیجه روی دستگاه ذخیره شد و بعداً ارسال می‌شود.']
        : ['این فعالیت قبلاً انجام شده است.', ''];
      // Spec 4.2: short encouraging feedback. Wording only, never a score or a comparison.
      const fb = kind === 'already' || accuracy === undefined ? [] : [
        accuracy === null || accuracy >= 0.5 ? (accuracy !== null && accuracy >= 0.8 ? 'عملکرد خیلی خوب بود.' : 'عملکرد خوب بود.') : 'تمرین بیشتر کمک می‌کند؛ تلاشت عالی بود.',
        'می‌توانی مرحله بعد را امتحان کنی.',
      ];
      const card = h('section', { class: 'card center', role: 'status' }, h('h1', {}, msg[0]), msg[1] ? h('p', {}, msg[1]) : null, ...fb.map((l) => h('p', { class: 'end-line' }, l)));
      root.append(card);
      // Spec 4.1: personal progress, shown on request and only once the result has reached the server.
      if (loadProgress && kind === 'sent') {
        const box = h('div', { class: 'my-progress' });
        const btn = bigButton('پیشرفت من', async () => {
          btn.disabled = true;
          const p = await loadProgress();
          clear(box);
          if (!p) { box.append(h('p', {}, 'الان نمی‌توانم پیشرفتت را نشان بدهم.')); btn.disabled = false; return; }
          box.append(h('p', {}, p.message), ...p.games.map((g) => h('p', {}, `${g.gameName}: ${g.completed}`)));
          btn.remove();
        });
        card.append(btn, box);
      }
    },
    error(kind, message, retry) {
      clear(root);
      const card = h('section', { class: 'card center', role: 'alert' }, h('h2', {}, kind === 'invalid' ? '🔗' : kind === 'network' ? '📶' : '⏳'), ...message.split('\n').map((l) => h('p', {}, l)));
      if (retry) card.append(bigButton('تلاش دوباره', retry, 'primary'));
      root.append(card);
    },
  };
}

export function offlineBanner(): HTMLElement {
  const b = h('div', { class: 'banner', role: 'status', 'aria-live': 'polite', hidden: true }, 'اتصال اینترنت قطع شد. بازی ادامه پیدا می‌کند.');
  const sync = () => { b.hidden = navigator.onLine; };
  window.addEventListener('online', sync); window.addEventListener('offline', sync); sync();
  return b;
}
