/** Education catalog (v1.2): grades, activity levels, skills, age calculation and the activity↔student fit check.
 *  Pure functions, no I/O — easy to test and shared by every route. Grades are data, not an enum, so the list can grow. */

export interface Grade { code: string; order: number; label: string; stage: string }
const STAGE_FA: Record<string, string> = { preschool: 'پیش‌دبستانی', primary: 'ابتدایی', lower_secondary: 'متوسطه اول', upper_secondary: 'متوسطه دوم' };
const ORD = ['اول', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم'];
export const GRADES: Grade[] = [
  { code: 'preschool', order: 0, label: 'پیش‌دبستانی', stage: 'preschool' },
  ...ORD.map((o, i) => ({ code: `g${i + 1}`, order: i + 1, label: `${o} ابتدایی`, stage: 'primary' })),
  { code: 'g7', order: 7, label: 'هفتم', stage: 'lower_secondary' },
  { code: 'g8', order: 8, label: 'هشتم', stage: 'lower_secondary' },
  { code: 'g9', order: 9, label: 'نهم', stage: 'lower_secondary' },
  { code: 'g10', order: 10, label: 'دهم', stage: 'upper_secondary' },
  { code: 'g11', order: 11, label: 'یازدهم', stage: 'upper_secondary' },
  { code: 'g12', order: 12, label: 'دوازدهم', stage: 'upper_secondary' },
];
export const STAGES = Object.entries(STAGE_FA).map(([code, label]) => ({ code, label }));
export const gradeByCode = (code?: string | null) => (code ? GRADES.find((g) => g.code === code) ?? null : null);
export const gradeByOrder = (order?: number | null) => (order === null || order === undefined ? null : GRADES.find((g) => g.order === order) ?? null);
export const isGradeCode = (c: string) => !!gradeByCode(c);

/** Best-effort reading of old free-text grades ("ششم", "پنجم ابتدایی", "۴") so v1.0/v1.1 classes still get a fit check. */
export function inferGradeOrder(text?: string | null): number | null {
  if (!text) return null;
  const t = text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  if (t.includes('پیش')) return 0;
  const words: [string, number][] = [['دوازدهم', 12], ['یازدهم', 11], ['دهم', 10], ['نهم', 9], ['هشتم', 8], ['هفتم', 7], ['ششم', 6], ['پنجم', 5], ['چهارم', 4], ['سوم', 3], ['دوم', 2], ['اول', 1]];
  for (const [w, n] of words) if (t.includes(w)) return n;
  const m = t.match(/\b(1[0-2]|[1-9])\b/);
  return m ? Number(m[1]) : null;
}

export const LEVELS = [
  { code: 'introductory', label: 'مقدماتی', order: 1 }, { code: 'basic', label: 'پایه', order: 2 },
  { code: 'intermediate', label: 'متوسط', order: 3 }, { code: 'advanced', label: 'پیشرفته', order: 4 },
] as const;
export const LEVEL_CODES = LEVELS.map((l) => l.code) as unknown as [string, ...string[]];
export const levelLabel = (c?: string | null) => LEVELS.find((l) => l.code === c)?.label ?? null;

export const SKILLS = [
  { code: 'memory', label: 'حافظه' }, { code: 'attention', label: 'توجه' }, { code: 'focus', label: 'تمرکز' },
  { code: 'reaction_speed', label: 'سرعت واکنش' }, { code: 'response_control', label: 'کنترل پاسخ' },
  { code: 'problem_solving', label: 'حل مسئله' }, { code: 'pattern_recognition', label: 'تشخیص الگو' },
  { code: 'decision_making', label: 'تصمیم‌گیری' }, { code: 'visual_accuracy', label: 'دقت دیداری' },
] as const;
export const SKILL_CODES = SKILLS.map((s) => s.code) as unknown as [string, ...string[]];
export const skillLabel = (c: string) => SKILLS.find((s) => s.code === c)?.label ?? c;
/** Which core game metric each skill is judged from (used by profile / recommendations). */
export const GAME_FOR_SKILL: Record<string, string> = { memory: 'memory', attention: 'attention', focus: 'attention', reaction_speed: 'attention', response_control: 'attention', visual_accuracy: 'attention', problem_solving: 'problem_solving', pattern_recognition: 'problem_solving', decision_making: 'problem_solving' };
export const DEFAULT_SKILLS: Record<string, string[]> = { memory: ['memory'], attention: ['attention'], problem_solving: ['problem_solving'] };

export function parseSkills(json?: string | null): string[] | null {
  if (!json) return null;
  try { const a = JSON.parse(json); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : null; } catch { return null; }
}

/** Age in whole years, computed (never stored). `approximate` = only the birth year is known. */
export function computeAge(s: { birth_date?: string | null; birth_year?: number | null }, now = new Date()): { age: number | null; approximate: boolean } {
  if (s.birth_date) {
    const d = new Date(s.birth_date + 'T00:00:00Z');
    if (!isNaN(d.getTime())) {
      let age = now.getUTCFullYear() - d.getUTCFullYear();
      const before = now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate());
      if (before) age--;
      return { age: age >= 0 ? age : null, approximate: false };
    }
  }
  if (s.birth_year) { const age = now.getUTCFullYear() - s.birth_year; return { age: age >= 0 ? age : null, approximate: true }; }
  return { age: null, approximate: false };
}

