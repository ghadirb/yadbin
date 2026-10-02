import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEnv, memoryEvents, registerTeacher, type TestEnv } from './helpers';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60_000);
afterAll(async () => { await t?.dispose(); });

async function setupClass(token: string, n = 5) {
  const c = await t.api('POST', '/api/classes', { name: 'کلاس سوم الف', grade: 'سوم', schoolName: 'مدرسه' }, token);
  const classId = c.data.class.id;
  const names = Array.from({ length: n }, (_, i) => `دانش‌آموز ${i + 1}`).join('\n');
  const s = await t.api('POST', `/api/classes/${classId}/students`, { text: names }, token);
  return { classId, students: s.data.added as { id: string; name: string }[] };
}
const tokenOf = (url: string) => url.split('/play/')[1];

describe('Authentication', () => {
  it('registers, never stores plaintext password, and logs in', async () => {
    const r = await registerTeacher(t);
    expect(r.res.status).toBe(201);
    const row = await t.db.prepare('SELECT password_hash FROM teachers WHERE phone = ?').bind(r.phone).first<any>();
    expect(row.password_hash).toMatch(/^pbkdf2\$100000\$/);
    expect(row.password_hash).not.toContain('pass12345');
    const login = await t.api('POST', '/api/auth/login', { phone: r.phone, password: 'pass12345' });
    expect(login.status).toBe(200); expect(login.data.token).toBeTruthy();
  });
  it('rejects invalid password with a generic message', async () => {
    const r = await registerTeacher(t);
    const bad = await t.api('POST', '/api/auth/login', { phone: r.phone, password: 'wrong-password' });
    const unknown = await t.api('POST', '/api/auth/login', { phone: '09990000000', password: 'wrong-password' });
    expect(bad.status).toBe(401); expect(unknown.status).toBe(401);
    expect(bad.data.message).toBe(unknown.data.message);
  });
  it('validates input; duplicate phone; Persian digits accepted', async () => {
    expect((await t.api('POST', '/api/auth/register', { name: 'ع', phone: '123', password: '1' })).status).toBe(400);
    const p = '۰۹۱۲۷۷۷۱۲۳۴';
    expect((await t.api('POST', '/api/auth/register', { name: 'معلم', phone: p, password: 'abcdefgh1' })).status).toBe(201);
    expect((await t.api('POST', '/api/auth/register', { name: 'معلم', phone: '09127771234', password: 'abcdefgh1' })).status).toBe(409);
  });
  it('protected endpoints need a valid token', async () => {
    expect((await t.api('GET', '/api/classes')).status).toBe(401);
    expect((await t.api('GET', '/api/classes', undefined, 'garbage.token.here')).status).toBe(401);
  });
});

describe('Classes CRUD', () => {
  it('create / read / update / delete + empty state', async () => {
    const { token } = await registerTeacher(t);
    expect((await t.api('GET', '/api/classes', undefined, token)).data.classes).toEqual([]);
    const c = await t.api('POST', '/api/classes', { name: 'کلاس اول', grade: 'اول' }, token);
    expect(c.status).toBe(201);
    const id = c.data.class.id;
    const list = await t.api('GET', '/api/classes', undefined, token);
    expect(list.data.classes[0]).toMatchObject({ name: 'کلاس اول', studentCount: 0, recentActivityCount: 0 });
    expect((await t.api('PUT', `/api/classes/${id}`, { name: 'کلاس اول ب', grade: 'اول', schoolName: 'م' }, token)).data.class.name).toBe('کلاس اول ب');
    expect((await t.api('GET', `/api/classes/${id}`, undefined, token)).data.class.schoolName).toBe('م');
    expect((await t.api('DELETE', `/api/classes/${id}`, undefined, token)).status).toBe(200);
    expect((await t.api('GET', `/api/classes/${id}`, undefined, token)).status).toBe(404);
  });
});

