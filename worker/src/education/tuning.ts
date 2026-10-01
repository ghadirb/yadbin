
export type Tuning = -1 | 0 | 1;
export interface TuningInput { gradeOrder?: number | null; age?: number | null; level?: string | null; gradeMin?: number | null; gradeMax?: number | null }

/** Age/grade → game parameter band. 0 reproduces the v1.1 parameters exactly (so unknown grade/age = unchanged game).
 *  Grade wins over age; if the student's own data is missing, the middle of the activity's recommended grade range is used.
 *  The activity level then nudges the band one step (introductory: -1, advanced: +1). */
export function tuningFor(i: TuningInput): Tuning {
  let base = 0;
  let g = i.gradeOrder ?? null;
  if (g === null && i.gradeMin != null && i.gradeMax != null) g = Math.round((i.gradeMin + i.gradeMax) / 2);
  if (g !== null) base = g <= 2 ? -1 : g >= 6 ? 1 : 0;
  else if (i.age != null) base = i.age <= 7 ? -1 : i.age >= 12 ? 1 : 0;
  const shift = i.level === 'introductory' ? -1 : i.level === 'advanced' ? 1 : 0;
  return Math.max(-1, Math.min(1, base + shift)) as Tuning;
}
export const tuningFromRow = (v: number | null | undefined): Tuning => (v === -1 || v === 1 ? v : 0);
