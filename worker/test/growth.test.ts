import { beforeAll, describe, expect, it } from 'vitest';
import { createEnv, memoryEvents, publishForTest, registerTeacher, type TestEnv } from './helpers';
import { createGrowthSummary } from '../src/growth/ai';
import { MSG_ANALYSIS_NOT_ENOUGH, MSG_NOT_ENOUGH_ACTIVITIES, MSG_NOT_ENOUGH_RANGE } from '../src/growth/compute';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60_000);

const DAY = 86_400_000;
/** N days ago at 08:00 UTC (11:30 Tehran) so day buckets never straddle midnight. */
const ago = (d: number) => { const x = new Date(Date.now() - d * DAY); x.setUTCHours(8, 0, 0, 0); return x.toISOString(); };
let n = 0;
const uid = (p: string) => `${p}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

async function setup(name = 'دانش‌آموز نمونه') {
  const teacher = await registerTeacher(t);
  const cls = (await t.api('POST', '/api/classes', { name: 'کلاس رشد', gradeCode: 'g5' }, teacher.token)).data.class;
  const student = (await t.api('POST', '/api/students', { name, classId: cls.id }, teacher.token)).data.student;
  return { teacher, token: teacher.token, classId: cls.id as string, studentId: student.id as string, name };
}
type S = Awaited<ReturnType<typeof setup>>;

interface Seed { at: string; accuracy: number | null; samples?: number; avgMs?: number | null; game?: string; level?: string | null; publish?: string; sessionStatus?: string; astStatus?: string; title?: string }
/** One valid (or deliberately invalid) cognitive result with a controlled date. */
async function seedResult(s: S, o: Seed, studentId = s.studentId) {
  const act = uid('act'), ast = uid('ast'), ses = uid('ses');
  await t.db.batch([
    t.db.prepare(`INSERT INTO activities (id, teacher_id, class_id, game_type, difficulty_mode, question_count, status, created_at, publish_state, title, activity_level) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(act, s.teacher.id, s.classId, o.game ?? 'memory', 'medium', 10, 'active', o.at, o.publish ?? 'published', o.title ?? `فعالیت ${n}`, o.level === undefined ? 'basic' : o.level),
    t.db.prepare(`INSERT INTO activity_students (id, activity_id, student_id, token, status, started_at, completed_at) VALUES (?,?,?,?,?,?,?)`).bind(ast, act, studentId, uid('tok'), o.astStatus ?? 'completed', o.at, o.at),
    t.db.prepare(`INSERT INTO game_sessions (id, activity_student_id, game_type, started_at, completed_at, status) VALUES (?,?,?,?,?,?)`).bind(ses, ast, o.game ?? 'memory', o.at, o.at, o.sessionStatus ?? 'completed'),
    t.db.prepare(`INSERT INTO game_results (session_id, accuracy, average_response_time, difficulty_reached, hints_used, sample_count, raw_result_json, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(ses, o.accuracy, o.avgMs === undefined ? 2000 : o.avgMs, 2, 0, o.samples ?? 10,
        JSON.stringify({ computed: { game: o.game ?? 'memory', sampleCount: o.samples ?? 10, accuracy: o.accuracy, averageResponseTime: o.avgMs === undefined ? 2000 : o.avgMs, difficultyReached: 2, hintsUsed: 0, independenceScore: null, helpResponseScore: null, details: {} }, meta: { durationMs: 60000 } }), o.at),
  ]);
}

interface SeedA { at: string; percent: number; subject?: string | null; title?: string; status?: string; attemptStatus?: string }
async function seedAssessment(s: S, o: SeedA, studentId = s.studentId) {
  const a = uid('asm'), x = uid('asx'), att = uid('att');
  await t.db.batch([
    t.db.prepare(`INSERT INTO assessments (id, teacher_id, root_id, version, title, subject, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(a, s.teacher.id, a, 1, o.title ?? 'آزمون', o.subject === undefined ? 'ریاضی' : o.subject, o.status ?? 'published', o.at, o.at),
    t.db.prepare(`INSERT INTO assessment_students (id, assessment_id, student_id, class_id, token, status, assigned_at, completed_at) VALUES (?,?,?,?,?,?,?,?)`).bind(x, a, studentId, s.classId, uid('atk'), 'completed', o.at, o.at),
    t.db.prepare(`INSERT INTO assessment_attempts (id, assessment_student_id, assessment_id, assessment_version, started_at, completed_at, status) VALUES (?,?,?,?,?,?,?)`).bind(att, x, a, 1, o.at, o.at, o.attemptStatus ?? 'completed'),
    t.db.prepare(`INSERT INTO assessment_results (attempt_id, total, correct, unanswered, percent, duration_ms, created_at) VALUES (?,?,?,?,?,?,?)`).bind(att, 10, Math.round(o.percent / 10), 0, o.percent, 60000, o.at),
  ]);
}

