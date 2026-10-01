import { activityFit, GRADES, levelLabel, type Fit } from './catalog';
import { TEMPLATES, type Template } from './templates';
import type { GameAggregate, GameType, PerformanceStatus } from '../scoring';

/** Educational insights (v1.2 steps 4–5). Pure functions over the aggregates the report already computes.
 *  Everything here is a descriptive performance indicator for the teacher — never a diagnosis, never a ranking — and
 *  every sentence is built only from values that exist in the data. */

export const GAME_SKILL: Record<GameType, { skill: string; label: string; fa: string }> = {
  memory: { skill: 'memory', label: 'حافظه', fa: 'حافظه' },
  attention: { skill: 'attention', label: 'توجه', fa: 'توجه' },
  problem_solving: { skill: 'problem_solving', label: 'حل مسئله', fa: 'حل مسئله' },
};
export const SHORT_STATUS_FA: Record<PerformanceStatus, string> = { good: 'خوب', average: 'متوسط', needs_practice: 'نیاز به تمرین بیشتر', insufficient: 'داده کافی نیست' };
const toFa = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
export const GAMES: GameType[] = ['memory', 'attention', 'problem_solving'];

export const skillIndicators = (aggs: Partial<Record<GameType, GameAggregate>>) =>
  GAMES.map((g) => {
    const a = aggs[g]!;
    return { skill: GAME_SKILL[g].skill, label: GAME_SKILL[g].label, game: g, status: a.status, statusLabel: SHORT_STATUS_FA[a.status], sufficientData: a.sufficientData, sessionCount: a.sessionCount };
  });

/** «در ۵ فعالیت اخیر…» — only from the last 5 results; games with a single result are never summarised. */
export function recentSummary(aggs: Partial<Record<GameType, GameAggregate>>): { text: string; basedOn: number } {
  const events = GAMES.flatMap((g) => (aggs[g]?.series ?? []).filter((s) => s.accuracy !== null).map((s) => ({ g, at: s.createdAt, acc: s.accuracy as number })))
    .sort((a, b) => a.at.localeCompare(b.at)).slice(-5);
  const by = (g: GameType) => events.filter((e) => e.g === g).map((e) => e.acc);
  const stable: string[] = [], varying: string[] = [], single: string[] = [];
  for (const g of GAMES) {
    const xs = by(g);
    if (xs.length === 1) single.push(GAME_SKILL[g].fa);
    else if (xs.length >= 2) (Math.max(...xs) - Math.min(...xs) <= 0.15 ? stable : varying).push(GAME_SKILL[g].fa);
  }
  if (events.length < 2 || (!stable.length && !varying.length)) return { text: 'برای تهیه خلاصه‌ی عملکرد، فعالیت‌های بیشتری لازم است.', basedOn: events.length };
  const parts: string[] = [];
  if (stable.length) parts.push(`در فعالیت‌های مربوط به ${stable.join(' و ')} پایدار بوده`);
  if (varying.length) parts.push(`در فعالیت‌های مربوط به ${varying.join(' و ')} نوسان بیشتری داشته`);
  let text = `در ${toFa(events.length)} فعالیت اخیر، عملکرد دانش‌آموز ${parts.join(' و ')} است.`;
  if (single.length) text += ` برای ${single.join(' و ')} فقط یک فعالیت ثبت شده و هنوز جمع‌بندی ممکن نیست.`;
  return { text, basedOn: events.length };
}

const LEVEL_ORDER = ['introductory', 'basic', 'intermediate', 'advanced'] as const;
const levelIdx = (l: string) => LEVEL_ORDER.indexOf(l as (typeof LEVEL_ORDER)[number]);
/** Starting level suggested by grade only (unknown grade → basic). */
export const defaultLevelIdx = (gradeOrder: number | null) => (gradeOrder === null ? 1 : gradeOrder <= 2 ? 0 : gradeOrder <= 4 ? 1 : 2);

export interface RecommendationContext { gradeOrder: number | null; age: number | null; lastTemplateId?: string | null; lastGame?: GameType | null }
export interface Recommendation {
  rank: number; basis: 'needs_practice' | 'collect_data' | 'maintain' | 'step_up'; skill: string; skillLabel: string; gameType: GameType;
  level: string; levelLabel: string; difficultyMode: string; templateId: string | null; templateTitle: string | null;
  fit: Fit; text: string; reason: string; prefill: Record<string, unknown>;
}
const BASIS_PRIORITY = { needs_practice: 1, collect_data: 2, maintain: 3, step_up: 4 } as const;

