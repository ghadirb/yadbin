import type { KidsConfig } from './config';
import { DEFAULT_KIDS_CONFIG } from './config';
import { SKILL_META } from './content';
import { ARROW, LABEL_FA, TREND_FA, activityStats, computeSkillGrowth, recommend, type Recommendation, type SessionSummary, type SignalRecord, type SkillGrowth } from './growth';
import type { Skill } from './types';

/** Wording we must never produce anywhere in the product (spec §3, §18, §32). Used by tests over every generated string. */
export const BANNED_TERMS = ['ADHD', 'IQ', 'اختلال', 'تشخیص', 'نابغه', 'ضعیف', 'آزمون', 'ارزیابی', 'تست', 'نمرهٔ هوش', 'هوش‌بهر', 'مشکل', 'نمره'];
export const findBanned = (text: string) => BANNED_TERMS.filter((t) => text.includes(t));

export const DISCLAIMER = 'این گزارش فقط «عملکرد مشاهده‌شده در بازی‌ها» را نشان می‌دهد. یادبین کودک ابزار بازی و تمرین مهارت‌های شناختی است و جایگزین نظر متخصص نیست.';
const fa = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
const names = (xs: Skill[]) => xs.map((s) => SKILL_META[s].name).join(' و ');

export interface ReportLine { skill: Skill; name: string; emoji: string; arrow: string; trend: string; label: string }
export interface ParentReport {
  period: 'week' | 'month'; title: string; playMinutes: number; games: number; activeDays: number;
  lines: ReportLine[]; summary: string; strengths: Skill[]; needsPractice: Skill[]; mostGrowth: Skill | null; bestSkill: Skill | null;
  recommendations: Recommendation[]; disclaimer: string; enoughData: boolean;
}

/**
 * Builds the weekly / monthly parent report. Rule-based and deterministic (no AI). It describes observed play only — it never
 * diagnoses, labels, compares with other children, or predicts.
 */
export function buildReport(period: 'week' | 'month', allSignals: SignalRecord[], periodSessions: SessionSummary[], cfg: KidsConfig = DEFAULT_KIDS_CONFIG): ParentReport {
  const growth = computeSkillGrowth(allSignals, cfg);
  const stats = activityStats(periodSessions);
  const measured = growth.filter((g) => g.score !== null);
  const enoughData = stats.games >= 3 && measured.length > 0;
  const lines: ReportLine[] = growth.filter((g) => g.skill !== 'learning' || g.samples > 0).map((g) => ({ skill: g.skill, name: SKILL_META[g.skill].name, emoji: SKILL_META[g.skill].emoji, arrow: ARROW[g.trend === 'insufficient' ? 'insufficient' : g.trend], trend: TREND_FA[g.trend], label: LABEL_FA[g.label] }));
  const up = growth.filter((g) => g.trend === 'up').map((g) => g.skill);
  const down = growth.filter((g) => g.trend === 'down').map((g) => g.skill);
  const strengths = measured.filter((g) => g.score! >= 65 && g.trend !== 'down').sort((a, b) => b.score! - a.score!).slice(0, 3).map((g) => g.skill);
  const needsPractice = measured.filter((g) => g.score! < 65 || g.trend === 'down').sort((a, b) => a.score! - b.score!).slice(0, 2).map((g) => g.skill);
  const bestSkill = measured.length ? [...measured].sort((a, b) => b.score! - a.score!)[0].skill : null;
  const mostGrowth = growthLeader(allSignals, growth);
  const when = period === 'week' ? 'این هفته' : 'این ماه';
  let summary: string;
  if (!enoughData) summary = `${when} هنوز تعداد بازی‌ها برای یک گزارش دقیق کافی نیست. با چند بازی دیگر، روند رشد روشن‌تر می‌شود.`;
  else if (up.length) summary = `${when} کودک در بازی‌های ${names(up.slice(0, 3))} پیشرفت بیشتری نشان داده است.`;
  else if (down.length === 0) summary = `${when} عملکرد کودک در بازی‌ها پایدار بوده است.`;
  else summary = `${when} عملکرد کودک در بیشتر بازی‌ها پایدار بوده و در بازی‌های ${names(down.slice(0, 2))} تمرین بیشتری می‌تواند کمک کند.`;
  if (period === 'month' && enoughData) summary += ` در این ماه ${fa(stats.games)} بازی در ${fa(stats.activeDays)} روز انجام شده است.`;
  return { period, title: period === 'week' ? 'گزارش رشد این هفته' : 'گزارش رشد این ماه', playMinutes: stats.minutes, games: stats.games, activeDays: stats.activeDays, lines, summary, strengths, needsPractice, mostGrowth, bestSkill, recommendations: enoughData ? recommend(growth, cfg) : [], disclaimer: DISCLAIMER, enoughData };
}

/** Skill with the largest rise between its earlier and later half of signals (needs ≥4 signals). */
function growthLeader(signals: SignalRecord[], growth: SkillGrowth[]): Skill | null {
  let best: { skill: Skill; d: number } | null = null;
  for (const g of growth) {
    if (g.trend !== 'up') continue;
    const v = signals.filter((s) => s.skill === g.skill).sort((a, b) => a.at.localeCompare(b.at)).map((s) => s.value);
    const k = Math.floor(v.length / 2); if (k < 2) continue;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const d = avg(v.slice(-k)) - avg(v.slice(0, k));
    if (!best || d > best.d) best = { skill: g.skill, d };
  }
  return best?.skill ?? null;
}
