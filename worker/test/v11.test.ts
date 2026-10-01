import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEnv, memoryEvents, registerTeacher, type TestEnv } from './helpers';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60_000);
afterAll(async () => { await t?.dispose(); });

const tokenOf = (url: string) => url.split('/play/')[1];
async function setup(token: string, n = 3) {
  const c = await t.api('POST', '/api/classes', { name: 'کلاس سوم الف', grade: 'سوم' }, token);
  const classId = c.data.class.id as string;
  const s = await t.api('POST', `/api/classes/${classId}/students`, { text: Array.from({ length: n }, (_, i) => `دانش‌آموز ${i + 1}`).join('\n') }, token);
  return { classId, students: s.data.added as { id: string; name: string }[] };
}
async function makeActivity(token: string, classId: string, extra: object = {}) {
  const r = await t.api('POST', '/api/activities', { classId, gameType: 'memory', difficultyMode: 'easy', questionCount: 5, ...extra }, token);
  expect(r.status).toBe(201);
  return r.data as { activity: any; links: { studentId: string; url: string }[] };
}
async function play(url: string, correct: number, n = 5) {
  const token = tokenOf(url);
  const start = await t.api('GET', `/api/play/${token}`);
  const done = await t.api('POST', `/api/play/${token}/complete`, { sessionId: start.data.session.id, events: memoryEvents(n, correct), durationMs: 120_000 });
  return { start, done };
}

describe('v1.1 class management', () => {
  it('lists students with counts, last activity and open state; average withheld until enough data', async () => {
    const { token } = await registerTeacher(t);
    const { classId, students } = await setup(token);
    const act = await makeActivity(token, classId);
    await play(act.links[0].url, 5);
    const d = (await t.api('GET', `/api/classes/${classId}`, undefined, token)).data;
    const done = d.students.find((s: any) => s.id === act.links[0].studentId);
    const pending = d.students.find((s: any) => s.id === act.links[1].studentId);
    expect(done).toMatchObject({ completedActivities: 1, openActivities: 0, activityState: 'up_to_date', sufficientData: false, averagePerformance: null });
    expect(done.lastActivityAt).toBeTruthy();
    expect(pending).toMatchObject({ completedActivities: 0, openActivities: 1, activityState: 'open' });
    // a second session pushes the student past MIN_SAMPLES => numeric average appears
    const act2 = await makeActivity(token, classId);
    await play(act2.links.find((l) => l.studentId === done.id)!.url, 4);
    const d2 = (await t.api('GET', `/api/classes/${classId}`, undefined, token)).data;
    expect(d2.students.find((s: any) => s.id === done.id).averagePerformance).toBeCloseTo(0.9, 2);
    expect(students.length).toBe(3);
  });

  it('removes a student from the class but keeps their data; shows history and details', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setup(token);
    const act = await makeActivity(token, classId, { title: 'تشخیص رنگ‌ها' });
    const sid = act.links[0].studentId;
    await play(act.links[0].url, 4);
    const h = await t.api('GET', `/api/students/${sid}/history`, undefined, token);
    expect(h.status).toBe(200);
    expect(h.data.history[0]).toMatchObject({ title: 'تشخیص رنگ‌ها', status: 'completed', gameType: 'memory', durationSeconds: 120 });
    const rep = (await t.api('GET', `/api/students/${sid}`, undefined, token)).data;
    expect(rep.summary).toMatchObject({ sessions: 1, successes: 1, timeSpentMinutes: 2 });
    expect((await t.api('DELETE', `/api/classes/${classId}/students/${sid}`, undefined, token)).status).toBe(200);
    const d = (await t.api('GET', `/api/classes/${classId}`, undefined, token)).data;
    expect(d.students.find((s: any) => s.id === sid)).toBeUndefined();
    expect((await t.api('GET', `/api/students/${sid}/history`, undefined, token)).data.history).toHaveLength(1);
  });

  it('archives and unarchives a class; archived classes are hidden by default and closed to new activities', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setup(token);
    expect((await t.api('POST', `/api/classes/${classId}/archive`, undefined, token)).data.class.archived).toBe(true);
    expect((await t.api('GET', '/api/classes', undefined, token)).data.classes).toHaveLength(0);
    expect((await t.api('GET', '/api/classes?archived=true', undefined, token)).data.classes).toHaveLength(1);
    expect((await t.api('GET', '/api/classes?archived=all', undefined, token)).data.classes).toHaveLength(1);
    const blocked = await t.api('POST', '/api/activities', { classId, gameType: 'memory' }, token);
    expect(blocked.status).toBe(409); expect(blocked.data.error).toBe('class_archived');
    expect((await t.api('POST', `/api/classes/${classId}/students`, { name: 'علی رضایی' }, token)).status).toBe(409);
    await t.api('POST', `/api/classes/${classId}/unarchive`, undefined, token);
    expect((await t.api('GET', '/api/classes', undefined, token)).data.classes).toHaveLength(1);
    expect((await t.api('POST', '/api/activities', { classId, gameType: 'memory' }, token)).status).toBe(201);
  });
});

