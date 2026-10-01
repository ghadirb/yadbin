import { z } from 'zod';
import { HttpError } from '../utils/http';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function normalizeDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}
/** Iranian mobile numbers: 09xxxxxxxxx (also accepts +98 / 0098 / 98 prefixes). */
export function normalizePhone(raw: string): string | null {
  let p = normalizeDigits(raw).replace(/[\s\-()]/g, '');
  p = p.replace(/^(\+98|0098|98)/, '0');
  if (/^9\d{9}$/.test(p)) p = '0' + p;
  return /^09\d{9}$/.test(p) ? p : null;
}

const name = (label: string, max = 80) => z.string({ error: `${label} الزامی است.` }).trim().min(2, `${label} خیلی کوتاه است.`).max(max, `${label} خیلی بلند است.`);
const phone = z.string({ error: 'شماره موبایل الزامی است.' }).transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) { ctx.addIssue({ code: 'custom', message: 'شماره موبایل معتبر نیست (مثال: 09123456789).' }); return z.NEVER; }
  return p;
});
const password = z.string({ error: 'رمز عبور الزامی است.' }).min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد.').max(128, 'رمز عبور خیلی بلند است.');

export const registerSchema = z.object({ name: name('نام'), phone, password });
export const resetPasswordSchema = z.object({
  phone,
  recoveryCode: z.string({ error: 'کد بازیابی الزامی است.' }).trim().min(8, 'کد بازیابی معتبر نیست.').max(40, 'کد بازیابی معتبر نیست.'),
  newPassword: password,
});
export const loginSchema = z.object({ phone, password: z.string().min(1, 'رمز عبور الزامی است.') });
export const classSchema = z.object({
  name: name('نام کلاس'), grade: name('پایه', 40),
  schoolName: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
});
export const studentSchema = z.object({ name: name('نام دانش‌آموز'), classId: z.string().uuid().optional() });
export const bulkStudentsSchema = z.object({
  name: z.string().optional(),
  names: z.array(z.string()).optional(),
  text: z.string().max(20000).optional(),
});
export const activitySchema = z.object({
  classId: z.string().uuid('کلاس معتبر نیست.'),
  gameType: z.enum(['memory', 'attention', 'problem_solving'], { error: 'بازی معتبر نیست.' }),
  difficultyMode: z.enum(['adaptive', 'easy', 'medium', 'hard']).default('adaptive'),
  questionCount: z.number().int().min(5, 'حداقل ۵ سؤال').max(12, 'حداکثر ۱۲ سؤال').default(10),
  studentIds: z.union([z.literal('all'), z.array(z.string().uuid()).min(1, 'حداقل یک دانش‌آموز انتخاب کنید.')]).default('all'),
  expiresInDays: z.number().int().min(1).max(90).optional(),
  title: z.string().trim().max(80, 'عنوان خیلی بلند است.').optional().nullable().transform((v) => v || null),
  description: z.string().trim().max(500, 'توضیحات خیلی بلند است.').optional().nullable().transform((v) => v || null),
  suggestedMinutes: z.number().int().min(1, 'زمان معتبر نیست.').max(120, 'زمان معتبر نیست.').optional().nullable().transform((v) => v ?? null),
});
export const activityUpdateSchema = z.object({
  title: z.string().trim().max(80, 'عنوان خیلی بلند است.').nullable().optional(),
  description: z.string().trim().max(500, 'توضیحات خیلی بلند است.').nullable().optional(),
  suggestedMinutes: z.number().int().min(1, 'زمان معتبر نیست.').max(120, 'زمان معتبر نیست.').nullable().optional(),
  difficultyMode: z.enum(['adaptive', 'easy', 'medium', 'hard']).optional(),
  questionCount: z.number().int().min(5, 'حداقل ۵ سؤال').max(12, 'حداکثر ۱۲ سؤال').optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});
export const duplicateSchema = z.object({
  title: z.string().trim().max(80).optional().nullable(),
  studentIds: z.union([z.literal('all'), z.array(z.string().uuid()).min(1)]).default('all'),
});
export const regenerateSchema = z.object({ studentId: z.string().uuid().optional() });

const num = (max = 10 * 60 * 1000) => z.number().finite().min(0).max(max);
const int = (max: number, min = 0) => z.number().int().min(min).max(max);
export const memoryEventSchema = z.object({
  sequenceLength: int(12, 1), displayDuration: num(10000), difficulty: int(3, 1), isReverse: z.boolean(),
  correct: z.boolean(), attempts: int(20, 1), responseTime: num(), mistakes: int(50),
});
export const attentionEventSchema = z.object({
  gridSize: int(6, 2), targetType: z.string().max(40), targetCount: int(36), correctTargets: int(36),
  wrongTargets: int(36), missedTargets: int(36), falseClicks: int(200), reactionTime: num(), totalTime: num(),
  difficulty: int(3, 1), ruleChanged: z.boolean(), phase: z.enum(['before', 'after', 'none']),
});
export const problemEventSchema = z.object({
  questionId: z.string().max(40), difficulty: int(3, 1).optional(), attempts: int(20, 1), hintsUsed: int(3),
  responseTime: num(), finalAnswer: z.number().int().min(0).max(10).nullable(),
});
export const completeSchema = z.object({
  sessionId: z.string().uuid(),
  events: z.array(z.unknown()).min(1, 'رویدادی ثبت نشده است.').max(60),
  durationMs: z.number().min(0).max(4 * 60 * 60 * 1000).optional(),
});

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new HttpError(400, 'validation_error', issue?.message || 'ورودی معتبر نیست.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}