/** Jalali years (1300–1500) are accepted wherever a birth year is; converted to the Gregorian year the person was born in (approx.). */
export function normalizeBirthYear(y: number): number { return y >= 1300 && y <= 1500 ? y + 621 : y; }

export type Fit = 'suitable' | 'easier_possible' | 'out_of_range' | 'unrestricted' | 'unknown';
export const FIT_LABELS: Record<Fit, string> = {
  suitable: 'مناسب', easier_possible: 'قابل استفاده با سطح ساده‌تر', out_of_range: 'خارج از محدوده پیشنهادی',
  unrestricted: 'بدون محدوده سنی/پایه', unknown: 'اطلاعات سن/پایه دانش‌آموز ثبت نشده',
};
export interface FitRange { ageMin?: number | null; ageMax?: number | null; gradeMin?: number | null; gradeMax?: number | null }
export interface FitStudent { age: number | null; gradeOrder: number | null }

/** Guidance only — the teacher always has the final say. Rule per dimension (grade / age):
 *  inside the range → suitable; 1 step below → usable with an easier level; further below → out of range;
 *  up to 2 steps above → still suitable; more than 2 above → out of range (far too easy). The worst dimension wins. */
export function activityFit(r: FitRange, s: FitStudent): { fit: Fit; label: string; reasons: string[] } {
  const hasGrade = r.gradeMin != null || r.gradeMax != null, hasAge = r.ageMin != null || r.ageMax != null;
  if (!hasGrade && !hasAge) return { fit: 'unrestricted', label: FIT_LABELS.unrestricted, reasons: [] };
  const rank: Record<string, number> = { ok: 0, easier: 1, out: 2 };
  let worst = 'ok'; let known = 0; const reasons: string[] = [];
  const check = (v: number | null, lo: number | null | undefined, hi: number | null | undefined, name: string, unit: string) => {
    if (lo == null && hi == null) return;
    if (v == null) return;
    known++;
    let st = 'ok';
    if (lo != null && v < lo) { st = lo - v <= 1 ? 'easier' : 'out'; reasons.push(st === 'easier' ? `${name} کمی پایین‌تر از محدوده است؛ سطح ساده‌تر پیشنهاد می‌شود.` : `${name} پایین‌تر از محدوده پیشنهادی فعالیت است.`); }
    else if (hi != null && v > hi + 2) { st = 'out'; reasons.push(`${name} بالاتر از محدوده پیشنهادی است (فعالیت برای ${unit} پایین‌تر طراحی شده).`); }
    if (rank[st] > rank[worst]) worst = st;
  };
  check(s.gradeOrder, r.gradeMin, r.gradeMax, 'پایه', 'پایه‌های');
  check(s.age, r.ageMin, r.ageMax, 'سن', 'سنین');
  if (!known) return { fit: 'unknown', label: FIT_LABELS.unknown, reasons: [] };
  const fit: Fit = worst === 'ok' ? 'suitable' : worst === 'easier' ? 'easier_possible' : 'out_of_range';
  return { fit, label: FIT_LABELS[fit], reasons };
}

export const catalogDto = () => ({
  grades: GRADES, stages: STAGES, levels: LEVELS, skills: SKILLS,
  ageRange: { min: 3, max: 25 }, fits: (Object.keys(FIT_LABELS) as Fit[]).map((code) => ({ code, label: FIT_LABELS[code] })),
});
