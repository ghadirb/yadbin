import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_NOTICE, buildAiFacts, buildAnalysis, buildAssessmentGrowth, buildOverview, buildSkills, buildTimeline, chooseBucket, classifyTrend, edgeMeans,
  localDay, localWeekStart, MSG_ANALYSIS_NOT_ENOUGH, pointsPhrase, rangeWindow, startVsCurrent, validateAiText, weightedAccuracy, type AiFacts, type CogResult,
} from '../src/growth/compute';

const DAY = 86_400_000;
const base = Date.parse('2026-09-01T08:00:00Z');
const at = (d: number) => new Date(base + d * DAY).toISOString();
let seq = 0;
const res = (d: number, accuracy: number, game: CogResult['game'] = 'memory', samples = 10, avgResponseMs: number | null = 2000): CogResult =>
  ({ at: at(d), accuracy, samples, avgResponseMs, difficulty: 1, game, activityId: `a${++seq}`, title: 'فعالیت', level: 'basic' });

describe('trend classification (n<3 → insufficient; no interpolation)', () => {
  it('0, 1 and 2 results are insufficient', () => {
    for (const s of [[], [0.5], [0.4, 0.9]]) expect(classifyTrend(s)).toMatchObject({ direction: 'insufficient', label: 'داده کافی نیست', change: null });
  });
  it('real growth, real decline, flat, fluctuating', () => {
    expect(classifyTrend([0.5, 0.6, 0.7, 0.8, 0.9]).direction).toBe('up');
    expect(classifyTrend([0.9, 0.8, 0.7, 0.6]).direction).toBe('down');
    expect(classifyTrend([0.7, 0.71, 0.69, 0.7, 0.7]).direction).toBe('stable');
    expect(classifyTrend([0.9, 0.3, 0.9, 0.3, 0.9, 0.3]).direction).toBe('fluctuating');
  });
  it('a noisy but clearly rising series is still «رو به رشد»; a small rise within small noise is too', () => {
    expect(classifyTrend([0.3, 0.45, 0.4, 0.6, 0.65, 0.8, 0.85]).direction).toBe('up');
    expect(classifyTrend([0.7, 0.72, 0.75]).direction).toBe('up');
  });
  it('a tiny drift below 5 points is «تقریباً ثابت»', () => {
    expect(classifyTrend([0.7, 0.71, 0.72]).direction).toBe('stable');
  });
});

describe('start vs current is in percentage points', () => {
  it('3 results compare first vs last; 4–5 use 2+2; ≥6 use 3+3 (ends never overlap)', () => {
    const it_ = (xs: number[]) => xs.map((v) => ({ v, w: 10 }));
    expect(edgeMeans(it_([0.5, 0.6, 0.7]))).toMatchObject({ k: 1 });
    expect(edgeMeans(it_([0.5, 0.6, 0.7, 0.8]))).toMatchObject({ k: 2 });
    expect(edgeMeans(it_([0.5, 0.5, 0.5, 0.9, 0.9, 0.9]))).toMatchObject({ k: 3 });
    expect(startVsCurrent(it_([0.62, 0.7, 0.78]))).toEqual({ startPercent: 62, currentPercent: 78, changePoints: 16, window: 1 });
    expect(startVsCurrent(it_([0.5, 0.6]))).toBeNull();
  });
  it('uses the sample weights', () => {
    const sc = startVsCurrent([{ v: 0.2, w: 10 }, { v: 0.5, w: 10 }, { v: 1, w: 30 }])!;
    expect(sc.startPercent).toBe(20); expect(sc.currentPercent).toBe(100);
  });
  it('wording says «واحد درصد», never a bare percent; tiny changes are «تقریباً بدون تغییر»', () => {
    expect(pointsPhrase(16)).toBe('۱۶ واحد درصد افزایش');
    expect(pointsPhrase(-4.5)).toBe('۴٫۵ واحد درصد کاهش');
    expect(pointsPhrase(0.2)).toBe('تقریباً بدون تغییر');
  });
});

