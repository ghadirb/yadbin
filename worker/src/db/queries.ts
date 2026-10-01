import { notFound } from '../utils/http';

/** Ownership guards. Every teacher endpoint goes through these: a foreign id looks exactly like a missing one (404). */
export async function getOwnedClass(db: D1Database, teacherId: string, classId: string) {
  const row = await db.prepare('SELECT * FROM classes WHERE id = ? AND teacher_id = ?').bind(classId, teacherId).first<any>();
  if (!row) throw notFound('کلاس یافت نشد.');
  return row;
}
export async function getOwnedStudent(db: D1Database, teacherId: string, studentId: string) {
  const row = await db.prepare('SELECT * FROM students WHERE id = ? AND teacher_id = ?').bind(studentId, teacherId).first<any>();
  if (!row) throw notFound('دانش‌آموز یافت نشد.');
  return row;
}
export async function getOwnedActivity(db: D1Database, teacherId: string, activityId: string) {
  const row = await db.prepare('SELECT * FROM activities WHERE id = ? AND teacher_id = ?').bind(activityId, teacherId).first<any>();
  if (!row) throw notFound('فعالیت یافت نشد.');
  return row;
}
export const classDto = (c: any) => ({ id: c.id, name: c.name, grade: c.grade, schoolName: c.school_name, createdAt: c.created_at, archivedAt: c.archived_at ?? null, archived: !!c.archived_at });

export const GAME_NAMES_FA: Record<string, string> = { memory: 'به خاطر بسپار', attention: 'پیداش کن', problem_solving: 'راهش را پیدا کن' };

/**
 * Lifecycle shown to the teacher (spec 2.3). `status` (active|canceled) stays untouched for old clients;
 * `lifecycle` is derived: archived > ended (canceled, expired, or everyone finished) > active.
 */
export type Lifecycle = 'active' | 'ended' | 'archived';
export function activityLifecycle(a: any, assigned = 0, completed = 0, now = new Date().toISOString()): Lifecycle {
  if (a.archived_at) return 'archived';
  if (a.status === 'canceled') return 'ended';
  if (a.expires_at && a.expires_at < now) return 'ended';
  if (assigned > 0 && completed >= assigned) return 'ended';
  return 'active';
}
export const LIFECYCLE_LABELS_FA: Record<Lifecycle, string> = { active: 'فعال', ended: 'پایان‌یافته', archived: 'آرشیوشده' };
export const activityDto = (a: any, assigned = 0, completed = 0) => {
  const lifecycle = activityLifecycle(a, assigned, completed);
  return {
    id: a.id, classId: a.class_id, gameType: a.game_type, difficultyMode: a.difficulty_mode, questionCount: a.question_count,
    title: a.title || GAME_NAMES_FA[a.game_type] || a.game_type, description: a.description ?? null, suggestedMinutes: a.suggested_minutes ?? null,
    status: a.status, lifecycle, lifecycleLabel: LIFECYCLE_LABELS_FA[lifecycle], archivedAt: a.archived_at ?? null,
    createdAt: a.created_at, expiresAt: a.expires_at, assigned, completed,
  };
};