describe('v1.1 activities', () => {
  it('edits metadata any time, but locks difficulty/count once a student has started', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setup(token);
    const act = await makeActivity(token, classId, { title: 'اولیه', suggestedMinutes: 5 });
    const id = act.activity.id;
    let r = await t.api('PUT', `/api/activities/${id}`, { title: 'عنوان جدید', description: 'توضیح', suggestedMinutes: 8, difficultyMode: 'hard', questionCount: 8 }, token);
    expect(r.status).toBe(200);
    expect(r.data.activity).toMatchObject({ title: 'عنوان جدید', description: 'توضیح', suggestedMinutes: 8, difficultyMode: 'hard', questionCount: 8 });
    await t.api('GET', `/api/play/${tokenOf(act.links[0].url)}`); // a child starts
    r = await t.api('PUT', `/api/activities/${id}`, { difficultyMode: 'easy' }, token);
    expect(r.status).toBe(409); expect(r.data.error).toBe('activity_in_progress');
    r = await t.api('PUT', `/api/activities/${id}`, { title: 'باز هم قابل ویرایش' }, token);
    expect(r.status).toBe(200);
    expect((await t.api('PUT', `/api/activities/${id}`, { suggestedMinutes: 0 }, token)).status).toBe(400);
  });

  it('duplicates with a "- تمرین دوم/سوم" title, fresh links, and leaves old results alone', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setup(token);
    const act = await makeActivity(token, classId, { title: 'تشخیص رنگ‌ها', description: 'د' });
    await play(act.links[0].url, 5);
    const d1 = await t.api('POST', `/api/activities/${act.activity.id}/duplicate`, {}, token);
    expect(d1.status).toBe(201);
    expect(d1.data.activity.title).toBe('تشخیص رنگ‌ها - تمرین دوم');
    expect(d1.data.activity).toMatchObject({ description: 'د', gameType: 'memory', questionCount: 5, lifecycle: 'active' });
    expect(d1.data.links).toHaveLength(3);
    expect(d1.data.links[0].url).not.toBe(act.links[0].url);
    const d2 = await t.api('POST', `/api/activities/${d1.data.activity.id}/duplicate`, {}, token);
    expect(d2.data.activity.title).toBe('تشخیص رنگ‌ها - تمرین سوم');
    const orig = (await t.api('GET', `/api/activities/${act.activity.id}`, undefined, token)).data;
    expect(orig.students.filter((s: any) => s.status === 'completed')).toHaveLength(1);
  });

  it('derives lifecycle: active → ended (canceled / all done) → archived, and filters the list', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setup(token, 2);
    const a = await makeActivity(token, classId);
    const b = await makeActivity(token, classId);
    const c = await makeActivity(token, classId);
    expect(a.activity.lifecycle).toBe('active');
    await t.api('POST', `/api/activities/${b.activity.id}/cancel`, undefined, token);
    for (const l of c.links) await play(l.url, 5);
    expect((await t.api('GET', `/api/activities/${b.activity.id}`, undefined, token)).data.activity).toMatchObject({ lifecycle: 'ended', lifecycleLabel: 'پایان‌یافته', status: 'canceled' });
    expect((await t.api('GET', `/api/activities/${c.activity.id}`, undefined, token)).data.activity.lifecycle).toBe('ended');
    await t.api('POST', `/api/activities/${a.activity.id}/archive`, undefined, token);
    const byState = async (q: string) => (await t.api('GET', `/api/activities?classId=${classId}&lifecycle=${q}`, undefined, token)).data.activities.map((x: any) => x.id);
    expect(await byState('archived')).toEqual([a.activity.id]);
    expect((await byState('ended')).sort()).toEqual([b.activity.id, c.activity.id].sort());
    expect(await byState('active')).toEqual([]);
    expect(await byState('open')).toHaveLength(2);
    expect(await byState('all')).toHaveLength(3);
    await t.api('POST', `/api/activities/${a.activity.id}/unarchive`, undefined, token);
    expect(await byState('active')).toEqual([a.activity.id]);
  });

  it('regenerates links: old link dies, started session survives, finished students are skipped', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setup(token, 3);
    const act = await makeActivity(token, classId);
    const [l0, l1] = act.links;
    const started = await t.api('GET', `/api/play/${tokenOf(l0.url)}`);
    await play(l1.url, 5);
    const r = await t.api('POST', `/api/activities/${act.activity.id}/regenerate-links`, {}, token);
    expect(r.status).toBe(200);
    expect(r.data.links).toHaveLength(2); // the finished student keeps their (inert) link
    expect((await t.api('GET', `/api/play/${tokenOf(l0.url)}`)).status).toBe(404);
    const fresh = r.data.links.find((l: any) => l.studentId === l0.studentId);
    const again = await t.api('GET', `/api/play/${tokenOf(fresh.url)}`);
    expect(again.status).toBe(200); expect(again.data.session.id).toBe(started.data.session.id);
    const one = await t.api('POST', `/api/activities/${act.activity.id}/regenerate-links`, { studentId: l1.studentId }, token);
    expect(one.status).toBe(404); // finished
  });
});

