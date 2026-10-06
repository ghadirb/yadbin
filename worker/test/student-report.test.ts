import { beforeAll, describe, expect, it } from 'vitest';
import { createEnv, registerTeacher, type TestEnv } from './helpers';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60_000);

const DAY = 86_400_000;
const ago = (d: number) => { const x = new Date(Date.now() - d * DAY); x.setUTCHours(8, 0, 0, 0); return x.toISOString(); };
let n = 0;
const uid = (p: string) => `${p}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

async function setup(name = 'دانش‌آموز گزارش') {
  const teacher = await registerTeacher(t);
  const cls = (await t.api('POST', '/api/classes', { name: 'کلاس پنجم', gradeCode: 'g5' }, teacher.token)).data.class;
  const student = (await t.api('POST', '/api/students', { name, classId: cls.id }, teacher.token)).data.student;
  return { teacher, token: teacher.token, classId: cls.id as string, studentId: student.id as string, name };
}
type S = Awaited<ReturnType<typeof setup>>;

interface Seed { at: string; accuracy: number | null; samples?: number; game?: string; publish?: string; sessionStatus?: string; title?: string; falseClickRate?: number | null }
async function seedResult(s: S, o: Seed, studentId = s.studentId) {
  const act = uid('act'), ast = uid('ast'), ses = uid('ses'), game = o.game ?? 'memory';
  const details: Record<string, number | null> = game === 'attention' && o.falseClickRate !== undefined ? { falseClickRate: o.falseClickRate } : {};
  await t.db.batch([
    t.db.prepare(`INSERT INTO activities (id, teacher_id, class_id, game_type, difficulty_mode, question_count, status, created_at, publish_state, title, activity_level) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(act, s.teacher.id, s.classId, game, 'medium', 10, 'active', o.at, o.publish ?? 'published', o.title ?? `فعالیت ${n}`, 'basic'),
    t.db.prepare(`INSERT INTO activity_students (id, activity_id, student_id, token, status, started_at, completed_at) VALUES (?,?,?,?,?,?,?)`).bind(ast, act, studentId, uid('tok'), 'completed', o.at, o.at),
    t.db.prepare(`INSERT INTO game_sessions (id, activity_student_id, game_type, started_at, completed_at, status) VALUES (?,?,?,?,?,?)`).bind(ses, ast, game, o.at, o.at, o.sessionStatus ?? 'completed'),
    t.db.prepare(`INSERT INTO game_results (session_id, accuracy, average_response_time, difficulty_reached, hints_used, sample_count, raw_result_json, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(ses, o.accuracy, 2000, 2, 0, o.samples ?? 10, JSON.stringify({ computed: { game, sampleCount: o.samples ?? 10, accuracy: o.accuracy, details }, meta: {} }), o.at),
  ]);
}
async function seedAssessment(s: S, o: { at: string; percent: number; subject?: string; title?: string; status?: string }, studentId = s.studentId) {
  const a = uid('asm'), x = uid('asx'), att = uid('att');
  await t.db.batch([
    t.db.prepare(`INSERT INTO assessments (id, teacher_id, root_id, version, title, subject, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(a, s.teacher.id, a, 1, o.title ?? 'آزمون', o.subject ?? 'ریاضی', o.status ?? 'published', o.at, o.at),
    t.db.prepare(`INSERT INTO assessment_students (id, assessment_id, student_id, class_id, token, status, assigned_at, completed_at) VALUES (?,?,?,?,?,?,?,?)`).bind(x, a, studentId, s.classId, uid('atk'), 'completed', o.at, o.at),
    t.db.prepare(`INSERT INTO assessment_attempts (id, assessment_student_id, assessment_id, assessment_version, started_at, completed_at, status) VALUES (?,?,?,?,?,?,?)`).bind(att, x, a, 1, o.at, o.at, 'completed'),
    t.db.prepare(`INSERT INTO assessment_results (attempt_id, total, correct, unanswered, percent, duration_ms, created_at) VALUES (?,?,?,?,?,?,?)`).bind(att, 10, Math.round(o.percent / 10), 1, o.percent, 60000, o.at),
  ]);
}
const report = (s: S, qs = '', token = s.token, id = s.studentId) => t.api('GET', `/api/students/${id}/report${qs}`, undefined, token);

