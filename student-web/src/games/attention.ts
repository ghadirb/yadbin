import { bigButton, clear, feedback, h, progress, sleep } from '../components/dom';
import { buildAttentionEvent } from '../question-engine/events';
import { COLOR_VIEW } from './symbols';

export async function playAttention(root: HTMLElement, q: any, info: { index: number; total: number; ruleJustChanged?: boolean } | null): Promise<{ event: any; correct: boolean }> {
  clear(root);
  const stage = h('div', { class: 'stage' });
  root.append(info ? progress(info.index, info.total) : h('div', { class: 'tut-badge' }, 'تمرین'), stage);
  const sel = COLOR_VIEW[q.rule.select], av = q.rule.avoid ? COLOR_VIEW[q.rule.avoid] : null;
  const ruleText = `${sel.fa} ${sel.shape} را انتخاب کن${av ? `، ${av.fa} ${av.shape} را انتخاب نکن` : ''}.`;

  if (info?.ruleJustChanged) {
    stage.append(h('p', { class: 'prompt big' }, 'قانون عوض شد! 🔄'), h('p', { class: 'rule' }, ruleText));
    const ok = bigButton('فهمیدم', () => {}, 'primary'); stage.append(ok);
    await new Promise<void>((r) => ok.addEventListener('click', () => r(), { once: true }));
    clear(stage);
  }
  stage.append(h('p', { class: 'rule', role: 'note' }, ruleText));
  const grid = h('div', { class: 'grid', style: `--n:${q.gridSize}` });
  const selected = new Set<number>();
  const t0 = performance.now();
  let firstTap: number | null = null;

  return new Promise((resolve) => {
    let finished = false;
    const finish = async () => {
      if (finished) return; finished = true;
      const event = buildAttentionEvent(q, [...selected], firstTap, performance.now() - t0);
      const correct = event.correctTargets === q.targetCount && event.wrongTargets === 0 && event.falseClicks === 0;
      grid.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      await feedback(stage, correct);
      resolve({ event, correct });
    };
    (q.cells as string[]).forEach((color, i) => {
      const v = COLOR_VIEW[color] ?? { fa: color, shape: '?', css: 'c-red' };
      const b = h('button', { class: `cell ${v.css}`, type: 'button', 'aria-label': v.fa, 'aria-pressed': 'false' }, v.shape);
      b.addEventListener('click', () => {
        if (firstTap === null) firstTap = performance.now() - t0;
        if (selected.has(i)) { selected.delete(i); b.classList.remove('picked'); b.setAttribute('aria-pressed', 'false'); }
        else { selected.add(i); b.classList.add('picked'); b.setAttribute('aria-pressed', 'true'); }
      });
      grid.append(b);
    });
    stage.append(grid, bigButton('تمام شد ✅', finish, 'primary'));
    const limit = q.timeLimit ?? 8000;
    void sleep(limit).then(finish); // no visible countdown (avoid stress); the trial simply ends
  });
}