const growth = (s: S, qs = '', token = s.token, id = s.studentId) => t.api('GET', `/api/students/${id}/growth${qs}`, undefined, token);
const count = async (sql: string) => (await t.db.prepare(sql).first<{ n: number }>())!.n;

describe('GET /students/:id/growth — access control & privacy', () => {
  it('requires authentication', async () => {
    const s = await setup();
    expect((await t.api('GET', `/api/students/${s.studentId}/growth`)).status).toBe(401);
    expect((await t.api('POST', `/api/students/${s.studentId}/growth/summary`, {})).status).toBe(401);
  });
  it('a second teacher gets 404 for another teacher\'s student (GET and POST), and for unknown ids', async () => {
    const a = await setup(), b = await setup();
    await seedResult(a, { at: ago(1), accuracy: 0.8 });
    expect((await growth(b, '', b.token, a.studentId)).status).toBe(404);
    expect((await t.api('POST', `/api/students/${a.studentId}/growth/summary`, {}, b.token)).status).toBe(404);
    expect((await growth(a, '', a.token, 'does-not-exist')).status).toBe(404);
    expect((await growth(a)).status).toBe(200);
  });
  it('never includes another student, a ranking or a leaderboard; responses are not cacheable', async () => {
    const s = await setup('اولی');
    const other = (await t.api('POST', '/api/students', { name: 'دومی بسیار متمایز', classId: s.classId }, s.token)).data.student;
    for (const d of [1, 3, 5]) { await seedResult(s, { at: ago(d), accuracy: 0.6 }); await seedResult(s, { at: ago(d), accuracy: 1 }, other.id); }
    const r = await t.raw('GET', `/api/students/${s.studentId}/growth`, { Authorization: `Bearer ${s.token}` });
    const body = await r.text();
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(body).not.toContain('دومی بسیار متمایز'); expect(body).not.toContain(other.id);
    const keys: string[] = []; const walk = (o: any) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); } };
    walk(JSON.parse(body));
    expect(keys.filter((k) => /rank|leaderboard|percentile|position|classAverage/i.test(k))).toEqual([]);     // no ranking / comparison fields at all
    expect(JSON.parse(body).notice).toContain('مقایسه با دانش‌آموزان دیگر');
    expect(JSON.parse(body).overview.activityCount).toBe(3);
  });
  it('the student play link never exposes growth', async () => {
    const s = await setup();
    const act = (await t.api('POST', '/api/activities', { classId: s.classId, gameType: 'memory', difficultyMode: 'easy', questionCount: 5 }, s.token)).data;
    await publishForTest(t, s.token, act.activity.id);
    const play = await t.api('GET', `/api/play/${act.links[0].url.split('/play/')[1]}`);
    expect(play.status).toBe(200);
    expect(JSON.stringify(play.data)).not.toMatch(/growth|trend|رشد/i);
    expect((await t.api('GET', `/api/play/${act.links[0].url.split('/play/')[1]}/growth`)).status).toBe(404);
  });
});

