import { z } from 'zod';
import { isAvatar } from '../../../core/kids';
import { GAME_IDS } from '../../../core/kids';

const id = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'شناسه معتبر نیست.');
export const childSchema = z.object({
  name: z.string({ error: 'نام الزامی است.' }).trim().min(1, 'نام الزامی است.').max(30, 'نام خیلی بلند است.'),
  age: z.number({ error: 'سن معتبر نیست.' }).int('سن معتبر نیست.').min(4, 'سن باید بین ۴ تا ۱۲ سال باشد.').max(12, 'سن باید بین ۴ تا ۱۲ سال باشد.'),
  avatar: z.string().refine(isAvatar, 'آواتار معتبر نیست.').optional(),
});
export const childUpdateSchema = childSchema.partial();

const trial = z.object({
  correct: z.boolean(),
  rtMs: z.number().min(0).max(120_000).nullable(),
  errors: z.number().int().min(0).max(60),
  attempts: z.number().int().min(0).max(300),
  tag: z.enum(['switch', 'repeat']).optional(),
});
export const resultSchema = z.object({
  sessionId: id,
  gameId: z.enum(GAME_IDS),
  level: z.number().int().min(1).max(10),
  seed: z.string().min(1).max(160),
  themeId: z.string().max(30).optional(),
  startedAt: z.string().max(40),
  durationMs: z.number().int().min(0).max(30 * 60_000),
  completed: z.boolean(),
  trials: z.array(trial).min(1, 'نتیجه معتبر نیست.').max(64),
});
export const startSchema = z.object({ gameId: z.enum(GAME_IDS) });
export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128), confirm: z.literal(true) });
