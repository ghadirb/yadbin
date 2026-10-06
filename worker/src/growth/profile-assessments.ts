import { buildAssessmentGrowth, classifyTrend } from './compute';
import { loadAssessmentResults } from './service';

const toFa = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const DIR_FA: Record<string, string> = { up: 'روند افزایشی', stable: 'تقریباً ثابت', fluctuating: 'نوسانی', down: 'روند کاهشی' };

export interface ProfileAssessments {
  count: number; average: number | null; last: number | null; lastAt: string | null;
  subjects: { subject: string; count: number; average: number; last: number; trend: string }[];
  text: string;
}

/**
 * Teacher assessments (manual + from sources) of ONE student, summarised for the profile analysis under the student's name.
 * Real completed results only; the cognitive skill indicators (memory/attention/problem solving) are never touched by exam scores.
 */
export async function buildProfileAssessments(db: D1Database, teacherId: string, studentId: string): Promise<ProfileAssessments> {
  const rows = await loadAssessmentResults(db, teacherId, studentId, null);
  const g = buildAssessmentGrowth(rows);
  const lastAt = rows.length ? rows.reduce((m, r) => (r.at > m ? r.at : m), rows[0].at) : null;
  const subjects = g.subjects.map((s) => ({ subject: s.subject, count: s.count, average: s.average, last: s.last, trend: DIR_FA[classifyTrend(s.exams.map((e) => e.percent / 100)).direction] ?? 'داده کافی نیست' }));
  let text: string;
  if (!rows.length) text = 'هنوز آزمون معلمِ انجام‌شده‌ای برای این دانش‌آموز ثبت نشده است.';
  else {
    text = `در ${toFa(rows.length)} آزمون معلم، میانگین نمرهٔ دانش‌آموز ${toFa(g.average ?? 0)}٪ و نمرهٔ آخرین آزمون ${toFa(g.last ?? 0)}٪ بوده است.`;
    const withTrend = subjects.filter((s) => s.count >= 3 && s.trend !== 'داده کافی نیست');
    if (withTrend.length) text += ' ' + withTrend.map((s) => `در درس «${s.subject}» ${s.trend}`).join('؛ ') + ' ثبت شده است.';
  }
  return { count: rows.length, average: g.average, last: g.last, lastAt, subjects, text };
}
