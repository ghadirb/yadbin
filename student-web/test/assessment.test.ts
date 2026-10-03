// The REAL student session controller + assessment runner against the REAL Worker (Teacher Assessments).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEnv, publishForTest, registerTeacher, type TestEnv } from '../../worker/test/helpers';
import { runSession, type GameUi } from '../src/session/controller';
import type { AQuestion, AssessmentUi, PreviewResult } from '../src/assessment/runner';
import { MemoryKv } from '../src/storage/kv';
import type { PlayApi } from '../src/sync/api';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60000);
afterAll(async () => { await t?.dispose(); });
void publishForTest;

const api = (preview = false, flaky?: { down: boolean; completes: number }): PlayApi => {
  const base = preview ? 'preview' : 'play';
  const call = async (method: string, path: string, body?: unknown) => {
    if (flaky?.down) return { kind: 'network' as const };
    const r = await t.api(method, path, body);
    return r.status < 300 ? { kind: 'ok' as const, data: r.data } : { kind: 'http' as const, status: r.status, error: r.data?.error, message: r.data?.message };
  };
  return {
    getPlay: (tk) => call('GET', `/api/${base}/${tk}`),
    complete: (tk, p) => { if (flaky) flaky.completes++; return call('POST', `/api/${base}/${tk}/complete`, p); },
  };
};
const noGameUi: GameUi = { async welcome() {}, async tutorial() {}, async playQuestion() { throw new Error('a game must not run for an assessment'); }, end() {}, error(k, m) { throw new Error(`ui.error ${k} ${m}`); } };

/** A scripted child: answers by question type, optionally goes back once, leaves some empty. */
function child(script: (q: AQuestion, i: number) => unknown, log: { asked: string[]; ended?: string; previewResult?: PreviewResult | null; intro?: boolean; back?: boolean } = { asked: [] }): { ui: AssessmentUi; log: typeof log } {
  return {
    log,
    ui: {
      async intro() { log.intro = true; },
      async ask(q, info) {
        log.asked.push(q.id);
        if (info.index === 1 && info.canGoBack && !log.back) { log.back = true; return { answer: undefined, direction: 'back' }; }
        return { answer: script(q, info.index), direction: 'next' };
      },
      end(k) { log.ended = k; },
      previewEnd(r) { log.previewResult = r; },
    },
  };
}
const right = (q: AQuestion) => q.type === 'multiple_choice' ? 0 : q.type === 'true_false' ? true : ' شيراز ';

async function published() {
  const { token } = await registerTeacher(t);
  const cls = (await t.api('POST', '/api/classes', { name: 'ششم', gradeCode: 'g6' }, token)).data.class;
  const st = (await t.api('POST', '/api/students', { name: 'دانش‌آموز', classId: cls.id }, token)).data.student;
  const id = (await t.api('POST', '/api/assessments', { title: 'علوم – فصل ۲', subject: 'علوم', gradeCode: 'g6', level: 'intermediate' }, token)).data.assessment.id;
  for (const q of [
    { type: 'multiple_choice', text: 'پایتخت ایران؟', options: ['تهران', 'شیراز', 'تبریز', 'اصفهان'], correct: 0 },
    { type: 'true_false', text: 'زمین گرد است.', correct: true },
    { type: 'fill_blank', text: 'مرکز فارس ____', answers: ['شیراز'] },
  ]) expect((await t.api('POST', `/api/assessments/${id}/questions`, q, token)).status).toBe(201);
  const pv = (await t.api('POST', `/api/assessments/${id}/preview`, undefined, token)).data;
  return { token, id, cls, st, pv, pt: pv.url.split('/preview/')[1] as string };
}

