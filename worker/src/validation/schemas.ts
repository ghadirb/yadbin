import { z } from 'zod';
import { HttpError } from '../utils/http';
import { gradeByCode, isGradeCode, LEVEL_CODES, normalizeBirthYear, SKILL_CODES } from '../education/catalog';

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
const gradeCode = z.string().refine(isGradeCode, 'پایه معتبر نیست.');
const ageNum = (label: string) => z.number({ error: `${label} معتبر نیست.` }).int(`${label} معتبر نیست.`).min(3, `${label} معتبر نیست.`).max(25, `${label} معتبر نیست.`);
const rangeCheck = (v: { ageMin?: number | null; ageMax?: number | null }, ctx: z.RefinementCtx) => {
  if (v.ageMin != null && v.ageMax != null && v.ageMin > v.ageMax) ctx.addIssue({ code: 'custom', message: 'حداقل سن نباید از حداکثر سن بیشتر باشد.', path: ['ageMin'] });
};
/** `grade` (free text) stays for v1.0/v1.1 clients; `gradeCode` is the structured v1.2 field. undefined = keep, null = clear. */
export const classSchema = z.object({
  name: name('نام کلاس'), grade: name('پایه', 40).optional(), gradeCode: gradeCode.nullable().optional(),
  schoolName: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
  ageMin: ageNum('حداقل سن').nullable().optional(), ageMax: ageNum('حداکثر سن').nullable().optional(),
  educationStage: z.enum(['preschool', 'primary', 'lower_secondary', 'upper_secondary']).nullable().optional(),
}).superRefine(rangeCheck).superRefine((v, ctx) => {
  if (!v.grade && !v.gradeCode) ctx.addIssue({ code: 'custom', message: 'پایه الزامی است.', path: ['grade'] });
});
const birthDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ تولد معتبر نیست.').refine((v) => { const d = new Date(v + 'T00:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getTime() <= Date.now() && d.getUTCFullYear() >= 1990; }, 'تاریخ تولد معتبر نیست.');
const birthYear = z.number().int('سال تولد معتبر نیست.').transform(normalizeBirthYear).refine((y) => y >= 1990 && y <= new Date().getUTCFullYear(), 'سال تولد معتبر نیست.');
/** Optional student profile fields (v1.2). Nothing is mandatory; undefined = keep, null = clear. `age` is converted to a birth year (age is never stored). */
export const studentProfileFields = {
  birthDate: birthDate.nullable().optional(), birthYear: birthYear.nullable().optional(), age: ageNum('سن').nullable().optional(),
  gradeCode: gradeCode.nullable().optional(), gender: z.enum(['female', 'male']).nullable().optional(),
  note: z.string().trim().max(500, 'توضیحات خیلی بلند است.').nullable().optional(),
};
export const studentSchema = z.object({ name: name('نام دانش‌آموز'), classId: z.string().uuid().optional(), ...studentProfileFields });
export const studentUpdateSchema = z.object({ name: name('نام دانش‌آموز').optional(), ...studentProfileFields });
export const bulkStudentsSchema = z.object({
  name: z.string().optional(),
  names: z.array(z.string()).optional(),
  text: z.string().max(20000).optional(),
  /** Optional: applied to every student added in this request (drives the default girl/boy avatar). */
  gender: z.enum(['female', 'male']).nullable().optional(),
});
const gradeRangeCheck = (v: { gradeMin?: string | null; gradeMax?: string | null }, ctx: z.RefinementCtx) => {
  const a = gradeByCode(v.gradeMin), b = gradeByCode(v.gradeMax);
  if (a && b && a.order > b.order) ctx.addIssue({ code: 'custom', message: 'پایه شروع نباید بالاتر از پایه پایان باشد.', path: ['gradeMin'] });
};
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
  ageMin: ageNum('حداقل سن').nullable().optional(), ageMax: ageNum('حداکثر سن').nullable().optional(),
  gradeMin: gradeCode.nullable().optional(), gradeMax: gradeCode.nullable().optional(),
  level: z.enum(LEVEL_CODES, { error: 'سطح فعالیت معتبر نیست.' }).nullable().optional(),
  skills: z.array(z.enum(SKILL_CODES, { error: 'مهارت معتبر نیست.' })).max(5, 'حداکثر ۵ مهارت').nullable().optional(),
  templateId: z.string().max(40).nullable().optional(),
  // Accepted only for forward-compatible clients. New activities always require preview.
  requiresPreview: z.boolean().optional(),
}).superRefine(rangeCheck).superRefine(gradeRangeCheck);
export const activityUpdateSchema = z.object({
  title: z.string().trim().max(80, 'عنوان خیلی بلند است.').nullable().optional(),
  description: z.string().trim().max(500, 'توضیحات خیلی بلند است.').nullable().optional(),
  suggestedMinutes: z.number().int().min(1, 'زمان معتبر نیست.').max(120, 'زمان معتبر نیست.').nullable().optional(),
  difficultyMode: z.enum(['adaptive', 'easy', 'medium', 'hard']).optional(),
  questionCount: z.number().int().min(5, 'حداقل ۵ سؤال').max(12, 'حداکثر ۱۲ سؤال').optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
  ageMin: ageNum('حداقل سن').nullable().optional(), ageMax: ageNum('حداکثر سن').nullable().optional(),
  gradeMin: gradeCode.nullable().optional(), gradeMax: gradeCode.nullable().optional(),
  level: z.enum(LEVEL_CODES, { error: 'سطح فعالیت معتبر نیست.' }).nullable().optional(),
  skills: z.array(z.enum(SKILL_CODES, { error: 'مهارت معتبر نیست.' })).max(5, 'حداکثر ۵ مهارت').nullable().optional(),
  templateId: z.string().max(40).nullable().optional(),
}).superRefine(rangeCheck).superRefine(gradeRangeCheck);
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