describe('minimum data & no interpolation', () => {
  it('a student with no result: zeros, no chart, no skills, fixed messages', async () => {
    const s = await setup();
    const g = (await growth(s)).data;
    expect(g.overview).toMatchObject({ activityCount: 0, assessmentCount: 0, activeDays: 0, lastActivityAt: null, cognitiveAverage: null, lastPerformance: null });
    expect(g.cognitive.timeline).toMatchObject({ available: false, points: [], message: MSG_NOT_ENOUGH_RANGE });
    expect(g.cognitive.skills).toEqual([]);
    expect(g.analysis).toMatchObject({ sufficient: false, text: MSG_ANALYSIS_NOT_ENOUGH, statements: [] });
    expect(g.assessments).toMatchObject({ count: 0, chartAvailable: false, subjects: [] });
  });
  it('one result and two results: numbers are shown, but no trend and no chart', async () => {
    const s = await setup();
    await seedResult(s, { at: ago(2), accuracy: 0.5 });
    let g = (await growth(s)).data;
    expect(g.overview).toMatchObject({ activityCount: 1, lastPerformance: 50, activeDays: 1 });
    expect(g.cognitive.timeline).toMatchObject({ available: false, points: [], message: MSG_NOT_ENOUGH_ACTIVITIES });
    await seedResult(s, { at: ago(1), accuracy: 0.9 });
    g = (await growth(s)).data;
    expect(g.cognitive.timeline).toMatchObject({ available: false, points: [], message: MSG_NOT_ENOUGH_ACTIVITIES });
    expect(g.cognitive.skills[0]).toMatchObject({ results: 2, sufficient: false, start: null, current: null, trend: { direction: 'insufficient' } });
    expect(g.analysis.sufficient).toBe(false);
  });
  it('three results on the same day are not drawn as a one-point «trend»', async () => {
    const s = await setup();
    for (let i = 0; i < 3; i++) await seedResult(s, { at: new Date(Date.parse(ago(1)) + i * 60_000).toISOString(), accuracy: 0.6 + i * 0.1 });
    const g = (await growth(s)).data;
    expect(g.cognitive.timeline.available).toBe(false);
    expect(g.cognitive.timeline.points).toEqual([]);
  });
});

