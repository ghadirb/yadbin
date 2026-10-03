// The REAL session controller playing a teacher preview against the REAL Worker.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEnv, registerTeacher, type TestEnv } from '../../worker/test/helpers';
import { runSession, type GameUi } from '../src/session/controller';
import { buildMemoryEvent } from '../src/question-engine/events';
import { MemoryKv } from '../src/storage/kv';
import type { PlayApi } from '../src/sync/api';
import type { PreviewInfo } from '../src/question-engine/types';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60000);
afterAll(async () => { await t?.dispose(); });

const previewApi = (): PlayApi => {
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await t.api(method, path, body);
    return r.status < 300 ? { kind: 'ok' as const, data: r.data } : { kind: 'http' as const, status: r.status, error: r.data?.error, message: r.data?.message };
  };
  return { getPlay: (tk) => call('GET', `/api/preview/${tk}`), complete: (tk, p) => call('POST', `/api/preview/${tk}/complete`, p) };
};

describe('teacher preview in the student web app', () => {
  it('shows the teacher the summary first, plays the production questions, never touches student data, and ends on the teacher screen', async () => {
    const { token } = await registerTeacher(t);
    const cls = (await t.api('POST', '/api/classes', { name: 'ششم', gradeCode: 'g6' }, token)).data.class;
    await t.api('POST', '/api/students', { name: 'دانش‌آموز', classId: cls.id }, token);
    const act = (await t.api('POST', '/api/activities', { classId: cls.id, gameType: 'memory', difficultyMode: 'medium', questionCount: 10 }, token)).data.activity;
    const started = (await t.api('POST', `/api/activities/${act.id}/preview`, undefined, token)).data;
    const pt = started.url.split('/preview/')[1];

    const seen: { welcome?: PreviewInfo; ended?: string; questions: number; lens: number[] } = { questions: 0, lens: [] };
    const ui: GameUi = {
      async welcome(p) { seen.welcome = p; },
      async tutorial() {},
      async playQuestion(_g, q) { seen.questions++; seen.lens.push(q.sequence.length); return buildMemoryEvent(q, q.isReverse ? [...q.sequence].reverse() : q.sequence, 1500); },
      end(kind) { seen.ended = kind; },
      error(kind, m) { throw new Error(`ui.error ${kind} ${m}`); },
    };
    const before = await Promise.all(['students', 'activity_students', 'game_sessions', 'game_results', 'student_metrics'].map(async (tb) => (await t.db.prepare(`SELECT COUNT(*) AS n FROM ${tb}`).first<{ n: number }>())!.n));
    expect(await runSession({ token: pt, api: previewApi(), store: new MemoryKv(), ui })).toBe('finished');

    expect(seen.welcome?.summary).toMatchObject({ gameName: 'به خاطر بسپار', questionCount: 10, difficultyLabel: 'متوسط', comparison: false });
    expect(seen.welcome?.comparison).toBe(false);
    expect(seen.questions).toBe(10);
    expect(Math.max(...seen.lens)).toBeLessThanOrEqual(6);                          // grade 6, medium: the normal band
    for (let i = 1; i < seen.lens.length; i++) expect(seen.lens[i] - seen.lens[i - 1]).toBeLessThanOrEqual(1); // no jump
    expect(seen.ended).toBe('sent');
    const after = await Promise.all(['students', 'activity_students', 'game_sessions', 'game_results', 'student_metrics'].map(async (tb) => (await t.db.prepare(`SELECT COUNT(*) AS n FROM ${tb}`).first<{ n: number }>())!.n));
    expect(after).toEqual(before);
    // the teacher can now give the verdict, because the run was completed
    expect((await t.api('POST', `/api/activities/${act.id}/preview-feedback`, { feedback: 'suitable' }, token)).data.activity.publishState).toBe('ready_to_publish');
  });
});