describe('GET /students/:id/report — access control', () => {
  it('requires authentication; another teacher and unknown ids get 404 (also for print)', async () => {
    const a = await setup(), b = await setup();
    await seedResult(a, { at: ago(1), accuracy: 0.8 });
    expect((await t.api('GET', `/api/students/${a.studentId}/report`)).status).toBe(401);
    expect((await t.api('GET', `/api/students/${a.studentId}/report/print`)).status).toBe(401);
    expect((await report(b, '', b.token, a.studentId)).status).toBe(404);
    expect((await t.api('GET', `/api/students/${a.studentId}/report/print`, undefined, b.token)).status).toBe(404);
    expect((await report(a, '', a.token, 'nope')).status).toBe(404);
    expect((await report(a)).status).toBe(200);
  });
  it('never leaks another student or a ranking; not cacheable', async () => {
    const s = await setup('اولی');
    const other = (await t.api('POST', '/api/students', { name: 'دومی بسیار متمایز', classId: s.classId }, s.token)).data.student;
    for (const d of [1, 2, 3]) { await seedResult(s, { at: ago(d), accuracy: 0.6 }); await seedResult(s, { at: ago(d), accuracy: 1 }, other.id); }
    const r = await t.raw('GET', `/api/students/${s.studentId}/report`, { Authorization: `Bearer ${s.token}` });
    const body = await r.text();
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(body).not.toContain('دومی بسیار متمایز'); expect(body).not.toContain(other.id);
    expect(body).not.toMatch(/"(rank|leaderboard|percentile|classAverage)/i);
    expect(JSON.parse(body).overview.activityCount).toBe(3);
  });
  it('validates the query (400)', async () => {
    const s = await setup();
    for (const qs of ['?period=forever', '?type=huge', '?period=custom', '?period=custom&from=2026-02-01&to=2026-01-01', '?period=custom&from=2026-13-01&to=2026-14-01', '?period=year&year=1300', '?pageSize=9999']) {
      expect((await report(s, qs)).status, qs).toBe(400);
    }
  });
});

describe('report content', () => {
  it('builds the structured report for the current academic year (identity, period, overview, skills, activities, metadata)', async () => {
    const s = await setup('علی رضایی');
    for (const [d, acc] of [[6, 0.5], [4, 0.6], [2, 0.8]] as const) await seedResult(s, { at: ago(d), accuracy: acc, game: 'memory' });
    await seedResult(s, { at: ago(3), accuracy: 0.7, game: 'attention' });
    const r = (await report(s)).data;
    expect(r.student).toMatchObject({ id: s.studentId, name: 'علی رضایی', className: 'کلاس پنجم', academicYear: '۱۴۰۵–۱۴۰۶' });
    expect(r.student.gradeLabel).toBeTruthy();
    expect(r.period).toMatchObject({ key: 'year_current', academicYear: '۱۴۰۵–۱۴۰۶', title: 'گزارش عملکرد دانش‌آموز در سال تحصیلی ۱۴۰۵–۱۴۰۶' });
    expect(r.metadata.generatedAtJalali).toMatch(/^۱۴۰۵\//); expect(r.metadata.disclaimer).toContain('تشخیص پزشکی یا روان‌شناختی');
    expect(r.overview.activityCount).toBe(4); expect(r.overview.activeDays).toBe(4);
    expect(r.overview.startVsCurrent).not.toBeNull();
    const mem = r.skillTrends.skills.find((x: any) => x.game === 'memory');
    expect(mem.results).toBe(3); expect(mem.trend.direction).toBe('up'); expect(mem.summary).toContain('روند افزایشی');
    expect(r.skillTrends.skills.find((x: any) => x.game === 'attention').trend.direction).toBe('insufficient');
    expect(r.skillTrends.skills.map((x: any) => x.game)).not.toContain('problem_solving'); // no data → not shown, not zero
    expect(r.activities.total).toBe(4); expect(r.activities.items[0].dateJalali).toMatch(/^۱۴۰۵\//);
    expect(r.cognitiveGrowth.timeline.available).toBe(true);
    expect(Object.keys(r)).toEqual(expect.arrayContaining(['student', 'period', 'overview', 'cognitiveGrowth', 'skillTrends', 'academicAssessments', 'activities', 'analysis', 'metadata']));
  });

  it('date filters: custom range, relative ranges and the previous academic year exclude out-of-range results', async () => {
    const s = await setup();
    await seedResult(s, { at: '2026-05-10T08:00:00.000Z', accuracy: 0.4 }); // previous academic year (۱۴۰۴–۱۴۰۵)
    await seedResult(s, { at: '2026-05-11T08:00:00.000Z', accuracy: 0.5 });
    await seedResult(s, { at: '2026-05-12T08:00:00.000Z', accuracy: 0.6 });
    await seedResult(s, { at: ago(2), accuracy: 0.9 });
    const cur = (await report(s)).data, prev = (await report(s, '?period=year_previous')).data, cust = (await report(s, '?period=custom&from=2026-05-11&to=2026-05-11')).data, d7 = (await report(s, '?period=7d')).data;
    expect(cur.overview.activityCount).toBe(1);
    expect(prev.overview.activityCount).toBe(3); expect(prev.period.academicYear).toBe('۱۴۰۴–۱۴۰۵'); expect(prev.period.title).toContain('۱۴۰۴–۱۴۰۵');
    expect(cust.overview.activityCount).toBe(1); expect(cust.activities.items[0].percent).toBe(50); expect(cust.period.academicYear).toBeNull();
    expect(d7.overview.activityCount).toBe(1);
    expect(cur.periodOptions.hasPreviousYearData).toBe(true);
    // edge: the last day of the custom range is inclusive in Tehran time, the next day is not
    expect((await report(s, '?period=custom&from=2026-05-10&to=2026-05-10')).data.overview.activityCount).toBe(1);
    expect((await report(s, '?period=custom&from=2026-05-13&to=2026-05-20')).data.overview.activityCount).toBe(0);
  });

  it('draft, unpublished, unfinished and invalid results never enter the report', async () => {
    const s = await setup();
    await seedResult(s, { at: ago(1), accuracy: 0.9 });
    await seedResult(s, { at: ago(1), accuracy: 0.1, publish: 'draft' });
    await seedResult(s, { at: ago(1), accuracy: 0.1, publish: 'ready_to_publish' });
    await seedResult(s, { at: ago(1), accuracy: 0.1, sessionStatus: 'started' });
    await seedResult(s, { at: ago(1), accuracy: null });
    await seedResult(s, { at: ago(1), accuracy: 1.5 });
    await seedResult(s, { at: ago(1), accuracy: 0.2, samples: 0 });
    await seedAssessment(s, { at: ago(1), percent: 10, status: 'draft' });
    const r = (await report(s)).data;
    expect(r.overview.activityCount).toBe(1); expect(r.overview.lastPerformance).toBe(90); expect(r.activities.total).toBe(1); expect(r.academicAssessments.count).toBe(0);
  });

  it('cognitive growth and academic assessments are separate: exam scores never change the cognitive numbers', async () => {
    const s = await setup();
    for (const [d, acc] of [[5, 0.6], [3, 0.6], [1, 0.6]] as const) await seedResult(s, { at: ago(d), accuracy: acc });
    const before = (await report(s)).data;
    for (const [d, p] of [[4, 20], [3, 30], [2, 40], [1, 100]] as const) await seedAssessment(s, { at: ago(d), percent: p, subject: d > 2 ? 'ریاضی' : 'علوم' });
    const after = (await report(s)).data;
    expect(after.overview.cognitiveAverage).toBe(before.overview.cognitiveAverage);
    expect(after.overview.activityCount).toBe(3); expect(after.overview.assessmentCount).toBe(4);
    expect(after.cognitiveGrowth.timeline.points).toEqual(before.cognitiveGrowth.timeline.points);
    expect(after.skillTrends.skills).toEqual(before.skillTrends.skills);
    expect(after.academicAssessments.count).toBe(4);
    expect(after.academicAssessments.average).toBe(47.5);
    expect(after.academicAssessments.subjects.map((x: any) => x.subject).sort()).toEqual(['ریاضی', 'علوم']);
    expect(after.academicAssessments.totals).toMatchObject({ exams: 4, questions: 40, unanswered: 4 });
    expect(JSON.stringify(after.cognitiveGrowth)).not.toContain('آزمون');
  });

  it('a student without any data still gets a report: no crash, no invented numbers, clear messages', async () => {
    const s = await setup();
    const res = await report(s);
    expect(res.status).toBe(200);
    const r = res.data;
    expect(r.overview).toMatchObject({ activityCount: 0, assessmentCount: 0, cognitiveAverage: null, lastPerformance: null, startVsCurrent: null, activeDays: 0, lastActivityAt: null });
    expect(r.cognitiveGrowth.timeline).toMatchObject({ available: false, points: [] }); expect(r.cognitiveGrowth.timeline.message).toContain('داده کافی');
    expect(r.skillTrends.skills).toEqual([]); expect(r.skillTrends.skillsMessage).toBeTruthy();
    expect(r.activities).toMatchObject({ total: 0, items: [] });
    expect(r.analysis.sufficient).toBe(false);
    const html = (await t.raw('GET', `/api/students/${s.studentId}/report/print`, { Authorization: `Bearer ${s.token}` }));
    expect(html.status).toBe(200); expect(await html.text()).toContain('هنوز داده کافی');
  });

  it('1–2 results: raw numbers are shown, but no chart, no trend, no invented insight', async () => {
    const s = await setup();
    await seedResult(s, { at: ago(2), accuracy: 0.7 }); await seedResult(s, { at: ago(1), accuracy: 0.9 });
    const r = (await report(s)).data;
    expect(r.overview.activityCount).toBe(2); expect(r.overview.lastPerformance).toBe(90);
    expect(r.cognitiveGrowth.timeline.available).toBe(false); expect(r.cognitiveGrowth.timeline.points).toEqual([]);
    expect(r.skillTrends.skills[0].trend.direction).toBe('insufficient');
    expect(r.overview.startVsCurrent).toBeNull();
  });
});

describe('response control & learning', () => {
  it('response control comes only from real false-click data of attention sessions; learning is never estimated', async () => {
    const s = await setup();
    for (const [d, fc] of [[5, 0.5], [3, 0.3], [1, 0.1]] as const) await seedResult(s, { at: ago(d), accuracy: 0.7, game: 'attention', falseClickRate: fc });
    const r = (await report(s)).data.skillTrends;
    expect(r.responseControl).toMatchObject({ available: true, results: 3, start: 50, current: 90, changePoints: 40 });
    expect(r.responseControl.trend.direction).toBe('up'); expect(r.responseControl.basis).toContain('توجه');
    expect(r.learning).toMatchObject({ available: false, message: 'یادگیری: داده مستقل کافی ثبت نشده است.' });
  });
  it('without enough real data (no field / fewer than 3 sessions) it is NOT shown and says so', async () => {
    const s = await setup();
    await seedResult(s, { at: ago(3), accuracy: 0.7, game: 'attention' });                     // no falseClickRate stored
    await seedResult(s, { at: ago(2), accuracy: 0.7, game: 'attention', falseClickRate: 0.2 });
    await seedResult(s, { at: ago(1), accuracy: 0.7, game: 'memory' });                        // other games never count
    const rc = (await report(s)).data.skillTrends.responseControl;
    expect(rc).toMatchObject({ available: false, results: 1, series: [], start: null, current: null });
    expect(rc.message).toBe('کنترل پاسخ: داده مستقل کافی ثبت نشده است.');
  });
});

describe('summary vs full, pagination and volume', () => {
  it('summary returns a short activity list; full paginates and never sends everything', async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++) await seedResult(s, { at: ago(1 + (i % 12)), accuracy: 0.5 + (i % 5) / 10, title: `فعالیت-${i}` });
    const sum = (await report(s, '?type=summary')).data, full = (await report(s, '?type=full&pageSize=10')).data, p3 = (await report(s, '?pageSize=10&page=3')).data, over = (await report(s, '?pageSize=10&page=99')).data;
    expect(sum.type).toBe('summary'); expect(sum.activities.total).toBe(30); expect(sum.activities.items).toHaveLength(5);
    expect(full.activities.items).toHaveLength(10); expect(full.activities.pages).toBe(3);
    expect(p3.activities.page).toBe(3); expect(p3.activities.items).toHaveLength(10);
    expect(over.activities.page).toBe(3); // clamped, not an error
    expect(new Set([...full.activities.items, ...p3.activities.items].map((x: any) => x.title)).size).toBe(20);
  });
  it('a year with ~600 results is aggregated on the server within a sane time and size', async () => {
    const s = await setup();
    const stmts: D1PreparedStatement[] = [];
    const start = Date.parse('2026-09-24T08:00:00Z');
    for (let i = 0; i < 600; i++) {
      const at = new Date(start + (i % 12) * DAY * 0 + (i % 13) * 60_000).toISOString(); // all inside the current academic year
      const act = uid('a'), ast = uid('s'), ses = uid('g');
      stmts.push(
        t.db.prepare(`INSERT INTO activities (id, teacher_id, class_id, game_type, difficulty_mode, question_count, status, created_at, publish_state, title, activity_level) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(act, s.teacher.id, s.classId, 'memory', 'medium', 10, 'active', at, 'published', `ف${i}`, 'basic'),
        t.db.prepare(`INSERT INTO activity_students (id, activity_id, student_id, token, status, started_at, completed_at) VALUES (?,?,?,?,?,?,?)`).bind(ast, act, s.studentId, uid('tk'), 'completed', at, at),
        t.db.prepare(`INSERT INTO game_sessions (id, activity_student_id, game_type, started_at, completed_at, status) VALUES (?,?,?,?,?,?)`).bind(ses, ast, 'memory', at, at, 'completed'),
        t.db.prepare(`INSERT INTO game_results (session_id, accuracy, average_response_time, difficulty_reached, hints_used, sample_count, raw_result_json, created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(ses, 0.5 + (i % 50) / 100, 1500, 2, 0, 10, '{"computed":{"details":{}}}', at),
      );
    }
    for (let i = 0; i < stmts.length; i += 100) await t.db.batch(stmts.slice(i, i + 100));
    const t0 = Date.now();
    const res = await t.raw('GET', `/api/students/${s.studentId}/report?pageSize=20`, { Authorization: `Bearer ${s.token}` });
    const body = await res.text();
    expect(Date.now() - t0).toBeLessThan(8000);
    const r = JSON.parse(body);
    expect(r.overview.activityCount).toBe(600); expect(r.activities.items).toHaveLength(20); expect(r.activities.total).toBe(600);
    expect(r.cognitiveGrowth.timeline.points.length).toBeLessThan(60);
    expect(body.length).toBeLessThan(120_000); // raw results are not shipped
  });
});

describe('GET /students/:id/report/print', () => {
  it('returns A4 RTL Persian HTML with inline SVG charts, escaped content, disclaimer and a safe file name', async () => {
    const s = await setup('<script>alert(1)</script> سارا');
    for (const [d, acc] of [[6, 0.5], [4, 0.6], [2, 0.8], [1, 0.9]] as const) await seedResult(s, { at: ago(d), accuracy: acc, title: '<b>تمرین</b>' });
    for (const [d, p] of [[5, 40], [3, 60], [1, 80]] as const) await seedAssessment(s, { at: ago(d), percent: p });
    const res = await t.raw('GET', `/api/students/${s.studentId}/report/print`, { Authorization: `Bearer ${s.token}` });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html'); expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-report-filename')).toBe(`yadbin-student-report-${s.studentId}-1405-1406.pdf`);
    expect(html).toContain('size: A4'); expect(html).toContain('dir="rtl"'); expect(html).toContain('lang="fa"');
    expect(html).toContain('گزارش عملکرد دانش‌آموز در سال تحصیلی ۱۴۰۵–۱۴۰۶');
    expect(html).toContain('<svg'); expect(html).toContain('break-inside: avoid'); expect(html).toContain('counter(page)');
    expect(html).toContain('به‌تنهایی ابزار تشخیص پزشکی یا روان‌شناختی محسوب نمی‌شود');
    expect(html).not.toContain('<script>alert(1)</script>'); expect(html).not.toContain('<b>تمرین</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/https?:\/\//); // no external font / script / image / link
    expect(html).toContain('کنترل پاسخ: داده مستقل کافی ثبت نشده است.'); expect(html).toContain('یادگیری: داده مستقل کافی ثبت نشده است.');
  });
  it('summary is shorter than full; each report ends with the disclaimer', async () => {
    const s = await setup();
    for (let i = 0; i < 12; i++) await seedResult(s, { at: ago(1 + i), accuracy: 0.5 + i / 30 });
    const get = async (type: string) => (await t.raw('GET', `/api/students/${s.studentId}/report/print?type=${type}`, { Authorization: `Bearer ${s.token}` })).text();
    const [full, sum] = [await get('full'), await get('summary')];
    expect(sum.length).toBeLessThan(full.length);
    expect(full).toContain('گزارش کامل'); expect(sum).toContain('گزارش خلاصه');
    expect(sum).toContain('تشخیص پزشکی یا روان‌شناختی');
  });
});