describe('real trends from stored results', () => {
  it('growth over several weeks: chart points are real, skill start/current/change are in percentage points, analysis says «روند افزایشی»', async () => {
    const s = await setup();
    const acc = [0.5, 0.55, 0.65, 0.7, 0.8, 0.9];
    for (let i = 0; i < acc.length; i++) await seedResult(s, { at: ago(25 - i * 4), accuracy: acc[i] });
    const g = (await growth(s, '?range=30d')).data;
    expect(g.window.bucket).toBe('day');
    expect(g.cognitive.timeline.available).toBe(true);
    expect(g.cognitive.timeline.points.map((p: any) => p.percent)).toEqual([50, 55, 65, 70, 80, 90]);   // exactly the stored values, nothing invented
    expect(g.cognitive.timeline.trend.direction).toBe('up');
    const mem = g.cognitive.skills.find((x: any) => x.game === 'memory');
    // 6 results → start = mean of the first 3 (50, 55, 65), current = mean of the last 3 (70, 80, 90)
    expect(mem).toMatchObject({ skill: 'حافظه', sufficient: true, start: 56.7, current: 80, changePoints: 23.3, trend: { direction: 'up', label: 'رو به رشد' } });
    expect(g.overview.startVsCurrent).toMatchObject({ startPercent: 56.7, currentPercent: 80, changePoints: 23.3, window: 3 });
    expect(g.analysis.sufficient).toBe(true);
    expect(g.analysis.text).toContain('روند افزایشی');
    expect(g.analysis.text).not.toMatch(/اختلال|مشکل ذهنی|ضعف قطعی|بیش‌فعال/);
    expect(g.cognitive.timeline.points.every((p: any) => p.results === 1 && p.samples === 10)).toBe(true);
  });
  it('real decline and fluctuation are told apart', async () => {
    const down = await setup(), flat = await setup(), fluct = await setup();
    [0.9, 0.8, 0.7, 0.6, 0.5].forEach((a, i) => seedResult(down, { at: ago(20 - i * 4), accuracy: a }));
    [0.7, 0.72, 0.69, 0.71, 0.7].forEach((a, i) => seedResult(flat, { at: ago(20 - i * 4), accuracy: a }));
    [0.9, 0.3, 0.9, 0.3, 0.9, 0.3].forEach((a, i) => seedResult(fluct, { at: ago(25 - i * 4), accuracy: a }));
    await new Promise((r) => setTimeout(r, 50));
    expect((await growth(down)).data.cognitive.skills[0].trend.direction).toBe('down');
    expect((await growth(down)).data.analysis.text).toContain('کاهش');
    expect((await growth(flat)).data.cognitive.skills[0].trend.direction).toBe('stable');
    expect((await growth(fluct)).data.cognitive.skills[0].trend.direction).toBe('fluctuating');
    expect((await growth(fluct)).data.analysis.text).toContain('نوسان');
  });
  it('several months of activity use weekly aggregation and the 3-month / 6-month ranges', async () => {
    const s = await setup();
    for (let i = 0; i < 12; i++) await seedResult(s, { at: ago(150 - i * 12), accuracy: 0.4 + i * 0.04 });
    const g6 = (await growth(s, '?range=6m')).data;
    expect(g6.window.bucket).toBe('week');
    expect(g6.cognitive.timeline.points.length).toBeGreaterThan(8);
    expect(g6.cognitive.timeline.points.length).toBeLessThanOrEqual(g6.overview.activityCount);
    const g3 = (await growth(s, '?range=3m')).data;
    expect(g3.overview.activityCount).toBeLessThan(g6.overview.activityCount);
    const gAll = (await growth(s, '?range=all')).data;
    expect(gAll.overview.activityCount).toBe(12);
    expect(gAll.overview.changeVsPrevious).toBeNull(); expect(gAll.overview.changeNote).toContain('کل دوره');
  });
  it('ranges filter by date and the previous period feeds «تغییر نسبت به دوره قبل»', async () => {
    const s = await setup();
    await seedResult(s, { at: ago(2), accuracy: 0.9 }); await seedResult(s, { at: ago(4), accuracy: 0.8 });   // last 7 days
    await seedResult(s, { at: ago(9), accuracy: 0.5 }); await seedResult(s, { at: ago(12), accuracy: 0.5 });  // previous 7 days
    await seedResult(s, { at: ago(100), accuracy: 0.4 });
    const r = async (q: string) => (await growth(s, q)).data;
    expect((await r('?range=7d')).overview.activityCount).toBe(2);
    expect((await r('?range=30d')).overview.activityCount).toBe(4);
    expect((await r('?range=3m')).overview.activityCount).toBe(4);
    expect((await r('?range=6m')).overview.activityCount).toBe(5);
    expect((await r('?range=all')).overview.activityCount).toBe(5);
    expect((await r('?range=7d')).overview.changeVsPrevious).toMatchObject({ points: 35, previousAverage: 50, label: '۳۵ واحد درصد افزایش' });
    expect((await r('?range=7d')).overview.cognitiveAverage).toBe(85);
    expect((await r()).range).toBe('30d');                                   // default
    expect((await r('?range=7d')).cognitive.timeline.message).toBe(MSG_NOT_ENOUGH_ACTIVITIES);
  });
  it('recent activities list: newest first, with level, skill, response time, status and change vs previous run of the same game', async () => {
    const s = await setup();
    await seedResult(s, { at: ago(6), accuracy: 0.5, title: 'اول', avgMs: 3000 }); await seedResult(s, { at: ago(3), accuracy: 0.7, title: 'دوم' }); await seedResult(s, { at: ago(1), accuracy: 0.6, title: 'سوم', level: 'advanced' });
    const a = (await growth(s)).data.cognitive.activities;
    expect(a.recent.map((x: any) => x.title)).toEqual(['سوم', 'دوم', 'اول']);
    expect(a.recent[0]).toMatchObject({ percent: 60, skill: 'حافظه', level: 'advanced', levelLabel: 'پیشرفته', status: 'completed', statusLabel: 'انجام‌شده', changePoints: -10, averageResponseSeconds: 2 });
    expect(a.recent[2]).toMatchObject({ changePoints: null, averageResponseSeconds: 3 });
    expect(a.mostChanged[0].title).toBe('دوم');
  });
  it('activities without a level never send null labels (the Android client parses levelLabel as a non-null string)', async () => {
    const s = await setup();
    await seedResult(s, { at: ago(5), accuracy: 0.5, level: null }); await seedResult(s, { at: ago(2), accuracy: 0.7, level: null });
    const g = (await growth(s)).data;
    for (const x of g.cognitive.activities.recent) { expect(x.level).toBeNull(); expect(x.levelLabel).toBe(''); expect(typeof x.title).toBe('string'); }
    for (const l of g.filters.available.levels) expect(typeof l.label).toBe('string');
  });
});