describe('v1.1 reports', () => {
  it('class report: active students, averages, per-game, weekly series, no ranking', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setup(token, 3);
    const empty = (await t.api('GET', `/api/reports/class/${classId}`, undefined, token)).data;
    expect(empty).toMatchObject({ activeStudents: 0, averagePerformance: null, sufficientData: false });
    expect(empty.weekly).toHaveLength(6);
    const act = await makeActivity(token, classId);
    await play(act.links[0].url, 5); await play(act.links[1].url, 3);
    const rep = (await t.api('GET', `/api/reports/class/${classId}`, undefined, token)).data;
    expect(rep).toMatchObject({ studentCount: 3, activeStudents: 2, completedSessions: 2, sufficientData: true });
    expect(rep.averagePerformance).toBeCloseTo(0.8, 2);
    expect(rep.byGame[0]).toMatchObject({ game: 'memory', gameName: 'به خاطر بسپار', completed: 2 });
    expect(rep.weekly[5].completed).toBe(2);
    expect(JSON.stringify(rep)).not.toMatch(/rank|leaderboard|دانش‌آموز 1/);
  });
});

describe('v1.1 child feedback + progress', () => {
  it('returns encouraging non-numeric feedback and a nameless own-progress view', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setup(token, 2);
    const act = await makeActivity(token, classId);
    const { done } = await play(act.links[0].url, 5);
    expect(done.data.feedback.level).toBe('great');
    expect(done.data.feedback.lines).toContain('فعالیت کامل شد.');
    expect(JSON.stringify(done.data)).not.toMatch(/accuracy|score|\d\.\d/);
    const low = await play(act.links[1].url, 1);
    expect(low.done.data.feedback.level).toBe('keep_going');
    const p = await t.api('GET', `/api/play/${tokenOf(act.links[0].url)}/progress`);
    expect(p.status).toBe(200);
    expect(p.data).toMatchObject({ completedActivities: 1 });
    expect(JSON.stringify(p.data)).not.toContain('دانش‌آموز');
    expect((await t.api('GET', '/api/play/AAAAAAAAAAAAAAAA/progress')).status).toBe(404);
  });
});