describe('Students', () => {
  it('add one, bulk add, remove from class keeps data, delete removes data', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setupClass(token, 0 + 1);
    const one = await t.api('POST', '/api/students', { name: 'علی رضایی', classId }, token);
    expect(one.status).toBe(201);
    const bulk = await t.api('POST', `/api/classes/${classId}/students`, { text: 'سارا محمدی\n\nمحمد احمدی\nرضا کریمی\n' }, token);
    expect(bulk.data.added).toHaveLength(3);
    let detail = await t.api('GET', `/api/classes/${classId}`, undefined, token);
    expect(detail.data.students).toHaveLength(5);

    const sid = one.data.student.id;
    await t.api('DELETE', `/api/classes/${classId}/students/${sid}`, undefined, token); // remove from class
    detail = await t.api('GET', `/api/classes/${classId}`, undefined, token);
    expect(detail.data.students).toHaveLength(4);
    expect((await t.api('GET', `/api/students/${sid}`, undefined, token)).status).toBe(200); // data still exists

    expect((await t.api('DELETE', `/api/students/${sid}`, undefined, token)).status).toBe(200); // delete data
    expect((await t.api('GET', `/api/students/${sid}`, undefined, token)).status).toBe(404);
  });
});

describe('Activities & tokens', () => {
  it('creates unique unguessable tokens per student; select students', async () => {
    const { token } = await registerTeacher(t);
    const { classId, students } = await setupClass(token, 5);
    const all = await t.api('POST', '/api/activities', { classId, gameType: 'memory' }, token);
    expect(all.status).toBe(201);
    expect(all.data.links).toHaveLength(5);
    const toks = all.data.links.map((l: any) => tokenOf(l.url));
    expect(new Set(toks).size).toBe(5);
    for (const tk of toks) {
      expect(tk).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
      for (const s of students) expect(tk).not.toContain(s.id.slice(0, 8));
    }
    expect(all.data.activity).toMatchObject({ difficultyMode: 'adaptive', questionCount: 10 });
    const sel = await t.api('POST', '/api/activities', { classId, gameType: 'attention', difficultyMode: 'easy', questionCount: 8, studentIds: [students[0].id, students[1].id] }, token);
    expect(sel.data.links).toHaveLength(2);
    expect((await t.api('POST', '/api/activities', { classId, gameType: 'memory', studentIds: ['00000000-0000-4000-8000-000000000000'] }, token)).status).toBe(400);
    expect((await t.api('POST', '/api/activities', { classId, gameType: 'bad' }, token)).status).toBe(400);
  });
});

describe('Teacher activity preview', () => {
  it('uses production pools but never creates a student result or unlocks links before approval', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setupClass(token, 1);
    const created = await t.api('POST', '/api/activities', { classId, gameType: 'memory', difficultyMode: 'medium', questionCount: 5, requiresPreview: true }, token);
    expect(created.status).toBe(201);
    const activityId = created.data.activity.id;
    const studentToken = tokenOf(created.data.links[0].url);
    expect((await t.api('GET', `/api/play/${studentToken}`)).status).toBe(403);

    const started = await t.api('POST', `/api/activities/${activityId}/preview`, undefined, token);
    expect(started.status).toBe(200);
    const previewToken = started.data.url.split('/preview/')[1];
    const preview = await t.api('GET', `/api/preview/${previewToken}`);
    expect(preview.status).toBe(200);
    expect(preview.data.pools['2']).toHaveLength(5);
    const complete = await t.api('POST', `/api/preview/${previewToken}/complete`, { sessionId: preview.data.session.id, events: memoryEvents(5, 4, 2) });
    expect(complete.status).toBe(200);
    expect((await t.db.prepare('SELECT COUNT(*) AS n FROM game_results').first<{ n: number }>())?.n).toBe(0);
    expect((await t.db.prepare("SELECT COUNT(*) AS n FROM activity_students WHERE status != 'pending'").first<{ n: number }>())?.n).toBe(0);

    expect((await t.api('POST', `/api/activities/${activityId}/preview-feedback`, { feedback: 'suitable' }, token)).status).toBe(200);
    expect((await t.api('POST', `/api/activities/${activityId}/publish`, undefined, token)).status).toBe(200);
    expect((await t.api('GET', `/api/play/${studentToken}`)).status).toBe(200);
  });
});