describe('only valid data enters growth (same rules as the Reports)', () => {
  it('Preview sessions never count; a real student completion counts once', async () => {
    const s = await setup();
    const act = (await t.api('POST', '/api/activities', { classId: s.classId, gameType: 'memory', difficultyMode: 'medium', questionCount: 5 }, s.token)).data;
    await publishForTest(t, s.token, act.activity.id);                          // runs a complete teacher preview (+ approves + publishes)
    expect((await growth(s)).data.overview.activityCount).toBe(0);
    const tk = act.links[0].url.split('/play/')[1];
    const play = (await t.api('GET', `/api/play/${tk}`)).data;
    expect((await t.api('POST', `/api/play/${tk}/complete`, { sessionId: play.session.id, events: memoryEvents(5, 4, 2) })).status).toBe(200);
    const g = (await growth(s)).data;
    expect(g.overview.activityCount).toBe(1);
    expect(g.cognitive.activities.recent[0]).toMatchObject({ percent: 80, status: 'completed' });
    expect(await count('SELECT COUNT(*) AS n FROM teacher_preview_sessions')).toBeGreaterThan(0);
  });
  it('Draft / unpublished activities, unfinished sessions and incomplete or invalid results are ignored', async () => {
    const s = await setup();
    await seedResult(s, { at: ago(1), accuracy: 0.9, publish: 'draft' });
    await seedResult(s, { at: ago(2), accuracy: 0.9, publish: 'preview_required' });
    await seedResult(s, { at: ago(3), accuracy: 0.9, sessionStatus: 'started' });
    await seedResult(s, { at: ago(4), accuracy: 0.9, astStatus: 'started' });
    await seedResult(s, { at: ago(5), accuracy: null });                          // incomplete: no accuracy
    await seedResult(s, { at: ago(6), accuracy: 0.9, samples: 0 });               // no answered item
    await seedResult(s, { at: ago(7), accuracy: 1.7 });                           // invalid value
    await seedResult(s, { at: ago(8), accuracy: -0.2 });
    expect((await growth(s)).data.overview.activityCount).toBe(0);
    await seedResult(s, { at: ago(1), accuracy: 0.9 });
    expect((await growth(s)).data.overview.activityCount).toBe(1);
  });
  it('results of the same student under another teacher\'s activities are not counted', async () => {
    const a = await setup(), b = await setup();
    await seedResult({ ...a, teacher: b.teacher }, { at: ago(1), accuracy: 0.9 }, a.studentId);   // activity owned by teacher B, student of A
    expect((await growth(a)).data.overview.activityCount).toBe(0);
  });
  it('Teacher Assessment scores never enter the cognitive profile, and cognitive results never appear as assessments', async () => {
    const s = await setup();
    for (let i = 0; i < 4; i++) await seedResult(s, { at: ago(10 - i * 2), accuracy: 0.6 });
    for (const [d, p, sub] of [[9, 65, 'ریاضی'], [6, 72, 'ریاضی'], [3, 81, 'ریاضی'], [8, 70, 'علوم'], [2, 76, 'علوم']] as const) await seedAssessment(s, { at: ago(d), percent: p, subject: sub });
    const before = { r: await count('SELECT COUNT(*) AS n FROM game_results'), m: await count('SELECT COUNT(*) AS n FROM student_metrics') };
    const g = (await growth(s)).data;
    expect(g.overview).toMatchObject({ activityCount: 4, assessmentCount: 5, cognitiveAverage: 60 });             // assessments did not move the cognitive average
    expect(g.cognitive.skills.map((x: any) => x.game)).toEqual(['memory']);
    expect(g.assessments.subjects.map((x: any) => x.subject).sort()).toEqual(['ریاضی', 'علوم']);
    const math = g.assessments.subjects.find((x: any) => x.subject === 'ریاضی');
    expect(math.exams.map((e: any) => e.percent)).toEqual([65, 72, 81]);
    expect(math).toMatchObject({ count: 3, first: 65, last: 81, changePoints: 16, trend: { direction: 'up' } });
    expect(g.assessments).toMatchObject({ count: 5, chartAvailable: true, last: 76 });
    expect(g.assessments.series).toHaveLength(5);
    expect(g.analysis.text).toContain('آزمون‌های درسی ریاضی');
    expect(g.assessments.note).toContain('هیچ نقشی ندارد');
    expect(await count('SELECT COUNT(*) AS n FROM game_results')).toBe(before.r);                                   // reading growth writes nothing
    expect(await count('SELECT COUNT(*) AS n FROM student_metrics')).toBe(before.m);
  });
  it('draft / unpublished assessments and unfinished attempts are ignored', async () => {
    const s = await setup();
    await seedAssessment(s, { at: ago(1), percent: 90, status: 'draft' });
    await seedAssessment(s, { at: ago(2), percent: 90, status: 'teacher_preview' });
    await seedAssessment(s, { at: ago(3), percent: 90, attemptStatus: 'started' });
    expect((await growth(s)).data.assessments.count).toBe(0);
    await seedAssessment(s, { at: ago(1), percent: 90, status: 'archived' });                                     // archived keeps its history
    expect((await growth(s)).data.assessments.count).toBe(1);
  });
});

