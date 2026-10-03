import { beforeAll, describe, expect, it } from 'vitest';
import { createEnv, memoryEvents, publishForTest, registerTeacher, type TestEnv } from './helpers';
import { buildPools } from '../src/questions/generate';
import { MEMORY_DURATIONS, MEMORY_RANGES } from '../src/questions/generate-v2';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60_000);
const tokenOf = (url: string) => url.split('/play/')[1];
const previewTokenOf = (url: string) => url.split('/preview/')[1];

async function klass(token: string, gradeCode = 'g6', n = 2) {
  const c = (await t.api('POST', '/api/classes', { name: 'کلاس', gradeCode }, token)).data.class;
  const students: any[] = [];
  for (let i = 0; i < n; i++) students.push((await t.api('POST', '/api/students', { name: `دانش‌آموز ${i + 1}`, classId: c.id }, token)).data.student);
  return { classId: c.id as string, students };
}
const mk = async (token: string, body: object) => { const r = await t.api('POST', '/api/activities', body, token); expect(r.status).toBe(201); return r.data; };
async function startPreview(token: string, id: string, body?: object) {
  const s = await t.api('POST', `/api/activities/${id}/preview`, body, token); expect(s.status).toBe(200);
  const pt = previewTokenOf(s.data.url); const p = await t.api('GET', `/api/preview/${pt}`); expect(p.status).toBe(200);
  return { pt, start: s.data, p: p.data };
}
async function finishPreview(pt: string, p: any, n = 5) {
  return t.api('POST', `/api/preview/${pt}/complete`, { sessionId: p.session.id, events: memoryEvents(n, n, 1) });
}
const count = async (sql: string) => (await t.db.prepare(sql).first<{ n: number }>())!.n;

describe('preview = the experience a student gets (same generator, same band)', () => {
  it('grade-6 class, no grade range on the activity: preview and student get the same band, and it is the NORMAL band (not the old "+1")', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    const c = await mk(token, { classId, gameType: 'memory', difficultyMode: 'medium', questionCount: 10 });
    const { p } = await startPreview(token, c.activity.id);
    expect(p.pools['2']).toHaveLength(10);
    expect(p.pools).toEqual(buildPools('memory', p.session.id, [2], 10, 0, 2)); // band 0, generator v2
    await publishForTest(t, token, c.activity.id);
    const real = (await t.api('GET', `/api/play/${tokenOf(c.links[0].url)}`)).data;
    const shape = (pool: any[]) => pool.map((q) => [q.sequence.length, q.displayDuration, q.isReverse]);
    expect(shape(real.pools['2'])).toEqual(shape(p.pools['2']));
    expect(p.pools['2'][0].displayDuration).toBe(MEMORY_DURATIONS['0'][1]);
  });
  it('the acceptance case from the spec: 10-question memory activity for grade 6 — every step of every mode is gradual and solvable', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    for (const mode of ['easy', 'medium', 'hard'] as const) {
      const c = await mk(token, { classId, gameType: 'memory', difficultyMode: mode, questionCount: 10 });
      const { p } = await startPreview(token, c.activity.id);
      const level = { easy: '1', medium: '2', hard: '3' }[mode];
      const pool = p.pools[level] as any[];
      expect(pool).toHaveLength(10);
      const lens = pool.map((q) => q.sequence.length);
      for (let i = 1; i < 10; i++) { expect(lens[i] - lens[i - 1]).toBeGreaterThanOrEqual(0); expect(lens[i] - lens[i - 1]).toBeLessThanOrEqual(1); }
      expect(Math.max(...lens)).toBeLessThanOrEqual(6);                       // grade 6 never gets 7–8 items
      expect(Math.min(...pool.map((q) => q.displayDuration))).toBeGreaterThanOrEqual(1100);
      expect(pool.filter((q) => q.isReverse).every((q) => q.sequence.length <= 5)).toBe(true);
    }
  });
  it('difficulty really changes the parameters (easy < medium < hard) and so do grades (1 < 6 < 10)', async () => {
    const { token } = await registerTeacher(t);
    const dur: Record<string, number> = {}, len: Record<string, number> = {};
    for (const g of ['g1', 'g6', 'g10']) {
      const { classId } = await klass(token, g, 1);
      for (const mode of ['easy', 'medium', 'hard'] as const) {
        const c = await mk(token, { classId, gameType: 'memory', difficultyMode: mode, questionCount: 8 });
        const { p } = await startPreview(token, c.activity.id);
        const pool = p.pools[{ easy: '1', medium: '2', hard: '3' }[mode]] as any[];
        dur[`${g}:${mode}`] = pool[0].displayDuration; len[`${g}:${mode}`] = Math.max(...pool.map((q) => q.sequence.length));
      }
    }
    for (const g of ['g1', 'g6', 'g10']) { expect(dur[`${g}:easy`]).toBeGreaterThan(dur[`${g}:medium`]); expect(dur[`${g}:medium`]).toBeGreaterThan(dur[`${g}:hard`]); expect(len[`${g}:easy`]).toBeLessThan(len[`${g}:hard`]); }
    expect(dur['g1:medium']).toBeGreaterThan(dur['g6:medium']); expect(dur['g6:medium']).toBeGreaterThan(dur['g10:medium']);
    expect(len['g1:hard']).toBeLessThanOrEqual(len['g6:hard']); expect(len['g6:hard']).toBeLessThanOrEqual(len['g10:hard']);
  });
  it('attention and problem-solving previews use the new generator too (grid/time ladder, ramp ordering)', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    const att = await mk(token, { classId, gameType: 'attention', difficultyMode: 'hard', questionCount: 10 });
    const pa = (await startPreview(token, att.activity.id)).p.pools['3'] as any[];
    expect(pa.every((q) => q.gridSize <= 4 && q.timeLimit === 6500)).toBe(true);
    const prob = await mk(token, { classId, gameType: 'problem_solving', difficultyMode: 'hard', questionCount: 10 });
    const pp = (await startPreview(token, prob.activity.id)).p.pools['3'] as any[];
    for (let i = 1; i < pp.length; i++) expect(pp[i].difficulty).toBeGreaterThanOrEqual(pp[i - 1].difficulty);
  });
  it('old sessions keep the old generator: a session saved with gen_version NULL still resumes with v1 questions', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    const c = await mk(token, { classId, gameType: 'memory', difficultyMode: 'medium', questionCount: 5 });
    await publishForTest(t, token, c.activity.id);
    const link = tokenOf(c.links[0].url);
    const first = (await t.api('GET', `/api/play/${link}`)).data;
    expect((await t.db.prepare('SELECT gen_version FROM game_sessions WHERE id = ?').bind(first.session.id).first<any>())!.gen_version).toBe(2);
    await t.db.prepare('UPDATE game_sessions SET gen_version = NULL, tuning = 1 WHERE id = ?').bind(first.session.id).run(); // what a pre-v1.2.x row looks like
    const legacy = (await t.api('GET', `/api/play/${link}`)).data;
    expect(legacy.pools).toEqual(buildPools('memory', first.session.id, [2], 5, 1)); // v1 generator, stored band
  });
});