describe('dates: Iranian local time, Saturday-based weeks', () => {
  it('a result at 21:00 UTC already belongs to the next Tehran day', () => {
    expect(localDay('2026-03-20T21:00:00Z')).toBe('2026-03-21');
    expect(localDay('2026-03-20T10:00:00Z')).toBe('2026-03-20');
  });
  it('weeks start on Saturday', () => {
    // 2026-09-05 is a Saturday; Sunday–Friday after it belong to that week; the previous Friday belongs to the previous week.
    expect(localWeekStart('2026-09-05T08:00:00Z')).toBe('2026-09-05');
    expect(localWeekStart('2026-09-11T08:00:00Z')).toBe('2026-09-05');
    expect(localWeekStart('2026-09-04T08:00:00Z')).toBe('2026-08-29');
  });
  it('windows: current = last N days, previous = the N days before; «all» has no previous window', () => {
    const w = rangeWindow('30d', new Date(base));
    expect(Date.parse(w.to) - Date.parse(w.from!)).toBe(30 * DAY);
    expect(w.previousTo).toBe(w.from); expect(Date.parse(w.from!) - Date.parse(w.previousFrom!)).toBe(30 * DAY);
    expect(rangeWindow('all', new Date(base))).toMatchObject({ from: null, previousFrom: null, previousTo: null });
  });
  it('bucket choice is documented: ≤30d daily, 3/6 months weekly, whole period weekly then 4-week blocks beyond 60 weeks', () => {
    expect(chooseBucket('7d')).toBe('day'); expect(chooseBucket('30d')).toBe('day');
    expect(chooseBucket('3m')).toBe('week'); expect(chooseBucket('6m')).toBe('week');
    expect(chooseBucket('all', at(-100), at(0))).toBe('week');
    expect(chooseBucket('all', at(-500), at(0))).toBe('four_weeks');
  });
});

describe('timeline aggregation', () => {
  it('sample-weighted average per bucket; empty buckets are not created', () => {
    const rs = [res(0, 0.5, 'memory', 10), res(0, 1, 'memory', 30), res(5, 0.6), res(6, 0.7)];
    const pts = buildTimeline(rs, 'day');
    expect(pts.map((p) => p.bucketStart)).toEqual([localDay(at(0)), localDay(at(5)), localDay(at(6))]);   // days 1–4 are absent, not interpolated
    expect(pts[0]).toMatchObject({ percent: 87.5, results: 2, samples: 40 });
  });
  it('weekly buckets group several results and split games', () => {
    const rs = [res(0, 0.5, 'memory'), res(1, 0.7, 'attention'), res(2, 0.9, 'memory'), res(9, 0.8, 'memory')];
    const pts = buildTimeline(rs, 'week');
    expect(pts.length).toBe(2);
    const first = pts[0];
    expect(first.byGame.memory).toBeDefined(); expect(first.byGame.attention).toMatchObject({ percent: 70, results: 1 });
    expect(first.averageResponseSeconds).toBe(2);
  });
  it('4-week blocks are 28 days wide', () => {
    const pts = buildTimeline([res(0, 0.5), res(20, 0.6), res(35, 0.7), res(70, 0.8)], 'four_weeks');
    expect(pts.length).toBeGreaterThanOrEqual(3);
    expect(pts.every((p) => p.results >= 1)).toBe(true);
  });
});