describe('filters', () => {
  it('game, skill, level and subject filters', async () => {
    const s = await setup();
    for (let i = 0; i < 3; i++) { await seedResult(s, { at: ago(10 - i), accuracy: 0.6, game: 'memory', level: 'basic' }); await seedResult(s, { at: ago(9 - i), accuracy: 0.7, game: 'attention', level: 'advanced' }); }
    await seedAssessment(s, { at: ago(3), percent: 60, subject: 'ریاضی' }); await seedAssessment(s, { at: ago(2), percent: 70, subject: 'علوم' });
    const q = async (qs: string) => (await growth(s, qs)).data;
    expect((await q('')).overview.activityCount).toBe(6);
    expect((await q('?game=memory')).cognitive.skills.map((x: any) => x.game)).toEqual(['memory']);
    expect((await q('?game=memory')).overview.activityCount).toBe(3);
    expect((await q('?skill=focus')).cognitive.skills.map((x: any) => x.game)).toEqual(['attention']);       // focus is trained by the attention game
    expect((await q('?skill=memory')).overview.activityCount).toBe(3);
    expect((await q('?game=memory&skill=focus')).overview.activityCount).toBe(0);                              // contradictory filters → nothing
    expect((await q('?level=advanced')).cognitive.skills.map((x: any) => x.game)).toEqual(['attention']);
    expect((await q('?subject=علوم')).assessments.count).toBe(1);
    expect((await q('')).filters.available).toMatchObject({ levels: expect.arrayContaining([{ code: 'basic', label: 'پایه' }]), subjects: expect.arrayContaining(['ریاضی', 'علوم']) });
  });
  it('invalid filters are rejected with 400', async () => {
    const s = await setup();
    for (const qs of ['?range=1y', '?game=chess', '?level=expert', '?skill=telepathy']) expect((await growth(s, qs)).status).toBe(400);
  });
});

describe('data deletion', () => {
  it('«delete student data» empties growth; deleting the student makes it 404; reading never stores aggregates', async () => {
    const s = await setup();
    for (let i = 0; i < 4; i++) await seedResult(s, { at: ago(10 - i), accuracy: 0.6 });
    await seedAssessment(s, { at: ago(2), percent: 80 });
    expect((await growth(s)).data.overview).toMatchObject({ activityCount: 4, assessmentCount: 1 });
    expect((await t.api('DELETE', `/api/students/${s.studentId}/data`, undefined, s.token)).status).toBe(200);
    const g = (await growth(s)).data;
    expect(g.overview).toMatchObject({ activityCount: 0, assessmentCount: 0 });
    expect(g.cognitive.skills).toEqual([]);
    expect((await t.api('DELETE', `/api/students/${s.studentId}`, undefined, s.token)).status).toBe(200);
    expect((await growth(s)).status).toBe(404);
  });
});