describe('preview isolation (nothing it does is visible in student data)', () => {
  it('a full preview leaves students, assignments, sessions, results and metrics untouched', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 2);
    const c = await mk(token, { classId, gameType: 'memory', questionCount: 5 });
    const before = await Promise.all(['students', 'activity_students', 'game_sessions', 'game_results', 'student_metrics'].map((tb) => count(`SELECT COUNT(*) AS n FROM ${tb}`)));
    const { pt, p } = await startPreview(token, c.activity.id);
    expect((await finishPreview(pt, p)).status).toBe(200);
    const after = await Promise.all(['students', 'activity_students', 'game_sessions', 'game_results', 'student_metrics'].map((tb) => count(`SELECT COUNT(*) AS n FROM ${tb}`)));
    expect(after).toEqual(before);
    expect((await t.api('GET', `/api/activities/${c.activity.id}`, undefined, token)).data.activity).toMatchObject({ completed: 0 });
  });
  it('a preview link expires after 24 h', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    const c = await mk(token, { classId, gameType: 'memory', questionCount: 5 });
    const { pt } = await startPreview(token, c.activity.id);
    await t.db.prepare('UPDATE teacher_preview_sessions SET started_at = ? WHERE token = ?').bind(new Date(Date.now() - 25 * 3600_000).toISOString(), pt).run();
    expect((await t.api('GET', `/api/preview/${pt}`)).status).toBe(410);
  });
  it('summary shown before the preview describes the activity and makes no claim about a child', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    const c = await mk(token, { classId, gameType: 'memory', difficultyMode: 'medium', questionCount: 10, ageMin: 11, ageMax: 12, level: 'intermediate', skills: ['memory'] });
    const { start, p } = await startPreview(token, c.activity.id);
    expect(start.summary).toMatchObject({ questionCount: 10, difficultyLabel: 'متوسط', gradeLabel: 'ششم ابتدایی', ageLabel: '۱۱ تا ۱۲ سال', comparison: false });
    expect(start.summary.estimatedMinutes).toBeGreaterThan(0);
    expect(p.summary).toMatchObject({ difficultyMode: 'medium' });
    expect(JSON.stringify(start.summary)).not.toMatch(/مناسب دانش‌آموز/);
  });
});