describe('skills, overview, assessments', () => {
  it('only skills with real data are listed; each has start / current / change / trend', () => {
    const rs = [res(0, 0.58), res(3, 0.65), res(6, 0.76), res(1, 0.65, 'attention'), res(4, 0.7, 'attention')];
    const sk = buildSkills(rs);
    expect(sk.map((s) => s.game)).toEqual(['memory', 'attention']);       // problem solving has no data → omitted
    expect(sk[0]).toMatchObject({ skill: 'حافظه', start: 58, current: 76, changePoints: 18, sufficient: true });
    expect(sk[0].changeLabel).toBe('۱۸ واحد درصد افزایش');
    expect(sk[1]).toMatchObject({ sufficient: false, start: null, current: null, changePoints: null, trend: { direction: 'insufficient' } });
  });
  it('response time first vs last (seconds), only with ≥3 timed results', () => {
    const sk = buildSkills([res(0, 0.6, 'memory', 10, 4000), res(2, 0.7, 'memory', 10, 3000), res(4, 0.8, 'memory', 10, 2000)])[0];
    expect(sk.responseTime).toEqual({ startSeconds: 4, currentSeconds: 2, changeSeconds: -2 });
  });
  it('overview: counts, active days, average withheld below 8 answers, change vs previous only when both periods have data', () => {
    const cur = [res(0, 0.8), res(0, 0.6), res(2, 0.9)];
    const prev = [res(-20, 0.5), res(-18, 0.5)];
    const o = buildOverview(cur, prev, 2, at(1));
    expect(o).toMatchObject({ activityCount: 3, assessmentCount: 2, activeDays: 2, lastPerformance: 90 });
    expect(o.cognitiveAverage).toBeCloseTo(76.7, 1);
    expect(o.changeVsPrevious).toMatchObject({ points: 26.7, previousAverage: 50 });
    expect(buildOverview([res(0, 0.8)], prev, 0, null).cognitiveAverage).toBe(80);                    // 10 answers ≥ 8 → the average is shown
    expect(buildOverview([res(0, 0.8, 'memory', 3)], prev, 0, null).cognitiveAverage).toBeNull();      // 3 answers < 8 → withheld
    expect(buildOverview(cur, [res(-20, 0.5)], 0, null).changeVsPrevious).toBeNull();                 // previous period too thin
    expect(buildOverview(cur, null, 0, null).changeNote).toContain('کل دوره');
  });
  it('assessments are grouped by subject, ordered by time, with their own trend; chart needs ≥3 results', () => {
    const rows = [
      { assessmentId: 'x1', title: 'ریاضی ۱', subject: 'ریاضی', at: at(0), percent: 65, total: 10 },
      { assessmentId: 'x2', title: 'علوم ۱', subject: 'علوم', at: at(1), percent: 70, total: 10 },
      { assessmentId: 'x3', title: 'ریاضی ۲', subject: 'ریاضی', at: at(5), percent: 72, total: 10 },
      { assessmentId: 'x4', title: 'ریاضی ۳', subject: 'ریاضی', at: at(9), percent: 81, total: 10 },
      { assessmentId: 'x5', title: 'بی‌درس', subject: null, at: at(10), percent: 50, total: 10 },
    ];
    const g = buildAssessmentGrowth(rows);
    expect(g).toMatchObject({ count: 5, last: 50, chartAvailable: true });
    const math = g.subjects.find((s) => s.subject === 'ریاضی')!;
    expect(math.exams.map((e) => e.percent)).toEqual([65, 72, 81]);
    expect(math).toMatchObject({ count: 3, first: 65, last: 81, changePoints: 16, trend: { direction: 'up' } });
    expect(g.subjects.find((s) => s.subject === 'علوم')).toMatchObject({ count: 1, changePoints: null, trend: { direction: 'insufficient' } });
    expect(g.subjects.some((s) => s.subject === 'بدون درس مشخص')).toBe(true);
    expect(buildAssessmentGrowth(rows.slice(0, 2))).toMatchObject({ chartAvailable: false, series: [] });
    expect(buildAssessmentGrowth([])).toMatchObject({ count: 0, average: null, message: expect.stringContaining('آزمون') });
  });
});

describe('analysis text is conservative and traceable', () => {
  const FORBIDDEN = ['اختلال', 'مشکل ذهنی', 'ضعف قطعی', 'بیش‌فعال', 'درمان', 'بهتر از بقیه'];
  const full = () => {
    const cur = [res(0, 0.5), res(2, 0.6), res(4, 0.7), res(6, 0.8), res(1, 0.9, 'attention'), res(3, 0.3, 'attention'), res(5, 0.9, 'attention'), res(7, 0.3, 'attention'), res(2, 0.8, 'problem_solving')];
    const skills = buildSkills(cur);
    const ass = buildAssessmentGrowth([
      { assessmentId: 'a', title: 't', subject: 'ریاضی', at: at(0), percent: 60, total: 10 }, { assessmentId: 'b', title: 't', subject: 'ریاضی', at: at(9), percent: 80, total: 10 },
    ]);
    return { skills, ass, overview: buildOverview(cur, [res(-3, 0.5), res(-2, 0.5)], ass.count, null) };
  };
  it('every statement has evidence and uses the approved vocabulary', () => {
    const { skills, ass, overview } = full();
    const a = buildAnalysis(skills, overview, ass);
    expect(a.sufficient).toBe(true);
    expect(a.statements.length).toBeGreaterThan(2);
    for (const s of a.statements) expect(s.evidence.length).toBeGreaterThan(0);
    expect(a.text).toContain('عملکرد ثبت‌شده'); expect(a.text).toContain('روند افزایشی'); expect(a.text).toContain('نوسان');
    expect(a.text).toContain('نمرهٔ ثبت‌شدهٔ آخرین آزمون نسبت به اولین آزمون بهبود'); expect(a.text).toContain('برای حل مسئله هنوز فعالیت کافی');
    for (const w of FORBIDDEN) expect(a.text).not.toContain(w);
    expect(a.notice).toBe(ANALYSIS_NOTICE);
  });
  it('not enough data → the fixed «فعالیت‌های بیشتری لازم است» message and no claims', () => {
    const skills = buildSkills([res(0, 0.5), res(1, 0.6)]);
    const a = buildAnalysis(skills, buildOverview([res(0, 0.5), res(1, 0.6)], [], 0, null), buildAssessmentGrowth([]));
    expect(a).toMatchObject({ sufficient: false, text: MSG_ANALYSIS_NOT_ENOUGH, statements: [] });
  });
});