describe('AI summary (optional, guarded, minimal)', () => {
  // Free plan with 2 AI requests / month so the quota counter is really exercised (in a trial / paid plan nothing is metered).
  const env = () => ({ DB: t.db, FREE_AI_REQUESTS: '2' } as any);
  async function withGrowth(): Promise<S> {
    const s = await setup('نام محرمانه');
    await t.db.prepare('UPDATE teachers SET trial_expires_at = ? WHERE id = ?').bind(ago(1), s.teacher.id).run();   // Free plan: AI is metered (2 / month)
    for (const [i, a] of [0.58, 0.65, 0.7, 0.76].entries()) await seedResult(s, { at: ago(20 - i * 4), accuracy: a });
    return s;
  }
  const aiUsed = async (id: string) => (await t.db.prepare("SELECT count FROM usage_counters WHERE teacher_id = ? AND feature = 'ai'").bind(id).first<{ count: number }>())?.count ?? 0;

  it('sends only anonymous summary statistics to the model and returns a validated text', async () => {
    const s = await withGrowth();
    let system = '', facts = '';
    const r = await createGrowthSummary(env(), s.teacher.id, { id: s.studentId, display_name: s.name }, { range: '30d' }, async (sys, f) => {
      system = sys; facts = f;
      return 'در فعالیت‌های مرتبط با حافظه، عملکرد ثبت‌شده در این بازه از ۶۱٫۵ به ۷۳ رسیده و روند افزایشی داشته است.';
    });
    expect(r).toMatchObject({ source: 'ai', aiUsed: true, sufficient: true });
    expect(r.text).toContain('روند افزایشی');
    expect(system).toContain('Never invent'); expect(system).toContain('No medical, psychological');
    const parsed = JSON.parse(facts);
    expect(Object.keys(parsed).sort()).toEqual(['activity_count', 'assessment_changes', 'assessment_count', 'change_points', 'current_performance', 'previous_performance', 'range', 'range_label', 'skill_changes', 'trend']);
    expect(facts).not.toContain('نام محرمانه'); expect(facts).not.toContain(s.studentId); expect(facts).not.toMatch(/20\d\d-\d\d-\d\d/);
    expect(parsed.skill_changes[0]).toMatchObject({ skill: 'حافظه', results: 4, start: 61.5, current: 73, trend: 'up' });
    expect(await aiUsed(s.teacher.id)).toBe(1);
  });
  it('AI failure / empty output → rule-based text, nothing is billed', async () => {
    const s = await withGrowth(), me = { id: s.studentId, display_name: s.name };
    for (const prov of [async () => null, async () => { throw new Error('boom'); }, async () => '   ']) {
      const r = await createGrowthSummary(env(), s.teacher.id, me, { range: '30d' }, prov as any);
      expect(r).toMatchObject({ source: 'rules', aiUsed: false });
      expect(r.text).toContain('عملکرد ثبت‌شده');
    }
    expect(await aiUsed(s.teacher.id)).toBe(0);
  });
  it('hallucinated numbers and diagnoses are rejected and replaced by the rule-based text', async () => {
    const s = await withGrowth(), me = { id: s.studentId, display_name: s.name };
    const invented = await createGrowthSummary(env(), s.teacher.id, me, { range: '30d' }, async () => 'در فعالیت‌های حافظه، عملکرد ثبت‌شده ۹۱ واحد درصد افزایش داشته و روند افزایشی دیده می‌شود.');
    expect(invented).toMatchObject({ source: 'rules', reason: 'ai_rejected', rejected: 'unknown_number', aiUsed: false });
    const diag = await createGrowthSummary(env(), s.teacher.id, me, { range: '30d' }, async () => 'این دانش‌آموز اختلال یادگیری دارد و عملکرد ثبت‌شده او نوسان داشته است.');
    expect(diag).toMatchObject({ source: 'rules', reason: 'ai_rejected', rejected: 'forbidden_term' });
    expect(diag.text).not.toContain('اختلال');
    expect(await aiUsed(s.teacher.id)).toBe(0);
  });
  it('monthly AI quota used up → rule-based text, the provider is not called, the page still works', async () => {
    const s = await withGrowth(), me = { id: s.studentId, display_name: s.name };
    const ok = async () => 'در فعالیت‌های مرتبط با حافظه، عملکرد ثبت‌شده در این بازه روند افزایشی داشته است.';
    expect((await createGrowthSummary(env(), s.teacher.id, me, { range: '30d' }, ok)).source).toBe('ai');
    expect((await createGrowthSummary(env(), s.teacher.id, me, { range: '30d' }, ok)).source).toBe('ai');
    let called = 0;
    const r: any = await createGrowthSummary(env(), s.teacher.id, me, { range: '30d' }, async () => { called++; return ok(); });
    expect(called).toBe(0);
    expect(r).toMatchObject({ source: 'rules', aiUsed: false, reason: 'ai_limit_reached', aiLimitReached: true });
    expect(await aiUsed(s.teacher.id)).toBe(2);
    expect((await growth(s)).status).toBe(200);
  });
  it('not enough data → the provider is not even called', async () => {
    const s = await setup(); let called = 0;
    await seedResult(s, { at: ago(1), accuracy: 0.5 });
    const r = await createGrowthSummary(env(), s.teacher.id, { id: s.studentId, display_name: s.name }, { range: '30d' }, async () => { called++; return 'x'; });
    expect(called).toBe(0);
    expect(r).toMatchObject({ source: 'rules', sufficient: false, reason: 'insufficient_data', text: MSG_ANALYSIS_NOT_ENOUGH });
  });
  it('HTTP endpoint without a configured provider falls back to the rule-based analysis (never a 5xx)', async () => {
    const s = await withGrowth();
    const r = await t.api('POST', `/api/students/${s.studentId}/growth/summary`, { range: '30d' }, s.token);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ source: 'rules', aiUsed: false, sufficient: true });
    expect((await t.api('POST', `/api/students/${s.studentId}/growth/summary`, { range: 'forever' }, s.token)).status).toBe(400);
  });
});