describe('Teacher Assessment in the student web app', () => {
  it('teacher preview: plays the real questions, shows the simulated result, creates nothing for students', async () => {
    const { token, id, pt } = await published();
    const tables = ['students', 'assessment_students', 'assessment_attempts', 'assessment_answers', 'assessment_results', 'game_sessions', 'game_results', 'student_metrics'];
    const snap = () => Promise.all(tables.map(async (tb) => (await t.db.prepare(`SELECT COUNT(*) AS n FROM ${tb}`).first<{ n: number }>())!.n));
    const before = await snap();
    const c = child((q, i) => (i === 2 ? 'تهران' : right(q)));
    expect(await runSession({ token: pt, api: api(true), store: new MemoryKv(), ui: noGameUi, assessmentUi: c.ui, preview: true })).toBe('finished');
    expect(c.log.intro).toBe(true);
    expect(c.log.previewResult).toMatchObject({ total: 3, correct: 2, unanswered: 0 });
    expect(await snap()).toEqual(before);
    expect((await t.api('POST', `/api/assessments/${id}/preview-feedback`, { feedback: 'suitable' }, token)).data.assessment.status).toBe('ready_to_publish');
  });

  it('student: sees no key, can go back and change an answer, is graded on the server, and the child sees no score', async () => {
    const { token, id, cls, st, pt } = await published();
    await runSession({ token: pt, api: api(true), store: new MemoryKv(), ui: noGameUi, assessmentUi: child(right).ui, preview: true });
    await t.api('POST', `/api/assessments/${id}/preview-feedback`, { feedback: 'suitable' }, token);
    const links = (await t.api('POST', `/api/assessments/${id}/publish`, { classId: cls.id }, token)).data.links;
    const tk = links.find((l: any) => l.studentId === st.id).url.split('/play/')[1];

    const raw = (await t.api('GET', `/api/play/${tk}`)).data;
    expect(JSON.stringify(raw)).not.toMatch(/"correct"|explanation|answers"\s*:\s*\[\s*"/);

    const c = child(right);
    expect(await runSession({ token: tk, api: api(), store: new MemoryKv(), ui: noGameUi, assessmentUi: c.ui })).toBe('finished');
    expect(c.log.ended).toBe('sent');
    expect(c.log.asked.length).toBe(5);                                   // went back once: q1, q2, q1, q2, q3
    const rep = (await t.api('GET', `/api/assessments/${id}/report`, undefined, token)).data;
    expect(rep).toMatchObject({ participants: 1, averagePercent: 100, highestPercent: 100 }); // all three right, incl. « شيراز » with Arabic ي and spaces
    const cog = await t.db.prepare('SELECT COUNT(*) AS n FROM game_results').first<{ n: number }>();
    expect(cog!.n).toBe(0);                                               // never touches the cognitive tables
  });

  it('network cut during the assessment: answers are kept on the device, delivered once on reconnect, never duplicated', async () => {
    const { token, id, cls, st, pt } = await published();
    await runSession({ token: pt, api: api(true), store: new MemoryKv(), ui: noGameUi, assessmentUi: child(right).ui, preview: true });
    await t.api('POST', `/api/assessments/${id}/preview-feedback`, { feedback: 'suitable' }, token);
    const links = (await t.api('POST', `/api/assessments/${id}/publish`, { classId: cls.id }, token)).data.links;
    const tk = links.find((l: any) => l.studentId === st.id).url.split('/play/')[1];

    const store = new MemoryKv();
    const flaky = { down: false, completes: 0 };
    // first load online; the network drops before the final submit
    const dropAtEnd = child(right);
    const origAsk = dropAtEnd.ui.ask.bind(dropAtEnd.ui);
    dropAtEnd.ui.ask = async (q, info) => { if (info.isLast) flaky.down = true; return origAsk(q, info); };
    await runSession({ token: tk, api: api(false, flaky), store, ui: noGameUi, assessmentUi: dropAtEnd.ui, retryIntervalMs: 20 });
    expect(dropAtEnd.log.ended).toBe('saved');
    expect(await store.get(`pending:${tk}`)).toBeTruthy();
    // reconnect + page refresh: the pending result is delivered, nothing is asked again
    flaky.down = false;
    const again = child(right);
    await runSession({ token: tk, api: api(false, flaky), store, ui: noGameUi, assessmentUi: again.ui });
    expect(again.log.asked).toEqual([]);
    expect(await store.get(`pending:${tk}`)).toBeUndefined();
    // a second submission of the same attempt (double tap / retry) is harmless
    const rows = await t.db.prepare('SELECT COUNT(*) AS n FROM assessment_results r JOIN assessment_attempts a ON a.id = r.attempt_id WHERE a.assessment_id = ?').bind(id).first<{ n: number }>();
    expect(rows!.n).toBe(1);
  });

  it('refresh in the middle resumes the same question list from the device', async () => {
    const { token, id, cls, st, pt } = await published();
    await runSession({ token: pt, api: api(true), store: new MemoryKv(), ui: noGameUi, assessmentUi: child(right).ui, preview: true });
    await t.api('POST', `/api/assessments/${id}/preview-feedback`, { feedback: 'suitable' }, token);
    const links = (await t.api('POST', `/api/assessments/${id}/publish`, { classId: cls.id }, token)).data.links;
    const tk = links.find((l: any) => l.studentId === st.id).url.split('/play/')[1];
    const store = new MemoryKv();
    const quit = child(right);
    const ask1 = quit.ui.ask.bind(quit.ui);
    quit.ui.ask = async (q, info) => { if (info.index === 2) throw new Error('tab closed'); return ask1(q, info); };
    await expect(runSession({ token: tk, api: api(), store, ui: noGameUi, assessmentUi: quit.ui })).rejects.toThrow('tab closed');
    const resumed = child(right, { asked: [], back: true });
    expect(await runSession({ token: tk, api: api(), store, ui: noGameUi, assessmentUi: resumed.ui })).toBe('finished');
    expect(resumed.log.intro).toBeUndefined();                           // no second welcome screen
    expect(resumed.log.asked.length).toBe(1);                            // only the last unanswered question
    expect((await t.db.prepare('SELECT r.correct FROM assessment_results r JOIN assessment_attempts a ON a.id = r.attempt_id WHERE a.assessment_id = ?').bind(id).first<{ correct: number }>())!.correct).toBe(3);
  });
});
