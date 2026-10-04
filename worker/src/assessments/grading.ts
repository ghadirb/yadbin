import { z } from 'zod';

/** Teacher Assessments: question rules + grading. Pure functions (no I/O) so they are easy to test. */

export const QUESTION_TYPES = ['multiple_choice', 'true_false', 'fill_blank'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUESTION_TYPE_LABELS_FA: Record<QuestionType, string> = { multiple_choice: 'چهارگزینه‌ای', true_false: 'درست / نادرست', fill_blank: 'جای خالی' };
export const MAX_QUESTIONS = 50;

const DIGITS_FA = '۰۱۲۳۴۵۶۷۸۹', DIGITS_AR = '٠١٢٣٤٥٦٧٨٩';
/**
 * Tolerant text comparison for «جای خالی». It removes differences that are only typing habits:
 * edges/extra spaces, half-space (ZWNJ) vs space, Arabic ي ك ى vs Persian ی ک, tatweel, diacritics, digit script, Latin case.
 * It deliberately does NOT merge letters that make different words (e.g. «آب» ≠ «اب»).
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[۰-۹]/g, (d) => String(DIGITS_FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String(DIGITS_AR.indexOf(d)))
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[\u0640\u064B-\u065F\u0670]/g, '')   // tatweel + Arabic diacritics
    .replace(/[\u200c\u200d\u00a0]/g, ' ')          // half-space / joiner / nbsp -> space
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

const text = (label: string, max: number) => z.string({ error: `${label} الزامی است.` }).trim().min(1, `${label} الزامی است.`).max(max, `${label} خیلی بلند است.`);
const explanation = z.string().trim().max(500, 'توضیح پاسخ خیلی بلند است.').nullable().optional().transform((v) => v || null);
const qText = text('متن سؤال', 1000);

export const questionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('multiple_choice'), text: qText,
    options: z.array(text('متن گزینه', 300), { error: 'سؤال چهارگزینه‌ای باید دقیقاً ۴ گزینه داشته باشد.' }).length(4, 'سؤال چهارگزینه‌ای باید دقیقاً ۴ گزینه داشته باشد.'),
    correct: z.number({ error: 'پاسخ صحیح را انتخاب کنید.' }).int('پاسخ صحیح را انتخاب کنید.').min(0, 'پاسخ صحیح را انتخاب کنید.').max(3, 'پاسخ صحیح را انتخاب کنید.'),
    explanation,
  }).superRefine((v, ctx) => {
    const n = v.options.map(normalizeAnswer);
    if (new Set(n).size !== n.length) ctx.addIssue({ code: 'custom', message: 'گزینه‌ها نباید تکراری باشند.', path: ['options'] });
  }),
  z.object({ type: z.literal('true_false'), text: qText, correct: z.boolean({ error: 'پاسخ صحیح (درست یا نادرست) را مشخص کنید.' }), explanation }),
  z.object({
    type: z.literal('fill_blank'), text: qText,
    answers: z.array(text('پاسخ صحیح', 100), { error: 'پاسخ صحیح را وارد کنید.' }).min(1, 'پاسخ صحیح را وارد کنید.').max(10, 'حداکثر ۱۰ پاسخ قابل‌قبول مجاز است.')
      .transform((a) => { const seen = new Set<string>(); return a.filter((x) => { const k = normalizeAnswer(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }); }),
    explanation,
  }),
], { error: 'نوع سؤال معتبر نیست (چهارگزینه‌ای، درست/نادرست یا جای خالی).' });
export type QuestionInput = z.infer<typeof questionSchema>;

/** Stored question (as read from the DB), already decoded. */
export interface StoredQuestion { id: string; position: number; type: QuestionType; text: string; options: string[] | null; correct: number | boolean | string[]; explanation: string | null;
  /** Origin in a teacher's book/source (only for questions made from a source). Never shown to students. */
  sourceId?: string | null; sectionId?: string | null; chunkId?: string | null; pageNumber?: number | null; sourceReference?: string | null }

export function toColumns(q: QuestionInput) {
  return {
    type: q.type, text: q.text, explanation: q.explanation,
    options: q.type === 'multiple_choice' ? JSON.stringify(q.options) : null,
    correct: JSON.stringify(q.type === 'multiple_choice' ? q.correct : q.type === 'true_false' ? q.correct : q.answers),
  };
}
export function fromRow(r: any): StoredQuestion {
  return { id: r.id, position: r.position, type: r.question_type, text: r.text, options: r.options_json ? JSON.parse(r.options_json) : null, correct: JSON.parse(r.correct_json), explanation: r.explanation ?? null,
    sourceId: r.source_id ?? null, sectionId: r.section_id ?? null, chunkId: r.chunk_id ?? null, pageNumber: r.page_number ?? null, sourceReference: r.source_reference ?? null };
}

/** What a student (or a preview) may see: never the answer, never the explanation. */
export const studentView = (q: StoredQuestion) => ({ id: q.id, type: q.type, text: q.text, ...(q.options ? { options: q.options } : {}) });
/** What the teacher sees in the editor. */
export const teacherView = (q: StoredQuestion) => ({
  id: q.id, position: q.position, type: q.type, typeLabel: QUESTION_TYPE_LABELS_FA[q.type], text: q.text, options: q.options, explanation: q.explanation,
  sourceReference: q.sourceReference ?? null, sourcePage: q.pageNumber ?? null,
  ...(q.type === 'fill_blank' ? { answers: q.correct as string[] } : { correct: q.correct }),
});

export interface Graded { answered: boolean; correct: boolean; selected: number | null; text: string | null }
/** A wrong-typed or empty answer counts as «unanswered» (never as a lucky hit). */
export function gradeAnswer(q: StoredQuestion, raw: unknown): Graded {
  const none: Graded = { answered: false, correct: false, selected: null, text: null };
  if (q.type === 'multiple_choice') {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 3) return none;
    return { answered: true, correct: raw === q.correct, selected: raw, text: null };
  }
  if (q.type === 'true_false') {
    if (typeof raw !== 'boolean') return none;
    return { answered: true, correct: raw === q.correct, selected: raw ? 1 : 0, text: null };
  }
  if (typeof raw !== 'string') return none;
  const given = normalizeAnswer(raw);
  if (!given) return none;
  const ok = (q.correct as string[]).some((a) => normalizeAnswer(a) === given);
  return { answered: true, correct: ok, selected: null, text: raw.trim().slice(0, 200) };
}

export interface Score { total: number; correct: number; unanswered: number; percent: number }
export const percentOf = (correct: number, total: number) => (total ? Math.round((correct / total) * 1000) / 10 : 0);

/** Teacher-facing problems that block a preview / publication (plain Persian). */
export function assessmentProblems(a: { title: string }, qs: StoredQuestion[]): string[] {
  const out: string[] = [];
  if (!a.title?.trim()) out.push('عنوان آزمون خالی است.');
  if (qs.length < 1) out.push('آزمون باید حداقل یک سؤال داشته باشد.');
  qs.forEach((q, i) => {
    const r = questionSchema.safeParse(q.type === 'multiple_choice' ? { type: q.type, text: q.text, options: q.options, correct: q.correct, explanation: q.explanation }
      : q.type === 'true_false' ? { type: q.type, text: q.text, correct: q.correct, explanation: q.explanation } : { type: q.type, text: q.text, answers: q.correct, explanation: q.explanation });
    if (!r.success) out.push(`سؤال ${i + 1}: ${r.error.issues[0]?.message ?? 'معتبر نیست.'}`);
  });
  return out;
}