describe('suggestion & regression', () => {
  it('next-activity suggestion is educational and requires teacher approval', async () => {
    const s = await setup();
    for (const [i, a] of [0.3, 0.35, 0.4, 0.3].entries()) await seedResult(s, { at: ago(12 - i * 2), accuracy: a, game: 'problem_solving' });
    const g = (await growth(s)).data;
    expect(g.suggestion).toMatchObject({ requiresTeacherApproval: true });
    expect(g.suggestion.text).toContain('پیشنهاد');
    expect(JSON.stringify(g.suggestion)).not.toMatch(/درمان|اختلال/);
  });
  it('existing endpoints still work and growth does not change the report', async () => {
    const s = await setup();
    for (let i = 0; i < 3; i++) await seedResult(s, { at: ago(5 - i), accuracy: 0.7 });
    const before = (await t.api('GET', `/api/reports/student/${s.studentId}`, undefined, s.token)).data;
    await growth(s);
    const after = (await t.api('GET', `/api/reports/student/${s.studentId}`, undefined, s.token)).data;
    expect(after).toEqual(before);
    expect((await t.api('GET', `/api/students/${s.studentId}/assessments`, undefined, s.token)).status).toBe(200);
    expect((await t.api('GET', `/api/v1/students/${s.studentId}/growth`, undefined, s.token)).status).toBe(200);   // /api/v1 alias
  });
});

describe('Student profile under the name includes Teacher Assessments', () => {
  it('summary text and `assessments` cover manual/source exams; cognitive indicators are unchanged', async () => {
    const s = await setup('دانش‌آموز پروفایل');
    for (const d of [5, 3]) await seedResult(s, { at: ago(d), accuracy: 0.6 });
    const before = (await t.api('GET', `/api/students/${s.studentId}/profile`, undefined, s.token)).data;
    expect(before.assessments).toMatchObject({ count: 0, average: null });
    expect(before.summary.text).toContain('آزمون معلمِ انجام‌شده‌ای');
    for (const [d, p] of [[6, 50], [4, 70], [2, 90]] as const) await seedAssessment(s, { at: ago(d), percent: p, subject: 'ریاضی' });
    const after = (await t.api('GET', `/api/students/${s.studentId}/profile`, undefined, s.token)).data;
    expect(after.assessments).toMatchObject({ count: 3, average: 70, last: 90 });
    expect(after.assessments.subjects[0]).toMatchObject({ subject: 'ریاضی', count: 3 });
    expect(after.summary.text).toContain('۳ آزمون معلم');
    expect(after.skills).toEqual(before.skills); // exam scores never move the cognitive indicators
  });
});
