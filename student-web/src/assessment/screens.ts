import { bigButton, clear, h, progress, waitForClick } from '../components/dom';
import type { AQuestion, AssessmentUi, PreviewResult } from './runner';

const fa = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
const LETTERS = ['الف', 'ب', 'ج', 'د'];

/** Child-facing screens of a Teacher Assessment. Same look as the activities (card / btn / option). Never shows correct answers or a score. */
export function createAssessmentUi(root: HTMLElement, opts: { preview?: boolean } = {}): AssessmentUi {
  return {
    async intro(a, preview) {
      clear(root);
      const go = bigButton(preview ? 'شروع آزمایش' : 'شروع آزمون', () => {}, 'primary');
      root.append(h('section', { class: 'card center', 'data-assessment': 'intro' },
        h('h1', {}, a.title),
        a.subject ? h('p', { class: 'end-line' }, `درس: ${a.subject}`) : null,
        a.description ? h('p', {}, a.description) : null,
        h('p', { class: 'end-line' }, `تعداد سؤال: ${fa(a.questionCount)}`),
        a.suggestedMinutes ? h('p', { class: 'end-line' }, `زمان پیشنهادی: ${fa(a.suggestedMinutes)} دقیقه`) : null,
        preview ? h('p', {}, 'این اجرا فقط برای آزمایش شماست و در گزارش هیچ دانش‌آموزی ثبت نمی‌شود.') : h('p', {}, 'با دقت بخوان و جواب بده. اگر جواب را نمی‌دانی، می‌توانی بگذری.'),
        go));
      await waitForClick(go);
    },

    ask(q: AQuestion, info) {
      clear(root);
      return new Promise((resolve) => {
        let value: unknown = info.previous;
        const next = bigButton(info.isLast ? 'ارسال آزمون' : 'بعدی', () => resolve({ answer: value, direction: 'next' }), 'primary');
        const back = info.canGoBack ? bigButton('قبلی', () => resolve({ answer: value, direction: 'back' })) : null;
        const body = h('div', { class: 'a-body' });

        if (q.type === 'multiple_choice') {
          const wrap = h('div', { class: 'options', role: 'radiogroup' });
          const paint = () => wrap.childNodes.forEach((n, i) => (n as HTMLElement).classList.toggle('picked', value === i));
          (q.options ?? []).forEach((t, i) => wrap.append(h('button', { class: 'option text', type: 'button', role: 'radio', 'data-choice': i, onclick: () => { value = i; paint(); } }, `${LETTERS[i]}) ${t}`)));
          body.append(wrap); paint();
        } else if (q.type === 'true_false') {
          const wrap = h('div', { class: 'options', role: 'radiogroup' });
          const paint = () => { (wrap.children[0] as HTMLElement).classList.toggle('picked', value === true); (wrap.children[1] as HTMLElement).classList.toggle('picked', value === false); };
          wrap.append(h('button', { class: 'option text', type: 'button', role: 'radio', 'data-choice': 'true', onclick: () => { value = true; paint(); } }, 'درست'),
            h('button', { class: 'option text', type: 'button', role: 'radio', 'data-choice': 'false', onclick: () => { value = false; paint(); } }, 'نادرست'));
          body.append(wrap); paint();
        } else {
          const input = h('input', { class: 'a-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: 100, 'aria-label': 'پاسخ', dir: 'auto', 'data-fill': '1' });
          if (typeof value === 'string') input.value = value;
          input.addEventListener('input', () => { value = input.value; });
          body.append(input);
        }
        root.append(h('section', { class: 'card', 'data-assessment': 'question' },
          progress(info.index, info.total),
          h('p', { class: 'end-line' }, `سؤال ${fa(info.index + 1)} از ${fa(info.total)}`),
          h('h2', { class: 'a-text' }, q.text), body,
          h('div', { class: 'a-nav' }, back, next)));
      });
    },

    end(kind) {
      clear(root);
      const msg = kind === 'sent' ? ['آفرین! 🎉', 'آزمون ارسال شد. می‌توانی این صفحه را ببندی.']
        : kind === 'saved' ? ['آفرین! 🎉', 'پاسخ‌ها روی دستگاه ذخیره شد و بعداً ارسال می‌شود.'] : ['این آزمون قبلاً انجام شده است.', ''];
      root.append(h('section', { class: 'card center', role: 'status', 'data-assessment': 'end' }, h('h1', {}, msg[0]), msg[1] ? h('p', {}, msg[1]) : null)); // no score is shown to the child
    },

    previewEnd(result: PreviewResult | null, questions: AQuestion[]) {
      clear(root);
      const card = h('section', { class: 'card', role: 'status', 'data-preview': 'end' }, h('h1', { class: 'center' }, 'آزمایش تمام شد'));
      if (result) {
        card.append(h('p', { class: 'end-line center' }, `${fa(result.correct)} از ${fa(result.total)} (${fa(result.percent)}٪) — بی‌پاسخ: ${fa(result.unanswered)}`));
        result.items.forEach((it, i) => {
          const q = questions.find((x) => x.id === it.questionId);
          const ans = typeof it.correctAnswer === 'boolean' ? (it.correctAnswer ? 'درست' : 'نادرست') : typeof it.correctAnswer === 'number' ? (q?.options?.[it.correctAnswer] ?? '') : String(it.correctAnswer ?? '');
          card.append(h('div', { class: `a-row ${!it.answered ? 'none' : it.isCorrect ? 'ok' : 'bad'}` },
            h('strong', {}, `${fa(i + 1)}. ${!it.answered ? 'بی‌پاسخ' : it.isCorrect ? 'درست' : 'نادرست'}`),
            h('span', {}, ` — پاسخ صحیح: ${ans}`), it.explanation ? h('p', {}, it.explanation) : null));
        });
      }
      card.append(h('p', {}, 'این اجرا در هیچ گزارشی ثبت نشد. به اپ معلم برگردید و بازخورد خود را ثبت کنید.'));
      root.append(card);
    },
  };
}
