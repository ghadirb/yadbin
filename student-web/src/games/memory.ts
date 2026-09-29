import { bigButton, clear, feedback, h, progress, sleep } from '../components/dom';
import { buildMemoryEvent } from '../question-engine/events';
import { ALL_SYMBOLS, SYMBOL_VIEW } from './symbols';

export async function playMemory(root: HTMLElement, q: any, info: { index: number; total: number } | null): Promise<{ event: any; correct: boolean }> {
  clear(root);
  const stage = h('div', { class: 'stage' });
  root.append(info ? progress(info.index, info.total) : h('div', { class: 'tut-badge' }, 'تمرین'), stage);

  // Phase 1: show the sequence one item at a time.
  stage.append(h('p', { class: 'prompt' }, 'خوب نگاه کن 👀'));
  const shown = h('div', { class: 'big-symbol', 'aria-live': 'polite' });
  stage.append(shown);
  await sleep(500);
  for (const s of q.sequence as string[]) {
    const v = SYMBOL_VIEW[s] ?? { glyph: '❔', name: s };
    shown.textContent = v.glyph; shown.setAttribute('aria-label', v.name);
    await sleep(q.displayDuration);
    shown.textContent = ''; await sleep(300);
  }

  // Phase 2: the child picks items in order (or in reverse order at level 3).
  clear(stage);
  stage.append(h('p', { class: 'prompt' }, q.isReverse ? 'حالا به ترتیب برعکس انتخاب کن 🔁' : 'حالا به همان ترتیب انتخاب کن 👆'));
  const need = q.sequence.length as number;
  const taps: string[] = [];
  const distractors = ALL_SYMBOLS.filter((s) => !q.sequence.includes(s));
  const choices = [...q.sequence, ...distractors.slice(0, Math.max(0, Math.min(3, 9 - need)))].sort((a, b) => (a < b ? -1 : 1));
  const grid = h('div', { class: 'choices' });
  const t0 = performance.now();
  return new Promise((resolve) => {
    let done = false;
    for (const c of choices) {
      const v = SYMBOL_VIEW[c] ?? { glyph: '❔', name: c };
      const b = h('button', { class: 'choice', type: 'button', 'aria-label': v.name }, v.glyph);
      b.addEventListener('click', async () => {
        if (done) return;
        taps.push(c); b.classList.add('picked'); b.append(h('span', { class: 'order' }, String(taps.length))); b.disabled = true;
        if (taps.length === need) {
          done = true;
          const { event, correct } = buildMemoryEvent(q, taps, performance.now() - t0);
          await feedback(stage, correct);
          resolve({ event, correct });
        }
      });
      grid.append(b);
    }
    stage.append(grid);
  });
}

export const memoryTutorialButton = (onClick: () => void) => bigButton('شروع تمرین', onClick, 'primary');
