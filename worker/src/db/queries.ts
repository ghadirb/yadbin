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
export const classDto = (c: any) => ({ id: c.id, name: c.name, grade: c.grade, schoolName: c.school_name, createdAt: c.created_at });