describe('Password recovery', () => {
  it('registers with a recovery code, resets the password with it, and rotates the code', async () => {
    const reg = await t.api('POST', '/api/auth/register', { name: 'معلم', phone: '09125550101', password: 'oldpass123' });
    expect(reg.status).toBe(201);
    expect(reg.data.recoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const bad = await t.api('POST', '/api/auth/reset-password', { phone: '09125550101', recoveryCode: 'AAAA-BBBB-CCCC', newPassword: 'newpass123' });
    expect(bad.status).toBe(401);
    const ok = await t.api('POST', '/api/auth/reset-password', { phone: '09125550101', recoveryCode: reg.data.recoveryCode.toLowerCase().replace(/-/g, ' '), newPassword: 'newpass123' });
    expect(ok.status).toBe(200);
    expect(ok.data.recoveryCode).not.toBe(reg.data.recoveryCode);
    expect((await t.api('POST', '/api/auth/login', { phone: '09125550101', password: 'oldpass123' })).status).toBe(401);
    expect((await t.api('POST', '/api/auth/login', { phone: '09125550101', password: 'newpass123' })).status).toBe(200);
    // the used code no longer works
    expect((await t.api('POST', '/api/auth/reset-password', { phone: '09125550101', recoveryCode: reg.data.recoveryCode, newPassword: 'another123' })).status).toBe(401);
  });
  it('does not reveal unknown phones and rejects accounts without a recovery code', async () => {
    const unknown = await t.api('POST', '/api/auth/reset-password', { phone: '09990001111', recoveryCode: 'AAAA-BBBB-CCCC', newPassword: 'newpass123' });
    expect(unknown.status).toBe(401);
    await t.db.prepare("UPDATE teachers SET recovery_hash = NULL WHERE phone = '09125550101'").run();
    expect((await t.api('POST', '/api/auth/reset-password', { phone: '09125550101', recoveryCode: 'AAAA-BBBB-CCCC', newPassword: 'newpass123' })).status).toBe(401);
  });
});

describe('Authorization', () => {
  it('teacher A cannot access teacher B data', async () => {
    const A = await registerTeacher(t, 'معلم الف'), B = await registerTeacher(t, 'معلم ب');
    const { classId, students } = await setupClass(A.token, 2);
    const act = await t.api('POST', '/api/activities', { classId, gameType: 'memory' }, A.token);
    const actId = act.data.activity.id;
    const checks: [string, string, unknown?][] = [
      ['GET', `/api/classes/${classId}`], ['PUT', `/api/classes/${classId}`, { name: 'x1', grade: 'y1' }], ['DELETE', `/api/classes/${classId}`],
      ['POST', `/api/classes/${classId}/students`, { name: 'نفوذ' }], ['DELETE', `/api/classes/${classId}/students/${students[0].id}`],
      ['GET', `/api/students/${students[0].id}`], ['DELETE', `/api/students/${students[0].id}`],
      ['GET', `/api/activities/${actId}`], ['POST', `/api/activities/${actId}/cancel`],
      ['POST', '/api/activities', { classId, gameType: 'memory' }], ['POST', '/api/students', { name: 'نفوذ', classId }],
      ['GET', `/api/reports/student/${students[0].id}`], ['GET', `/api/reports/class/${classId}`],
    ];
    for (const [m, p, b] of checks) expect((await t.api(m, p, b, B.token)).status, `${m} ${p}`).toBe(404);
    expect((await t.api('GET', '/api/classes', undefined, B.token)).data.classes).toEqual([]);
    expect((await t.api('GET', `/api/classes/${classId}`, undefined, A.token)).status).toBe(200); // A unaffected
  });
});

describe('Student token handling', () => {
  it('invalid, expired, canceled tokens', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setupClass(token, 2);
    expect((await t.api('GET', '/api/play/NOTATOKEN')).data.message).toBe('این لینک معتبر نیست.');
    expect((await t.api('GET', '/api/play/ABCDEFGHJKLMNPQR')).status).toBe(404);

    const act = await t.api('POST', '/api/activities', { classId, gameType: 'memory' }, token);
    const [l1, l2] = act.data.links.map((l: any) => tokenOf(l.url));
    await t.db.prepare('UPDATE activities SET expires_at = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', act.data.activity.id).run();
    const exp = await t.api('GET', `/api/play/${l1}`);
    expect(exp.status).toBe(410); expect(exp.data.error).toBe('expired');

    const act2 = await t.api('POST', '/api/activities', { classId, gameType: 'memory' }, token);
    await t.api('POST', `/api/activities/${act2.data.activity.id}/cancel`, undefined, token);
    const can = await t.api('GET', `/api/play/${tokenOf(act2.data.links[0].url)}`);
    expect(can.status).toBe(410); expect(can.data.message).toBe('این فعالیت دیگر فعال نیست.');
    void l2;
  });
  it('play payload is minimal: no names or teacher/class/student ids', async () => {
    const { token, id: teacherId } = await registerTeacher(t);
    const { classId, students } = await setupClass(token, 1);
    const act = await t.api('POST', '/api/activities', { classId, gameType: 'problem_solving' }, token);
    const r = await t.api('GET', `/api/play/${tokenOf(act.data.links[0].url)}`);
    const dump = JSON.stringify(r.data);
    expect(r.status).toBe(200);
    for (const secret of [teacherId, classId, students[0].id, students[0].name, 'کلاس سوم']) expect(dump).not.toContain(secret);
  });
});

