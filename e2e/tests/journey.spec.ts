import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { goOffline, goOnline, playThrough, readIdb } from './bot';

// Acceptance scenario (spec §44) executed in a REAL Chromium against the REAL Worker + local D1.
test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let teacherToken = '', classId = '';
let students: { id: string; name: string }[] = [];
const auth = () => ({ Authorization: `Bearer ${teacherToken}` });
const tokenOf = (url: string) => url.split('/play/')[1];

async function createActivity(gameType: string, studentIds: string[] | 'all', questionCount = 5) {
  const r = await api.post('/api/activities', { headers: auth(), data: { classId, gameType, difficultyMode: 'adaptive', questionCount, studentIds } });
  expect(r.status()).toBe(201);
  return (await r.json()) as { activity: { id: string }; links: { studentId: string; url: string }[] };
}
async function report(studentId: string) {
  const r = await api.get(`/api/reports/student/${studentId}`, { headers: auth() });
  expect(r.status()).toBe(200);
  return (await r.json()) as any;
}
const skill = (rep: any, game: string) => rep.skills.find((s: any) => s.game === game);

test.beforeAll(async ({ playwright }) => {
  api = await pwRequest.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8787' });
  const phone = `09${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const reg = await api.post('/api/auth/register', { data: { name: 'معلم آزمون', phone, password: 'pass12345' } });
  expect(reg.status()).toBe(201);
  const login = await api.post('/api/auth/login', { data: { phone, password: 'pass12345' } });
  expect(login.status()).toBe(200);
  teacherToken = (await login.json()).token;
  const c = await api.post('/api/classes', { headers: auth(), data: { name: 'کلاس سوم الف', grade: 'سوم' } });
  classId = (await c.json()).class.id;
  const s = await api.post(`/api/classes/${classId}/students`, { headers: auth(), data: { text: 'علی رضایی\nسارا محمدی\nمحمد احمدی\nرضا کریمی\nمریم حسینی' } });
  students = (await s.json()).added;
  expect(students).toHaveLength(5);
});
test.afterAll(async () => { await api?.dispose(); });

test('invalid link shows the friendly message', async ({ page }) => {
  await page.goto('/play/ABCDEFGHJKLMNPQR');
  await expect(page.getByText('این لینک معتبر نیست.')).toBeVisible();
});

test('5 unique links; welcome text; full Memory session in the browser; result reaches the teacher', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
  const act = await createActivity('memory', 'all');
  expect(new Set(act.links.map((l) => l.url)).size).toBe(5);
  const link = act.links.find((l) => l.studentId === students[0].id)!;

  const first = await playThrough(page, tokenOf(link.url), 'memory');
  expect(first.kind).toBe('end');
  expect(first.endText).toContain('فعالیت تمام شد');
  expect(errors).toEqual([]);

  const rep = await report(students[0].id);
  expect(rep.completedActivities).toBe(1);
  expect(skill(rep, 'memory')).toMatchObject({ sessionCount: 1, sampleCount: 5, status: 'insufficient', message: 'داده کافی نیست.', accuracy: null });
  expect(JSON.stringify(rep)).not.toMatch(/ADHD|اختلال|کم‌هوش|ضعیف/);

  // Re-opening a finished link
  await page.goto(`/play/${tokenOf(link.url)}`);
  await expect(page.getByText('این فعالیت قبلاً انجام شده است.')).toBeVisible();
});

test('welcome screen wording', async ({ page }) => {
  const act = await createActivity('memory', [students[4].id]);
  await page.goto(`/play/${tokenOf(act.links[0].url)}`);
  await expect(page.getByText('سلام 👋')).toBeVisible();
  await expect(page.getByText('اینجا قرار نیست نمره بگیری.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'شروع بازی' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/امتیاز|نمره:|رتبه/);
});

test('second session → trend + «پیشنهاد سیستم» appear', async ({ page }) => {
  const act = await createActivity('memory', [students[0].id]);
  const r = await playThrough(page, tokenOf(act.links[0].url), 'memory');
  expect(r.kind).toBe('end');
  const rep = await report(students[0].id);
  const m = skill(rep, 'memory');
  expect(m).toMatchObject({ sessionCount: 2, sampleCount: 10, status: 'good' });
  expect(m.trend.title).toBe('روند عملکرد مشاهده‌شده');
  expect(m.trend.direction).not.toBe('insufficient');
  expect(m.series).toHaveLength(2);
  expect(rep.suggestions[0].label).toBe('پیشنهاد سیستم');
});

test('Attention and Problem-solving complete in the browser (with a hint)', async ({ page }) => {
  const a = await createActivity('attention', [students[1].id]);
  const ra = await playThrough(page, tokenOf(a.links[0].url), 'attention');
  expect(ra.kind).toBe('end');
  const p = await createActivity('problem_solving', [students[1].id]);
  const rp = await playThrough(page, tokenOf(p.links[0].url), 'problem_solving', { useHint: true });
  expect(rp.kind).toBe('end');
  const rep = await report(students[1].id);
  expect(skill(rep, 'attention')).toMatchObject({ sessionCount: 1, sampleCount: 5 });
  expect(skill(rep, 'problem_solving')).toMatchObject({ sessionCount: 1, sampleCount: 5 });
  expect(rep.completedActivities).toBe(2);
});

test('offline mid-game → saved on device → reconnect → synced once → duplicate submit ignored', async ({ page, context }) => {
  const student = students[2];
  const act = await createActivity('memory', [student.id]);
  const token = tokenOf(act.links[0].url);

  const played = playThrough(page, token, 'memory', { onAnswered: async (n) => { if (n === 2) await goOffline(context); } });
  const r = await played;
  expect(r.endText).toContain('نتیجه روی دستگاه ذخیره شد و بعداً ارسال می‌شود.');

  const pending = await readIdb(page, `pending:${token}`);
  expect(pending).toBeTruthy();
  expect(pending.events).toHaveLength(5);
  expect((await report(student.id)).completedActivities).toBe(0);           // nothing reached the server yet

  await goOnline(context);
  await expect(page.getByText('فعالیت تمام شد. می‌توانی این صفحه را ببندی.')).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => readIdb(page, `pending:${token}`)).toBeNull();

  let rep = await report(student.id);
  expect(rep.completedActivities).toBe(1);
  expect(skill(rep, 'memory').sessionCount).toBe(1);

  // Submit the same result twice more → still exactly one stored result.
  const st = await readIdb(page, `session:${token}`);
  for (let i = 0; i < 2; i++) {
    const d = await api.post(`/api/play/${token}/complete`, { data: { sessionId: st.sessionId, events: st.events } });
    expect((await d.json()).duplicate).toBe(true);
  }
  rep = await report(student.id);
  expect(skill(rep, 'memory')).toMatchObject({ sessionCount: 1, sampleCount: 5 });
});

test('closing the page mid-game resumes without repeating finished questions', async ({ page }) => {
  const act = await createActivity('problem_solving', [students[3].id]);
  const token = tokenOf(act.links[0].url);
  // Play 2 real questions, then "close the tab" (the bot throws right after the 2nd answer is saved).
  await expect(playThrough(page, token, 'problem_solving', { onAnswered: async (n) => { if (n === 2) throw new Error('close-tab'); } })).rejects.toThrow('close-tab');
  await page.waitForTimeout(300); // let the session state be written to IndexedDB
  const st = await readIdb(page, `session:${token}`);
  expect(st.events).toHaveLength(2);
  expect(st.finished).toBe(false);
  // Re-open: welcome + tutorial are skipped and the game continues with the remaining 3 questions.
  const r = await playThrough(page, token, 'problem_solving');
  expect(r.kind).toBe('end');
  // A repeated question would be dropped by the server, so sampleCount === 5 proves no repeats.
  expect(skill(await report(students[3].id), 'problem_solving')).toMatchObject({ sessionCount: 1, sampleCount: 5 });
});