describe('v1.1 security (spec 6.3)', () => {
  it('teacher B cannot read or change any of teacher A\'s new resources', async () => {
    const A = await registerTeacher(t), B = await registerTeacher(t);
    const { classId, students } = await setup(A.token);
    const act = await makeActivity(A.token, classId);
    const id = act.activity.id;
    const calls: [string, string, unknown?][] = [
      ['GET', `/api/students/${students[0].id}/history`], ['POST', `/api/classes/${classId}/archive`], ['POST', `/api/classes/${classId}/unarchive`],
      ['PUT', `/api/activities/${id}`, { title: 'هک' }], ['POST', `/api/activities/${id}/duplicate`, {}], ['POST', `/api/activities/${id}/archive`],
      ['POST', `/api/activities/${id}/regenerate-links`, {}], ['GET', `/api/activities?classId=${classId}`], ['GET', `/api/reports/class/${classId}`],
    ];
    for (const [m, p, body] of calls) expect((await t.api(m, p, body, B.token)).status, `${m} ${p}`).toBe(404);
    expect((await t.api('GET', '/api/activities', undefined, B.token)).data.activities).toEqual([]);
    const after = (await t.api('GET', `/api/activities/${id}`, undefined, A.token)).data.activity;
    expect(after.title).not.toBe('هک'); expect(after.lifecycle).toBe('active');
  });
  it('student tokens never open teacher endpoints; one child\'s link shows only their own progress', async () => {
    const A = await registerTeacher(t);
    const { classId } = await setup(A.token, 2);
    const act = await makeActivity(A.token, classId);
    await play(act.links[0].url, 5);
    const other = await t.api('GET', `/api/play/${tokenOf(act.links[1].url)}/progress`);
    expect(other.data.completedActivities).toBe(0);
    expect((await t.api('GET', `/api/classes/${classId}`, undefined, tokenOf(act.links[0].url))).status).toBe(401);
  });
});

describe('v1.1 API versioning (spec 6.1)', () => {
  it('serves the same API under /api/v1 and keeps /api working', async () => {
    const { token } = await registerTeacher(t);
    expect((await t.api('GET', '/api/v1/health')).status).toBe(200);
    const c = await t.api('POST', '/api/v1/classes', { name: 'کلاس نسخه', grade: 'اول' }, token);
    expect(c.status).toBe(201);
    expect((await t.api('GET', '/api/classes', undefined, token)).data.classes).toHaveLength(1);
    expect((await t.api('GET', '/api/v1/classes', undefined, token)).data.classes).toHaveLength(1);
    expect((await t.api('GET', '/api/v1/nope', undefined, token)).status).toBe(404);
    expect((await t.api('GET', '/api/v1/classes')).status).toBe(401);
  });
});

describe('v1.1 multi-user (spec §7): 1 teacher, 1 class, 30 students at once', () => {
  it('records every result correctly with no cross-talk and acceptable latency', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setup(token, 30);
    const act = await makeActivity(token, classId, { questionCount: 8 });
    expect(act.links).toHaveLength(30);
    const t0 = Date.now();
    const out = await Promise.all(act.links.map((l, i) => play(l.url, i % 9)));
    const ms = Date.now() - t0;
    out.forEach((o, i) => { expect(o.start.status, `start ${i}`).toBe(200); expect(o.done.status, `done ${i}`).toBe(200); });
    const sessions = new Set(out.map((o) => o.start.data.session.id));
    expect(sessions.size).toBe(30);
    const rows = (await t.db.prepare('SELECT COUNT(*) AS n FROM game_results').first<any>()).n;
    expect(rows).toBeGreaterThanOrEqual(30);
    const rep = (await t.api('GET', `/api/reports/class/${classId}`, undefined, token)).data;
    expect(rep).toMatchObject({ completedSessions: 30, completionRate: 1, activeStudents: 30 });
    // each student's stored accuracy equals what they themselves submitted
    for (let i = 0; i < 30; i++) {
      const r = (await t.api('GET', `/api/students/${act.links[i].studentId}`, undefined, token)).data;
      expect(r.completedActivities).toBe(1);
      const h = (await t.api('GET', `/api/students/${act.links[i].studentId}/history`, undefined, token)).data.history[0];
      expect(h.accuracy).toBeCloseTo((i % 9) / 5 > 1 ? 1 : Math.min(1, (i % 9) / 5), 2);
    }
    console.log(`30 concurrent students finished in ${ms} ms`);
    expect(ms).toBeLessThan(30_000);
  }, 120_000);
});

describe('v1.1 error handling (spec 6.2)', () => {
  it('returns Persian JSON errors with a stable shape for bad input, and never leaks internals', async () => {
    const { token } = await registerTeacher(t);
    const bad = await t.api('POST', '/api/classes', { name: '', grade: '' }, token);
    expect(bad.status).toBe(400);
    expect(bad.data).toMatchObject({ error: 'validation_error' });
    expect(typeof bad.data.message).toBe('string');
    const res = await t.raw('POST', '/api/classes', { Authorization: `Bearer ${token}` }, undefined);
    expect([400]).toContain(res.status);
    const nf = await t.api('GET', '/api/activities/00000000-0000-4000-8000-000000000000', undefined, token);
    expect(nf.status).toBe(404); expect(JSON.stringify(nf.data)).not.toMatch(/SELECT|stack|D1_/);
  });
});
