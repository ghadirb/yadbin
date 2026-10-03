import type { Env } from '../env';
import { activityDto, GAME_NAMES_FA } from '../db/queries';
import { gradeByOrder, inferGradeOrder } from '../education/catalog';
import { tuningFor, tuningForV2 } from '../education/tuning';

export const DIFFICULTY_LABELS_FA: Record<string, string> = { adaptive: 'تطبیقی', easy: 'آسان', medium: 'متوسط', hard: 'سخت' };
/** Preview links stop working after this time (a preview is a short, teacher-side check). */
export const PREVIEW_TTL_MS = 24 * 3600_000;

/** Same inputs a real student gets (grade → age → activity range, then the activity level), but with no student:
 *  the CLASS grade stands in for the student's grade, so the preview plays with the parameters a typical student of the class receives. */
export async function previewTuning(env: Env, activityId: string, genVersion: number) {
  const r = await env.DB.prepare(
    `SELECT a.activity_level AS lvl, a.grade_min AS gmin, a.grade_max AS gmax, a.age_min, a.age_max, c.grade AS cgrade, c.grade_order AS corder
       FROM activities a JOIN classes c ON c.id = a.class_id WHERE a.id = ?`,
  ).bind(activityId).first<any>();
  if (!r) return 0;
  const gradeOrder = r.corder ?? inferGradeOrder(r.cgrade) ?? null;
  const age = r.age_min != null && r.age_max != null ? Math.round((r.age_min + r.age_max) / 2) : null;
  return (genVersion >= 2 ? tuningForV2 : tuningFor)({ gradeOrder: gradeByOrder(gradeOrder) ? gradeOrder : null, age, level: r.lvl, gradeMin: r.gmin, gradeMax: r.gmax });
}

const PER_ITEM_MINUTES: Record<string, number> = { memory: 0.5, attention: 0.4, problem_solving: 0.7 };
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const fa = (n: number) => String(n).replace(/\d/g, (d) => FA_DIGITS[+d]);

/** What the teacher sees BEFORE starting a preview (spec §9). `a` = the activities row, `cls` = the class row. */
export function previewSummary(a: any, cls: any, compareMode: string | null = null) {
  const d = activityDto(a, 0, 0);
  const gradeLabel = d.gradeMinLabel && d.gradeMaxLabel ? (d.gradeMin === d.gradeMax ? d.gradeMinLabel : `${d.gradeMinLabel} تا ${d.gradeMaxLabel}`) : (gradeByOrder(cls?.grade_order ?? inferGradeOrder(cls?.grade))?.label ?? cls?.grade ?? null);
  const ageLabel = a.age_min != null && a.age_max != null ? `${fa(a.age_min)} تا ${fa(a.age_max)} سال` : a.age_min != null ? `از ${fa(a.age_min)} سال` : a.age_max != null ? `تا ${fa(a.age_max)} سال` : null;
  const mode = compareMode ?? a.difficulty_mode;
  const estimated = Math.max(1, Math.ceil(a.question_count * (PER_ITEM_MINUTES[a.game_type] ?? 0.6)));
  return {
    gameType: a.game_type, gameName: GAME_NAMES_FA[a.game_type] ?? a.game_type,
    gradeLabel, ageLabel, skillLabels: d.skillLabels, levelLabel: d.levelLabel,
    difficultyMode: mode, difficultyLabel: DIFFICULTY_LABELS_FA[mode] ?? mode,
    questionCount: a.question_count, suggestedMinutes: a.suggested_minutes ?? null, estimatedMinutes: a.suggested_minutes ?? estimated,
    comparison: !!compareMode,
    // Deliberately neutral: the system never claims that a level "is suitable" for a child.
    note: compareMode ? 'این اجرا فقط برای مقایسهٔ تجربهٔ سطح‌هاست و تنظیمات فعالیت را تغییر نمی‌دهد.' : 'این اجرا فقط برای آزمایش شماست و در گزارش دانش‌آموزان ثبت نمی‌شود.',
  };
}
