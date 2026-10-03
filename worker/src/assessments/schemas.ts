import { z } from 'zod';
import { isGradeCode, LEVEL_CODES } from '../education/catalog';

const clean = (v: string | null | undefined) => (v ? v : null);
export const assessmentCreateSchema = z.object({
  title: z.string({ error: 'عنوان آزمون الزامی است.' }).trim().min(1, 'عنوان آزمون الزامی است.').max(100, 'عنوان آزمون خیلی بلند است.'),
  description: z.string().trim().max(500, 'توضیحات خیلی بلند است.').nullable().optional().transform(clean),
  subject: z.string().trim().max(60, 'نام درس خیلی بلند است.').nullable().optional().transform(clean),
  gradeCode: z.string().refine(isGradeCode, 'پایه معتبر نیست.').nullable().optional(),
  level: z.enum(LEVEL_CODES, { error: 'سطح آزمون معتبر نیست.' }).nullable().optional(),
  suggestedMinutes: z.number().int('زمان معتبر نیست.').min(1, 'زمان معتبر نیست.').max(240, 'زمان معتبر نیست.').nullable().optional(),
});
/** undefined = keep, null = clear */
export const assessmentUpdateSchema = z.object({
  title: z.string().trim().min(1, 'عنوان آزمون الزامی است.').max(100, 'عنوان آزمون خیلی بلند است.').optional(),
  description: z.string().trim().max(500, 'توضیحات خیلی بلند است.').nullable().optional(),
  subject: z.string().trim().max(60, 'نام درس خیلی بلند است.').nullable().optional(),
  gradeCode: z.string().refine(isGradeCode, 'پایه معتبر نیست.').nullable().optional(),
  level: z.enum(LEVEL_CODES, { error: 'سطح آزمون معتبر نیست.' }).nullable().optional(),
  suggestedMinutes: z.number().int('زمان معتبر نیست.').min(1, 'زمان معتبر نیست.').max(240, 'زمان معتبر نیست.').nullable().optional(),
});
export const assessmentFeedbackSchema = z.object({ feedback: z.enum(['suitable', 'too_easy', 'too_hard', 'needs_edit'], { error: 'بازخورد معتبر نیست.' }) });
export const assignSchema = z.object({
  classId: z.string().uuid('کلاس معتبر نیست.'),
  studentIds: z.union([z.literal('all'), z.array(z.string().uuid()).min(1, 'حداقل یک دانش‌آموز انتخاب کنید.')]).default('all'),
});
export const publishAssessmentSchema = z.object({
  classId: z.string().uuid('کلاس معتبر نیست.').optional(),
  studentIds: z.union([z.literal('all'), z.array(z.string().uuid()).min(1)]).default('all'),
});
export const reorderSchema = z.object({ order: z.array(z.string().uuid(), { error: 'ترتیب سؤال‌ها معتبر نیست.' }).min(1, 'ترتیب سؤال‌ها معتبر نیست.') });
export const addQuestionExtra = z.object({ position: z.number().int().min(1).max(500).optional() });

export const answerSubmitSchema = z.object({
  sessionId: z.string().uuid(),
  answers: z.array(z.object({
    questionId: z.string().max(64),
    answer: z.unknown().optional(),
    responseTimeMs: z.number().finite().min(0).max(3600_000).optional(),
    answeredAt: z.number().finite().optional(),
  })).max(80),
  durationMs: z.number().min(0).max(4 * 3600_000).optional(),
});
