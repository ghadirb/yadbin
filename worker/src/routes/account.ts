import { verifyPassword } from '../auth/password';
import type { Env } from '../env';
import { HttpError, json, readJson } from '../utils/http';
import { rateLimit } from '../utils/ratelimit';
import { parse } from '../validation/schemas';
import { z } from 'zod';

const deleteAccountSchema = z.object({
  password: z.string({ error: 'رمز عبور الزامی است.' }).min(1, 'رمز عبور الزامی است.').max(128, 'رمز عبور معتبر نیست.'),
  /** The app sends `confirm: true` only after the teacher ticked the confirmation; a second guard against an accidental call. */
  confirm: z.literal(true, { error: 'تأیید حذف الزامی است.' }),
});

/**
 * POST /account/delete — the teacher permanently deletes their own account and EVERYTHING under it:
 * classes, students, results, activities, assessments, book sources, subscription / payment rows and usage counters.
 *
 * Safety:
 *  - needs the current password (a stolen/left-open session alone cannot erase an account) + an explicit `confirm: true`;
 *  - 5 wrong attempts / hour per account;
 *  - one atomic D1 batch of explicit, ordered deletes (the same style as deleteStudent / deleteClass: no reliance on FK cascade);
 *  - nothing is kept: there is no soft-delete and no recovery. Student play links stop working immediately.
 * The app is expected to clear its local cache, photos and session after a 200.
 */
export async function deleteAccount(req: Request, env: Env, teacherId: string) {
  const { password } = parse(deleteAccountSchema, await readJson(req));
  const key = `delete-account:${teacherId}`;
  await rateLimit(env, key, 5, 3600);
  const t = await env.DB.prepare('SELECT id, phone, password_hash FROM teachers WHERE id = ?').bind(teacherId).first<{ id: string; phone: string; password_hash: string }>();
  if (!t) throw new HttpError(404, 'not_found', 'حساب پیدا نشد.'); // already deleted
  // 403 (not 401): the app treats any 401 on an authenticated call as «session expired» and logs the teacher out; a mistyped password must not.
  if (!(await verifyPassword(password, t.password_hash))) throw new HttpError(403, 'wrong_password', 'رمز عبور اشتباه است.');

  const D = env.DB;
  const asmt = `(SELECT id FROM assessments WHERE teacher_id = ?1)`;
  const asmtStudents = `(SELECT id FROM assessment_students WHERE assessment_id IN ${asmt})`;
  const attempts = `(SELECT id FROM assessment_attempts WHERE assessment_student_id IN ${asmtStudents})`;
  const acts = `(SELECT id FROM activities WHERE teacher_id = ?1)`;
  const actStudents = `(SELECT id FROM activity_students WHERE activity_id IN ${acts})`;
  const sessions = `(SELECT id FROM game_sessions WHERE activity_student_id IN ${actStudents})`;
  const mine = `(SELECT id FROM students WHERE teacher_id = ?1)`;
  const classes = `(SELECT id FROM classes WHERE teacher_id = ?1)`;
  const sources = `(SELECT id FROM content_sources WHERE teacher_id = ?1)`;

  await D.batch([
    // Teacher assessments (results -> answers -> attempts -> assignments -> previews -> questions -> assessments)
    D.prepare(`DELETE FROM assessment_results WHERE attempt_id IN ${attempts}`).bind(teacherId),
    D.prepare(`DELETE FROM assessment_answers WHERE attempt_id IN ${attempts}`).bind(teacherId),
    D.prepare(`DELETE FROM assessment_attempts WHERE assessment_student_id IN ${asmtStudents}`).bind(teacherId),
    D.prepare(`DELETE FROM assessment_students WHERE assessment_id IN ${asmt}`).bind(teacherId),
    D.prepare('DELETE FROM assessment_preview_sessions WHERE teacher_id = ?').bind(teacherId),
    D.prepare(`DELETE FROM assessment_questions WHERE assessment_id IN ${asmt}`).bind(teacherId),
    D.prepare('DELETE FROM assessments WHERE teacher_id = ?').bind(teacherId),
    // Game activities (results -> sessions -> assignments -> previews -> activities)
    D.prepare(`DELETE FROM game_results WHERE session_id IN ${sessions}`).bind(teacherId),
    D.prepare(`DELETE FROM game_sessions WHERE activity_student_id IN ${actStudents}`).bind(teacherId),
    D.prepare(`DELETE FROM activity_students WHERE activity_id IN ${acts}`).bind(teacherId),
    D.prepare('DELETE FROM teacher_preview_sessions WHERE teacher_id = ?').bind(teacherId),
    D.prepare('DELETE FROM activities WHERE teacher_id = ?').bind(teacherId),
    // Students and classes
    D.prepare(`DELETE FROM student_metrics WHERE student_id IN ${mine}`).bind(teacherId),
    D.prepare(`DELETE FROM class_students WHERE class_id IN ${classes}`).bind(teacherId),
    D.prepare('DELETE FROM students WHERE teacher_id = ?').bind(teacherId),
    D.prepare('DELETE FROM classes WHERE teacher_id = ?').bind(teacherId),
    // Book sources (only extracted text is ever stored)
    D.prepare(`DELETE FROM content_source_chunks WHERE source_id IN ${sources}`).bind(teacherId),
    D.prepare(`DELETE FROM content_source_sections WHERE source_id IN ${sources}`).bind(teacherId),
    D.prepare('DELETE FROM content_sources WHERE teacher_id = ?').bind(teacherId),
    // Subscription, payments (subscriptions reference payments), usage
    D.prepare('DELETE FROM subscriptions WHERE teacher_id = ?').bind(teacherId),
    D.prepare('DELETE FROM payments WHERE teacher_id = ?').bind(teacherId),
    D.prepare('DELETE FROM usage_counters WHERE teacher_id = ?').bind(teacherId),
    // Abuse counters that are keyed by this account's phone number
    D.prepare('DELETE FROM rate_limits WHERE key IN (?, ?, ?)').bind(`login:phone:${t.phone}`, `reset:phone:${t.phone}`, key),
    D.prepare('DELETE FROM teachers WHERE id = ?').bind(teacherId),
  ]);
  return json({ ok: true, deleted: true });
}