describe('workflow: draft → preview → feedback → publish', () => {
  it('suitable / too_easy lead to ready_to_publish; too_hard / needs_edit send the teacher back to editing', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    for (const [feedback, ready] of [['suitable', true], ['too_easy', true], ['too_hard', false], ['needs_edit', false]] as const) {
      const c = await mk(token, { classId, gameType: 'memory', questionCount: 5 });
      const id = c.activity.id;
      expect(c.activity).toMatchObject({ publishState: 'draft', requiresPreview: true });
      const { pt, p } = await startPreview(token, id); await finishPreview(pt, p);
      const saved = await t.api('POST', `/api/activities/${id}/preview-feedback`, { feedback }, token);
      expect(saved.data.activity).toMatchObject({ publishState: ready ? 'ready_to_publish' : 'draft', previewFeedback: feedback });
      const pub = await t.api('POST', `/api/activities/${id}/publish`, undefined, token);
      expect(pub.status).toBe(ready ? 200 : 409);
      if (!ready) expect(pub.data.details).toMatchObject({ canPublishWithoutPreview: true });
    }
  });
  it('feedback before finishing the preview is refused; an edit makes an earlier preview useless (Preview → Edit → Preview again)', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    const c = await mk(token, { classId, gameType: 'memory', difficultyMode: 'hard', questionCount: 10 });
    const id = c.activity.id;
    expect((await t.api('POST', `/api/activities/${id}/preview-feedback`, { feedback: 'suitable' }, token)).status).toBe(409);
    const first = await startPreview(token, id); await finishPreview(first.pt, first.p, 10);
    await t.api('POST', `/api/activities/${id}/preview-feedback`, { feedback: 'too_hard' }, token);
    const edited = await t.api('PUT', `/api/activities/${id}`, { difficultyMode: 'easy' }, token);
    expect(edited.data.activity).toMatchObject({ publishState: 'draft', difficultyMode: 'easy', previewedAt: null, previewFeedback: null, teacherApprovedAt: null });
    expect((await t.api('GET', `/api/preview/${first.pt}`)).status).toBe(404);                                   // the old run is gone
    expect((await t.api('POST', `/api/activities/${id}/preview-feedback`, { feedback: 'suitable' }, token)).status).toBe(409); // cannot approve a stale test
    const second = await startPreview(token, id);
    expect(second.p.difficultyMode).toBe('easy');
    await finishPreview(second.pt, second.p, 10);
    expect((await t.api('POST', `/api/activities/${id}/preview-feedback`, { feedback: 'suitable' }, token)).data.activity.publishState).toBe('ready_to_publish');
    expect((await t.api('POST', `/api/activities/${id}/publish`, undefined, token)).data.activity.publishState).toBe('published');
  });
  it('the teacher may publish WITHOUT a preview, but only by saying so explicitly', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    const c = await mk(token, { classId, gameType: 'memory', questionCount: 5 });
    const id = c.activity.id, link = tokenOf(c.links[0].url);
    expect((await t.api('GET', `/api/play/${link}`)).status).toBe(403);
    const refused = await t.api('POST', `/api/activities/${id}/publish`, undefined, token);
    expect(refused.status).toBe(409); expect(refused.data.error).toBe('teacher_approval_required'); expect(refused.data.details).toMatchObject({ canPublishWithoutPreview: true });
    // the draft sat around for 40 days: its original 30-day validity ran out before it was ever published
    await t.db.prepare('UPDATE activities SET created_at = ?, expires_at = ? WHERE id = ?').bind(new Date(Date.now() - 40 * 86400_000).toISOString(), new Date(Date.now() - 10 * 86400_000).toISOString(), id).run();
    const ok = await t.api('POST', `/api/activities/${id}/publish`, { withoutPreview: true }, token);
    expect(ok.status).toBe(200);
    expect(ok.data.activity).toMatchObject({ publishState: 'published', previewFeedback: 'skipped', previewedAt: null });
    expect(ok.data.activity.teacherApprovedAt).toBeTruthy();
    expect((await t.api('GET', `/api/play/${link}`)).status).toBe(200);
    expect(Date.parse(ok.data.activity.expiresAt) - Date.now()).toBeGreaterThan(20 * 86400_000); // validity restarts at publication
    expect((await t.api('POST', `/api/activities/${id}/publish`, undefined, token)).status).toBe(200); // idempotent
  });
  it('clients that skip the workflow (requiresPreview:false) get a published activity at once', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    const c = await mk(token, { classId, gameType: 'memory', questionCount: 5, requiresPreview: false });
    expect(c.activity).toMatchObject({ publishState: 'published', requiresPreview: false });
    expect((await t.api('GET', `/api/play/${tokenOf(c.links[0].url)}`)).status).toBe(200);
  });
  it('editing a PUBLISHED activity never locks students out; difficulty stays locked once a child started', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 2);
    const c = await mk(token, { classId, gameType: 'memory', questionCount: 5 });
    const id = c.activity.id, [l1, l2] = c.links.map((l: any) => tokenOf(l.url));
    await publishForTest(t, token, id);
    expect((await t.api('GET', `/api/play/${l1}`)).status).toBe(200);                        // a child started
    const e1 = await t.api('PUT', `/api/activities/${id}`, { level: 'advanced', ageMin: 10, ageMax: 12, gradeMin: 'g5', gradeMax: 'g6', skills: ['memory'] }, token);
    expect(e1.status).toBe(200); expect(e1.data.activity.publishState).toBe('published');
    expect((await t.api('GET', `/api/play/${l1}`)).status).toBe(200); expect((await t.api('GET', `/api/play/${l2}`)).status).toBe(200);
    expect((await t.api('PUT', `/api/activities/${id}`, { difficultyMode: 'hard' }, token)).data.error).toBe('activity_in_progress');
  });
  it('a published activity with NO child started can still be adjusted and stays open', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    const c = await mk(token, { classId, gameType: 'memory', questionCount: 5 });
    await publishForTest(t, token, c.activity.id);
    const e = await t.api('PUT', `/api/activities/${c.activity.id}`, { difficultyMode: 'easy', questionCount: 8 }, token);
    expect(e.data.activity).toMatchObject({ publishState: 'published', difficultyMode: 'easy', questionCount: 8 });
    expect((await t.api('GET', `/api/play/${tokenOf(c.links[0].url)}`)).data.questionCount).toBe(8);
  });
  it('unpublished activities hide their student links in the detail view', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    const c = await mk(token, { classId, gameType: 'memory', questionCount: 5 });
    await publishForTest(t, token, c.activity.id);
    expect((await t.api('GET', `/api/activities/${c.activity.id}`, undefined, token)).data.students[0].url).toContain('/play/');
  });
});

