import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEnv, publishForTest, registerTeacher, type TestEnv } from './helpers';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60_000);
afterAll(async () => { await t?.dispose(); });

const count = async (sql: string, ...b: unknown[]) => (await t.db.prepare(sql).bind(...b).first<{ n: number }>())!.n;
const tokenOf = (url: string) => url.split('/play/')[1];
const MC = { type: 'multiple_choice', text: 'پایتخت ایران کدام است؟', options: ['تهران', 'شیراز', 'تبریز', 'اصفهان'], correct: 0 };

/** One teacher with a class, students, a published game activity, a published assessment (with an answered attempt) and a book source. */
async function seed(name: string) {
  const tc = await registerTeacher(t, name);
  const c = (await t.api('POST', '/api/classes', { name: 'ششم الف', gradeCode: 'g6' }, tc.token)).data.class;
  const students: any[] = [];
  for (let i = 0; i < 2; i++) students.push((await t.api('POST', '/api/students', { name: `دانش‌آموز ${i + 1}`, classId: c.id }, tc.token)).data.student);

  const act = (await t.api('POST', '/api/activities', { classId: c.id, gameType: 'memory' }, tc.token)).data.activity;
  await publishForTest(t, tc.token, act.id);

  const asm = (await t.api('POST', '/api/assessments', { title: 'آزمون', subject: 'علوم', gradeCode: 'g6' }, tc.token)).data.assessment.id as string;
  expect((await t.api('POST', `/api/assessments/${asm}/questions`, MC, tc.token)).status).toBe(201);
  const pv = await t.api('POST', `/api/assessments/${asm}/preview`, undefined, tc.token);
  const pt = pv.data.url.split('/preview/')[1];
  const p = await t.api('GET', `/api/preview/${pt}`);
  await t.api('POST', `/api/preview/${pt}/complete`, { sessionId: p.data.session.id, answers: p.data.assessment.questions.map((q: any) => ({ questionId: q.id, answer: 0, responseTimeMs: 900 })) });
  await t.api('POST', `/api/assessments/${asm}/preview-feedback`, { feedback: 'suitable' }, tc.token);
  const pub = await t.api('POST', `/api/assessments/${asm}/publish`, { classId: c.id }, tc.token);
  expect(pub.status).toBe(200);
  const link = pub.data.links[0] as { url: string };
  const g = await t.api('GET', `/api/play/${tokenOf(link.url)}`);
  const done = await t.api('POST', `/api/play/${tokenOf(link.url)}/complete`, { sessionId: g.data.session.id, answers: g.data.assessment.questions.map((q: any) => ({ questionId: q.id, answer: 0, responseTimeMs: 1000 })), durationMs: 5000 });
  expect(done.status).toBe(200);

  // A book source (rows inserted directly: only the deletion path matters here)
  const sid = crypto.randomUUID(), sec = crypto.randomUUID(), now = new Date().toISOString();
  await t.db.prepare("INSERT INTO content_sources (id,teacher_id,title,file_type,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(sid, tc.id, 'کتاب', 'paste', 'ready', now, now).run();
  await t.db.prepare("INSERT INTO content_source_sections (id,source_id,title,order_index) VALUES (?,?,?,0)").bind(sec, sid, 'فصل ۱').run();
  await t.db.prepare("INSERT INTO content_source_chunks (id,source_id,section_id,chunk_index,content,created_at) VALUES (?,?,?,0,?,?)").bind(crypto.randomUUID(), sid, sec, 'متن', now).run();

  return { ...tc, classId: c.id as string, students, playUrl: link.url as string };
}

const OWNED_TABLES: Array<[string, string]> = [
  ['classes', 'teacher_id'], ['students', 'teacher_id'], ['activities', 'teacher_id'], ['assessments', 'teacher_id'],
  ['content_sources', 'teacher_id'], ['usage_counters', 'teacher_id'], ['payments', 'teacher_id'], ['subscriptions', 'teacher_id'],
  ['teacher_preview_sessions', 'teacher_id'], ['assessment_preview_sessions', 'teacher_id'],
];
const snapshot = async (id: string) => Object.fromEntries(await Promise.all(OWNED_TABLES.map(async ([tbl, col]) => [tbl, await count(`SELECT COUNT(*) AS n FROM ${tbl} WHERE ${col} = ?`, id)] as const)));

describe('Account deletion (POST /api/account/delete)', () => {
  it('requires a session, the password and an explicit confirmation; a failed attempt deletes nothing', async () => {
    const a = await seed('معلم الف');
    expect((await t.api('POST', '/api/account/delete', { password: 'pass12345', confirm: true })).status).toBe(401);
    const wrong = await t.api('POST', '/api/account/delete', { password: 'not-my-password', confirm: true }, a.token);
    expect(wrong.status).toBe(403); expect(wrong.data.error).toBe('wrong_password');
    expect((await t.api('POST', '/api/account/delete', { password: 'pass12345' }, a.token)).status).toBe(400);
    expect((await t.api('POST', '/api/account/delete', { password: 'pass12345', confirm: false }, a.token)).status).toBe(400);
    expect((await t.api('POST', '/api/account/delete', {}, a.token)).status).toBe(400);
    expect(await count('SELECT COUNT(*) AS n FROM teachers WHERE id = ?', a.id)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM students WHERE teacher_id = ?', a.id)).toBe(2);
    expect((await t.api('POST', '/api/auth/login', { phone: a.phone, password: 'pass12345' })).status).toBe(200);
  }, 60_000);

  it('erases the teacher and everything under them, and leaves another teacher completely untouched', async () => {
    const a = await seed('معلم الف');
    const b = await seed('معلم ب');
    const beforeA = await snapshot(a.id);
    expect(beforeA.classes).toBe(1); expect(beforeA.students).toBe(2); expect(beforeA.activities).toBe(1); expect(beforeA.assessments).toBe(1); expect(beforeA.content_sources).toBe(1);
    const beforeB = await snapshot(b.id);
    const resultsBefore = await count('SELECT COUNT(*) AS n FROM assessment_results');
    const sessionsBefore = await count('SELECT COUNT(*) AS n FROM game_sessions');

    const del = await t.api('POST', '/api/account/delete', { password: 'pass12345', confirm: true }, a.token);
    expect(del.status, JSON.stringify(del.data)).toBe(200);
    expect(del.data).toEqual({ ok: true, deleted: true });

    // Gone: the account and every owned row, including leaf tables that have no teacher_id column.
    expect(await count('SELECT COUNT(*) AS n FROM teachers WHERE id = ?', a.id)).toBe(0);
    for (const [tbl, n] of Object.entries(await snapshot(a.id))) expect(n, tbl).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM class_students WHERE class_id = ?', a.classId)).toBe(0);
    for (const s of a.students) {
      expect(await count('SELECT COUNT(*) AS n FROM activity_students WHERE student_id = ?', s.id)).toBe(0);
      expect(await count('SELECT COUNT(*) AS n FROM assessment_students WHERE student_id = ?', s.id)).toBe(0);
      expect(await count('SELECT COUNT(*) AS n FROM student_metrics WHERE student_id = ?', s.id)).toBe(0);
    }
    expect(await count("SELECT COUNT(*) AS n FROM content_source_chunks WHERE source_id NOT IN (SELECT id FROM content_sources)")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM content_source_sections WHERE source_id NOT IN (SELECT id FROM content_sources)")).toBe(0);
    // No orphans anywhere.
    expect(await count('SELECT COUNT(*) AS n FROM assessment_results WHERE attempt_id NOT IN (SELECT id FROM assessment_attempts)')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM assessment_attempts WHERE assessment_student_id NOT IN (SELECT id FROM assessment_students)')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM game_results WHERE session_id NOT IN (SELECT id FROM game_sessions)')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM game_sessions WHERE activity_student_id NOT IN (SELECT id FROM activity_students)')).toBe(0);
    // Something of A's results existed and is gone; B's are not touched.
    expect(await count('SELECT COUNT(*) AS n FROM assessment_results')).toBeLessThan(resultsBefore);
    expect(await count('SELECT COUNT(*) AS n FROM game_sessions')).toBeLessThanOrEqual(sessionsBefore);

    // The student link of the deleted teacher stops working; the phone can no longer log in.
    expect((await t.api('GET', `/api/play/${tokenOf(a.playUrl)}`)).status).toBe(404);
    expect((await t.api('POST', '/api/auth/login', { phone: a.phone, password: 'pass12345' })).status).toBe(401);
    // Deleting twice is a clean 404, not a crash.
    expect((await t.api('POST', '/api/account/delete', { password: 'pass12345', confirm: true }, a.token)).status).toBe(404);

    // Teacher B is byte-for-byte unaffected and still works.
    expect(await snapshot(b.id)).toEqual(beforeB);
    expect((await t.api('GET', `/api/play/${tokenOf(b.playUrl)}`)).status).toBe(200);
    expect((await t.api('GET', '/api/classes', undefined, b.token)).data.classes).toHaveLength(1);
  }, 120_000);

  it('the phone number can be registered again afterwards as a brand-new account (new trial, no old data)', async () => {
    const a = await seed('معلم ج');
    expect((await t.api('POST', '/api/account/delete', { password: 'pass12345', confirm: true }, a.token)).status).toBe(200);
    const again = await t.api('POST', '/api/auth/register', { name: 'معلم جدید', phone: a.phone, password: 'another-pass-1' });
    expect(again.status).toBe(201);
    expect(again.data.teacher.id).not.toBe(a.id);
    expect((await t.api('GET', '/api/classes', undefined, again.data.token)).data.classes).toHaveLength(0);
    expect((await t.api('GET', '/api/subscription', undefined, again.data.token)).data.subscription.trialActive).toBe(true);
  }, 60_000);

  it('is rate limited per account (a thief with a session cannot brute-force the password)', async () => {
    const a = await registerTeacher(t);
    for (let i = 0; i < 5; i++) expect((await t.api('POST', '/api/account/delete', { password: `wrong-${i}-password`, confirm: true }, a.token)).status).toBe(403);
    expect((await t.api('POST', '/api/account/delete', { password: 'pass12345', confirm: true }, a.token)).status).toBe(429);
    expect(await count('SELECT COUNT(*) AS n FROM teachers WHERE id = ?', a.id)).toBe(1);
  }, 60_000);
});