describe('Session, resume, idempotent completion', () => {
  it('start → resume same questions → complete → duplicate ignored → completed message', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setupClass(token, 1);
    const act = await t.api('POST', '/api/activities', { classId, gameType: 'memory', difficultyMode: 'easy', questionCount: 10 }, token);
    const tk = tokenOf(act.data.links[0].url);
    const g1 = await t.api('GET', `/api/play/${tk}`);
    expect(g1.data.status).toBe('ready');
    const g2 = await t.api('GET', `/api/play/${tk}`);
    expect(g2.data.status).toBe('resume');
    expect(g2.data.session.id).toBe(g1.data.session.id);
    expect(g2.data.pools).toEqual(g1.data.pools);

    const body = { sessionId: g1.data.session.id, events: memoryEvents(10, 8) };
    const c1 = await t.api('POST', `/api/play/${tk}/complete`, body);
    expect(c1.status).toBe(200); expect(c1.data.duplicate).toBe(false);
    expect(JSON.stringify(c1.data)).not.toMatch(/accuracy|score|0\.8/);
    const c2 = await t.api('POST', `/api/play/${tk}/complete`, body); // retry the same submission
    expect(c2.data.duplicate).toBe(true);
    const n = await t.db.prepare('SELECT COUNT(*) AS n FROM game_results WHERE session_id = ?').bind(g1.data.session.id).first<any>();
    expect(n.n).toBe(1);
    expect((await t.api('GET', `/api/play/${tk}`)).data.message).toBe('این فعالیت قبلاً انجام شده است.');
  });
  it('concurrent double submit stores exactly one result', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setupClass(token, 1);
    const act = await t.api('POST', '/api/activities', { classId, gameType: 'memory' }, token);
    const tk = tokenOf(act.data.links[0].url);
    const g = await t.api('GET', `/api/play/${tk}`);
    const body = { sessionId: g.data.session.id, events: memoryEvents(8, 5) };
    const rs = await Promise.all([1, 2, 3].map(() => t.api('POST', `/api/play/${tk}/complete`, body)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const n = await t.db.prepare('SELECT COUNT(*) AS n FROM game_results WHERE session_id = ?').bind(g.data.session.id).first<any>();
    expect(n.n).toBe(1);
  });
  it('rejects results for a foreign/unknown session and garbage events', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await setupClass(token, 2);
    const act = await t.api('POST', '/api/activities', { classId, gameType: 'memory' }, token);
    const [a, b] = act.data.links.map((l: any) => tokenOf(l.url));
    const ga = await t.api('GET', `/api/play/${a}`);
    expect((await t.api('POST', `/api/play/${b}/complete`, { sessionId: ga.data.session.id, events: memoryEvents(5, 5) })).status).toBe(404);
    expect((await t.api('POST', `/api/play/${a}/complete`, { sessionId: ga.data.session.id, events: [{ nonsense: true }] })).status).toBe(422);
    expect((await t.api('POST', `/api/play/${a}/complete`, { sessionId: 'nope', events: [] })).status).toBe(400);
  });
  it('problem-solving correctness is derived on the server (client cannot fake it)', async () => {
    const { token } = await registerTeacher(t);
    const { classId, students } = await setupClass(token, 1);
    const act = await t.api('POST', '/api/activities', { classId, gameType: 'problem_solving', difficultyMode: 'medium', questionCount: 8 }, token);
    const tk = tokenOf(act.data.links[0].url);
    const g = await t.api('GET', `/api/play/${tk}`);
    const qs = g.data.pools['2'] as any[];
    // always answer WRONG on purpose but claim success in unknown extra fields
    const events = qs.map((q) => ({ questionId: q.id, attempts: 1, hintsUsed: 0, responseTime: 2500, finalAnswer: (q.correctOption + 1) % q.options.length, correct: true }));
    await t.api('POST', `/api/play/${tk}/complete`, { sessionId: g.data.session.id, events });
    const rep = await t.api('GET', `/api/reports/student/${students[0].id}`, undefined, token);
    const card = rep.data.skills.find((s: any) => s.game === 'problem_solving');
    expect(card.sampleCount).toBe(qs.length);
    expect(card.accuracy).toBe(0);
    expect(card.status).toBe('needs_practice');
  });
});