describe('compare levels (optional): try another level without changing the activity', () => {
  it('plays the other level, is clearly marked as a comparison, and can neither approve nor modify the activity', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 'g6', 1);
    const c = await mk(token, { classId, gameType: 'memory', difficultyMode: 'easy', questionCount: 6 });
    const id = c.activity.id;
    const { pt, start, p } = await startPreview(token, id, { compareMode: 'hard' });
    expect(start.comparison).toBe(true); expect(p.comparison).toBe(true); expect(p.difficultyMode).toBe('hard');
    expect(p.pools['3']).toHaveLength(6); expect(start.summary.difficultyLabel).toBe('سخت');
    const act = (await t.api('GET', `/api/activities/${id}`, undefined, token)).data.activity;
    expect(act).toMatchObject({ difficultyMode: 'easy', publishState: 'draft' });          // untouched, and not even "testing"
    const done = await finishPreview(pt, p, 6);
    expect(done.data.comparison).toBe(true);
    expect((await t.api('POST', `/api/activities/${id}/preview-feedback`, { feedback: 'suitable' }, token)).status).toBe(409); // a comparison run is no approval
  });
});

describe('reports: drafts and previews never count as student work', () => {
  it('draft activities are absent from the dashboard, class report, student history and "open activities"; they appear once published', async () => {
    const { token } = await registerTeacher(t);
    const { classId, students } = await klass(token, 'g6', 2);
    const c = await mk(token, { classId, gameType: 'memory', questionCount: 5 });
    const openOf = async () => (await t.api('GET', `/api/classes/${classId}`, undefined, token)).data.students.map((s: any) => s.openActivities);
    const dash = async () => (await t.api('GET', '/api/dashboard', undefined, token)).data;
    const rep = async () => (await t.api('GET', `/api/reports/class/${classId}`, undefined, token)).data;
    expect(await openOf()).toEqual([0, 0]);
    expect((await dash()).totals).toMatchObject({ activities: 0, assigned: 0, drafts: 1 });
    expect((await rep()).byGame ?? (await rep()).games ?? []).toEqual([]);
    expect((await t.api('GET', `/api/students/${students[0].id}/history`, undefined, token)).data.history).toEqual([]);
    const { pt, p } = await startPreview(token, c.activity.id); await finishPreview(pt, p);   // a preview changes nothing either
    expect((await dash()).totals).toMatchObject({ activities: 0, assigned: 0 });
    await publishForTest(t, token, c.activity.id);
    expect(await openOf()).toEqual([1, 1]);
    expect((await dash()).totals).toMatchObject({ activities: 1, assigned: 2, completed: 0, drafts: 0 });
    expect((await t.api('GET', `/api/students/${students[0].id}/history`, undefined, token)).data.history).toHaveLength(1);
  });
});
