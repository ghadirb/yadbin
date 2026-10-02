import { notFound } from '../utils/http';
import { computeAge, DEFAULT_SKILLS, gradeByCode, gradeByOrder, inferGradeOrder, levelLabel, parseSkills, skillLabel } from '../education/catalog';

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
/** Effective grade ordinal: the structured value when set, else a best-effort reading of the old free-text grade. */
export const effectiveGradeOrder = (row: any): number | null => row.grade_order ?? inferGradeOrder(row.grade);
export const classDto = (c: any) => {
  const order = effectiveGradeOrder(c);
  return {
    id: c.id, name: c.name, grade: c.grade, schoolName: c.school_name, createdAt: c.created_at, archivedAt: c.archived_at ?? null, archived: !!c.archived_at,
    gradeCode: c.grade_code ?? null, gradeOrder: order, gradeLabel: gradeByCode(c.grade_code)?.label ?? c.grade,
    ageMin: c.age_min ?? null, ageMax: c.age_max ?? null, educationStage: c.education_stage ?? null,
  };
};
/** Student profile as shown to the owning teacher. Age is computed here, never stored. */
export const studentDto = (s: any, classGradeOrder: number | null = null) => {
  const { age, approximate } = computeAge(s);
  const own = s.grade_order ?? inferGradeOrder(s.grade);
  const order = own ?? classGradeOrder;
  return {
    id: s.id, name: s.display_name, age, ageApproximate: age !== null && approximate, birthDate: s.birth_date ?? null, birthYear: s.birth_year ?? null,
    gradeCode: s.grade_code ?? gradeByOrder(order)?.code ?? null, gradeOrder: order, gradeLabel: gradeByOrder(order)?.label ?? s.grade ?? null,
    gender: s.gender ?? null, note: s.teacher_note ?? null,
  };
};

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
    status: a.status, publishState: a.publish_state ?? (a.status === 'active' ? 'published' : a.status), lifecycle, lifecycleLabel: LIFECYCLE_LABELS_FA[lifecycle], archivedAt: a.archived_at ?? null,
    previewedAt: a.previewed_at ?? null, previewFeedback: a.preview_feedback ?? null, teacherApprovedAt: a.teacher_approved_at ?? null,
    createdAt: a.created_at, expiresAt: a.expires_at, assigned, completed,
    ageMin: a.age_min ?? null, ageMax: a.age_max ?? null,
    gradeMin: gradeByOrder(a.grade_min)?.code ?? null, gradeMax: gradeByOrder(a.grade_max)?.code ?? null,
    gradeMinLabel: gradeByOrder(a.grade_min)?.label ?? null, gradeMaxLabel: gradeByOrder(a.grade_max)?.label ?? null,
    level: a.activity_level ?? null, levelLabel: levelLabel(a.activity_level), templateId: a.template_id ?? null,
    skills: parseSkills(a.skills_json), effectiveSkills: parseSkills(a.skills_json) ?? DEFAULT_SKILLS[a.game_type] ?? [],
    skillLabels: (parseSkills(a.skills_json) ?? DEFAULT_SKILLS[a.game_type] ?? []).map(skillLabel),
    hasSuitabilityRange: a.age_min != null || a.age_max != null || a.grade_min != null || a.grade_max != null,
  };
};