describe('AI guard (hallucination / diagnosis prevention)', () => {
  const { skills, ass, overview } = (() => {
    const cur = [res(0, 0.58), res(3, 0.65), res(6, 0.76)];
    const ass = buildAssessmentGrowth([]);
    return { skills: buildSkills(cur), ass, overview: buildOverview(cur, [res(-3, 0.5), res(-2, 0.5)], 0, null) };
  })();
  const facts: AiFacts = buildAiFacts('30d', skills, overview, ass);
  it('facts are minimal and anonymous: no name, id, date or raw results', () => {
    const j = JSON.stringify(facts);
    expect(j).not.toMatch(/a\d+|20\d\d-\d\d|accuracy|activityId|name/);
    expect(Object.keys(facts).sort()).toEqual(['activity_count', 'assessment_changes', 'assessment_count', 'change_points', 'current_performance', 'previous_performance', 'range', 'range_label', 'skill_changes', 'trend']);
  });
  it('accepts a faithful summary (numbers taken from the facts, Persian or Latin digits)', () => {
    const ok = validateAiText(`در ${facts.range_label}، عملکرد ثبت‌شده در فعالیت‌های حافظه از ۵۸ به ۷۶ رسیده و ۱۸ واحد درصد افزایش داشته است.`, facts);
    expect(ok).toMatchObject({ ok: true });
  });
  it('rejects invented numbers', () => {
    expect(validateAiText('در فعالیت‌های حافظه، عملکرد ثبت‌شده ۴۲ واحد درصد افزایش داشته و روند افزایشی دیده می‌شود.', facts)).toMatchObject({ ok: false, reason: 'unknown_number' });
  });
  it('rejects diagnoses, causes, treatment and comparison with others', () => {
    for (const bad of [
      'دانش‌آموز اختلال حافظه دارد و عملکرد ثبت‌شده او کاهش یافته است.',
      'عملکرد ثبت‌شده در حافظه افزایش داشته است و به دلیل تمرین بیشتر بوده است.',
      'برای این دانش‌آموز درمان تخصصی توصیه می‌شود و عملکرد ثبت‌شده ثابت است.',
      'عملکرد ثبت‌شده او از بقیه دانش‌آموزان بالاتر است و روند افزایشی دارد.',
      'He has ADHD according to the recorded performance in the activities.',
    ]) expect(validateAiText(bad, facts)).toMatchObject({ ok: false });
  });
  it('rejects empty, JSON, markdown lists and overlong output; strips code fences', () => {
    expect(validateAiText('', facts)).toMatchObject({ ok: false, reason: 'empty' });
    expect(validateAiText('{"text":"عملکرد ثبت‌شده افزایش یافته است"}', facts)).toMatchObject({ ok: false, reason: 'format' });
    expect(validateAiText('- عملکرد ثبت‌شده در حافظه افزایش یافته است', facts)).toMatchObject({ ok: false, reason: 'format' });
    expect(validateAiText('عملکرد ثبت‌شده '.repeat(100), facts)).toMatchObject({ ok: false, reason: 'too_long' });
    expect(validateAiText('```\nعملکرد ثبت‌شده در فعالیت‌های حافظه روند افزایشی داشته است.\n```', facts)).toMatchObject({ ok: true });
  });
});

describe('weightedAccuracy', () => {
  it('matches the Reports weighting (samples as weights)', () => {
    expect(weightedAccuracy([res(0, 0.5, 'memory', 10), res(1, 1, 'memory', 30)])).toBeCloseTo(0.875, 5);
    expect(weightedAccuracy([])).toBeNull();
  });
});
