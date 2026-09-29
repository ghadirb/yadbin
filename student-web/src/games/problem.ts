import { bigButton, clear, feedback, h, progress } from '../components/dom';
import { buildProblemEvent } from '../question-engine/events';

const MAX_ATTEMPTS = 3;

export async function playProblem(root: HTMLElement, q: any, info: { index: number; total: number } | null): Promise<{ event: any; correct: boolean }> {
  clear(root);
  const stage = h('div', { class: 'stage' });
  root.append(info ? progress(info.index, info.total) : h('div', { class: 'tut-badge' }, 'تمرین'), stage);
  stage.append(h('p', { class: 'question' }, q.question));
  const hintBox = h('div', { class: 'hints', 'aria-live': 'polite' });
  const opts = h('div', { class: 'options' });
  let attempts = 0, hints = 0, last: number | null = null;
  const t0 = performance.now();

  return new Promise((resolve) => {
    let done = false;
    const end = async (correct: boolean) => {
      if (done) return; done = true;
      opts.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      const { event } = buildProblemEvent(q, attempts, hints, last, performance.now() - t0);
      resolve({ event, correct });
    };
    (q.options as string[]).forEach((text, i) => {
      const b = h('button', { class: 'option', type: 'button' }, text);
      b.addEventListener('click', async () => {
        if (done) return;
        attempts++; last = i;
        if (i === q.correctOption) { b.classList.add('right'); await feedback(stage, true); await end(true); return; }
        b.disabled = true; b.classList.add('wrong');
        if (attempts >= MAX_ATTEMPTS) { await feedback(stage, false); await end(false); return; }
        await feedback(stage, false);
      });
      opts.append(b);
    });
    const hintBtn = bigButton('راهنمایی 💡', () => {
      if (hints >= 3 || done) return;
      hints++;
      const text = hints === 1 ? q.hint1 : hints === 2 ? q.hint2 : `مثال: ${q.example.question}  ← ${q.example.answer}. ${q.example.explanation}`;
      hintBox.append(h('p', { class: 'hint' }, text));
      if (hints >= 3) hintBtn.disabled = true;
    }, 'secondary');
    stage.append(opts, hintBtn, hintBox);
  });
}