describe('Acceptance scenario (spec §44)', () => {
  it('teacher → class → 5 students → activities → play → report → trend → offline retry → duplicate → isolation', async () => {
    // 1-2
    const A = await registerTeacher(t, 'معلم پذیرش');
    // 3-4
    const { classId, students } = await setupClass(A.token, 5);
    expect(students).toHaveLength(5);
    // 5-7
    const act1 = await t.api('POST', '/api/activities', { classId, gameType: 'memory', studentIds: 'all' }, A.token);
    expect(new Set(act1.data.links.map((l: any) => l.url)).size).toBe(5);
    // 8-11
    const target = act1.data.links[0];
    const tk = tokenOf(target.url);
    const g = await t.api('GET', `/api/play/${tk}`);
    expect(g.data.status).toBe('ready'); // tutorial is client-side and never sent/recorded
    const done1 = await t.api('POST', `/api/play/${tk}/complete`, { sessionId: g.data.session.id, events: memoryEvents(10, 6) });
    expect(done1.data.ok).toBe(true);
    // 12
    const res = await t.db.prepare('SELECT * FROM game_results WHERE session_id = ?').bind(g.data.session.id).first<any>();
    expect(res.accuracy).toBeCloseTo(0.6, 3); expect(res.sample_count).toBe(10);
    // 13-15
    const dash = await t.api('GET', '/api/classes', undefined, A.token);
    expect(dash.data.classes[0]).toMatchObject({ studentCount: 5, recentActivityCount: 1 });
    let rep = await t.api('GET', `/api/reports/student/${target.studentId}`, undefined, A.token);
    let mem = rep.data.skills.find((s: any) => s.game === 'memory');
    expect(rep.data.completedActivities).toBe(1);
    expect(mem).toMatchObject({ status: 'average', accuracy: 0.6, sampleCount: 10, trend: { direction: 'insufficient' }, series: [] });
    expect(rep.data.skills.find((s: any) => s.game === 'attention')).toMatchObject({ status: 'insufficient', message: 'داده کافی نیست.', accuracy: null });
    // 16-18: second activity → trend appears
    const act2 = await t.api('POST', '/api/activities', { classId, gameType: 'memory', studentIds: [target.studentId] }, A.token);
    const tk2 = tokenOf(act2.data.links[0].url);
    const g2 = await t.api('GET', `/api/play/${tk2}`);
    await t.api('POST', `/api/play/${tk2}/complete`, { sessionId: g2.data.session.id, events: memoryEvents(10, 10, 2) });
    rep = await t.api('GET', `/api/reports/student/${target.studentId}`, undefined, A.token);
    mem = rep.data.skills.find((s: any) => s.game === 'memory');
    expect(mem.trend).toMatchObject({ title: 'روند عملکرد مشاهده‌شده', direction: 'up', confidence: 'preliminary', sessionCount: 2 });
    expect(mem.series).toHaveLength(2);
    expect(mem.highestDifficulty).toBe(2);
    const metricsRow = await t.db.prepare('SELECT * FROM student_metrics WHERE student_id = ? AND game_type = ?').bind(target.studentId, 'memory').first<any>();
    expect(metricsRow.sample_count).toBe(20); expect(metricsRow.trend).toBe('up');
    // recommendation exists with the «پیشنهاد سیستم» label
    expect(rep.data.suggestions[0]).toMatchObject({ label: 'پیشنهاد سیستم', gameType: 'memory' });
    // 19-23: offline → nothing reached server yet; retry later
    const act3 = await t.api('POST', '/api/activities', { classId, gameType: 'memory', studentIds: [students[1].id] }, A.token);
    const tk3 = tokenOf(act3.data.links[0].url);
    const g3 = await t.api('GET', `/api/play/${tk3}`);
    const payload = { sessionId: g3.data.session.id, events: memoryEvents(10, 7) }; // kept in the client's IndexedDB while offline
    expect((await t.db.prepare('SELECT COUNT(*) AS n FROM game_results WHERE session_id = ?').bind(g3.data.session.id).first<any>()).n).toBe(0);
    expect((await t.api('POST', `/api/play/${tk3}/complete`, payload)).data.duplicate).toBe(false); // reconnect → sync
    // 24-25: same result twice
    expect((await t.api('POST', `/api/play/${tk3}/complete`, payload)).data.duplicate).toBe(true);
    expect((await t.db.prepare('SELECT COUNT(*) AS n FROM game_results WHERE session_id = ?').bind(g3.data.session.id).first<any>()).n).toBe(1);
    // 26: isolation
    const B = await registerTeacher(t, 'معلم دیگر');
    expect((await t.api('GET', `/api/reports/student/${target.studentId}`, undefined, B.token)).status).toBe(404);
    // Class report: counts only, no ranking
    const cr = await t.api('GET', `/api/reports/class/${classId}`, undefined, A.token);
    expect(cr.data).toMatchObject({ studentCount: 5, activitiesCreated: 3, completedSessions: 3 });
    expect(JSON.stringify(cr.data)).not.toMatch(/rank|leaderboard|رتبه/);
  });
  it('report never uses diagnostic language', async () => {
    const A = await registerTeacher(t);
    const { classId, students } = await setupClass(A.token, 1);
    const rep = await t.api('GET', `/api/reports/student/${students[0].id}`, undefined, A.token);
    expect(JSON.stringify(rep.data)).not.toMatch(/ADHD|اختلال یادگیری|کم‌هوش|ضعیف|IQ|هوش \d+/);
    expect(classId).toBeTruthy();
  });
});