/** Suggestions for the NEXT activity. Nothing is created: the teacher reviews, edits and approves every one of them. */
export function recommendActivities(aggs: Partial<Record<GameType, GameAggregate>>, ctx: RecommendationContext): Recommendation[] {
  const base = defaultLevelIdx(ctx.gradeOrder);
  const recs = GAMES.map((g) => {
    const a = aggs[g]!;
    const s = a.status;
    const basis: Recommendation['basis'] = s === 'needs_practice' ? 'needs_practice' : s === 'good' ? 'step_up' : s === 'average' ? 'maintain' : 'collect_data';
    const idx = Math.max(0, Math.min(3, basis === 'needs_practice' ? base - 1 : basis === 'step_up' ? base + 1 : base));
    const level = LEVEL_ORDER[idx];
    const tpl = pickTemplate(g, idx, ctx);
    const sk = GAME_SKILL[g];
    const reason = basis === 'needs_practice' ? `عملکرد مشاهده‌شده در فعالیت‌های ${sk.fa} نیاز به تمرین بیشتری دارد.`
      : basis === 'step_up' ? `عملکرد مشاهده‌شده در فعالیت‌های ${sk.fa} خوب بوده است؛ می‌توان سطح را کمی بالاتر برد.`
      : basis === 'maintain' ? `عملکرد مشاهده‌شده در فعالیت‌های ${sk.fa} متوسط بوده است؛ تمرین در همین سطح مناسب است.`
      : `برای ${sk.fa} هنوز داده‌ی کافی وجود ندارد؛ یک فعالیت دیگر تصویر روشن‌تری می‌دهد.`;
    return {
      rank: 0, basis, skill: sk.skill, skillLabel: sk.label, gameType: g, level, levelLabel: levelLabel(level)!, difficultyMode: tpl?.t.difficultyMode ?? (['easy', 'easy', 'medium', 'hard'][idx]),
      templateId: tpl?.t.id ?? null, templateTitle: tpl?.t.title ?? null, fit: tpl?.fit ?? 'unrestricted' as Fit,
      text: `برای فعالیت بعدی، تمرین ${sk.label} با سطح ${levelLabel(level)} پیشنهاد می‌شود.`, reason,
      prefill: tpl ? { templateId: tpl.t.id, level, skills: tpl.t.skills } : { gameType: g, level, skills: [sk.skill] },
      _last: ctx.lastGame === g ? 1 : 0, _n: a.sessionCount,
    };
  });
  recs.sort((x, y) => BASIS_PRIORITY[x.basis] - BASIS_PRIORITY[y.basis] || x._last - y._last || x._n - y._n);
  return recs.map(({ _last, _n, ...r }, i) => ({ ...r, rank: i + 1 }));
}

function pickTemplate(g: GameType, wantIdx: number, ctx: RecommendationContext): { t: Template; fit: Fit } | null {
  const grade = (code: string) => GRADES.find((x) => x.code === code)?.order ?? null;
  const scored = TEMPLATES.filter((t) => t.gameType === g).map((t) => {
    const f = activityFit({ ageMin: t.ageMin, ageMax: t.ageMax, gradeMin: grade(t.gradeMin), gradeMax: grade(t.gradeMax) }, { age: ctx.age, gradeOrder: ctx.gradeOrder });
    return { t, fit: f.fit, dist: Math.abs(levelIdx(t.level) - wantIdx), out: f.fit === 'out_of_range' ? 1 : 0, repeat: t.id === ctx.lastTemplateId ? 1 : 0 };
  });
  scored.sort((a, b) => a.out - b.out || a.repeat - b.repeat || a.dist - b.dist);
  return scored[0] ? { t: scored[0].t, fit: scored[0].fit } : null;
}

export const RECOMMENDATION_NOTICE = 'این‌ها فقط پیشنهاد هستند؛ هیچ فعالیتی بدون ویرایش و تأیید معلم ساخته یا ارسال نمی‌شود.';
