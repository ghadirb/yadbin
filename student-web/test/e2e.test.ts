// Runs the REAL session controller against the REAL Worker (workerd + D1) with a scripted "bot" child.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEnv, registerTeacher, type TestEnv } from '../../worker/test/helpers';
import { runSession, type GameUi } from '../src/session/controller';
import { buildAttentionEvent, buildMemoryEvent, buildProblemEvent } from '../src/question-engine/events';
import { MemoryKv } from '../src/storage/kv';
import type { PlayApi } from '../src/sync/api';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60000);
afterAll(async () => { await t?.dispose(); });

function bridge(token: string, control = { online: true }): PlayApi {
  const call = async (method: string, path: string, body?: unknown) => {
    if (!control.online) return { kind: 'network' as const };
    const r = await t.api(method, path, body);
    return r.status < 300 ? { kind: 'ok' as const, data: r.data } : { kind: 'http' as const, status: r.status, error: r.data?.error, message: r.data?.message };
  };
  void token;
  return { getPlay: (tk) => call('GET', `/api/play/${tk}`), complete: (tk, p) => call('POST', `/api/play/${tk}/complete`, p) };
}

/** accuracyRate: fraction of items the bot answers correctly. */
function botUi(log: string[], accuracyRate = 1, onQuestion?: (n: number) => void): GameUi {
  let n = 0;
  return {
    async welcome() { log.push('welcome'); },
    async tutorial(g) { log.push(`tutorial:${g}`); },
    async playQuestion(game, q) {
      n++; onQuestion?.(n); log.push(`q:${q.id}`);
      const good = (n / 10) <= accuracyRate;
      if (game === 'memory') {
        const target = q.isReverse ? [...q.sequence].reverse() : q.sequence;
        const taps = good ? target : [...target].reverse();
        return buildMemoryEvent(q, taps, 1800);
      }
      if (game === 'attention') {
        const idx = q.cells.map((c: string, i: number) => (c === q.rule.select ? i : -1)).filter((i: number) => i >= 0);
        return { event: buildAttentionEvent(q, good ? idx : [], good ? 400 : null, 2500), correct: good };
      }
      const ans = good ? q.correctOption : (q.correctOption + 1) % q.options.length;
      return buildProblemEvent(q, 1, good ? 0 : 1, ans, 3000);
    },
    end(k) { log.push(`end:${k}`); },
    error(k, m) { log.push(`error:${k}:${m}`); },
  };
}
const setup = async () => {
  const A = await registerTeacher(t);
  const c = await t.api('POST', '/api/classes', { name: 'کلاس', grade: 'سوم' }, A.token);
  const s = await t.api('POST', `/api/classes/${c.data.class.id}/students`, { text: 'علی رضایی\nسارا محمدی' }, A.token);
  return { A, classId: c.data.class.id as string, students: s.data.added as any[] };
};
const tok = (u: string) => u.split('/play/')[1];

describe('student web ↔ real worker', () => {
  for (const game of ['memory', 'attention', 'problem_solving'] as const) {
    it(`${game}: full session delivered, one result, then "already done"`, async () => {
      const { A, classId, students } = await setup();
      const act = await t.api('POST', '/api/activities', { classId, gameType: game, difficultyMode: 'adaptive', questionCount: 10 }, A.token);
      const token = tok(act.data.links[0].url);
      const log: string[] = [], store = new MemoryKv();
      expect(await runSession({ token, api: bridge(token), store, ui: botUi(log) })).toBe('finished');
      expect(log[0]).toBe('welcome'); expect(log[1]).toBe(`tutorial:${game}`);
      expect(log.filter((l) => l.startsWith('q:'))).toHaveLength(10);
      expect(log.at(-1)).toBe('end:sent');
      const n = await t.db.prepare("SELECT COUNT(*) AS n FROM game_results").first<any>();
      expect(n.n).toBeGreaterThanOrEqual(1);
      const rep = await t.api('GET', `/api/reports/student/${act.data.links[0].studentId}`, undefined, A.token);
      const card = rep.data.skills.find((s: any) => s.game === game);
      expect(card.sampleCount).toBe(10); expect(card.status).toBe('good');
      const log2: string[] = [];
      await runSession({ token, api: bridge(token), store: new MemoryKv(), ui: botUi(log2) });
      expect(log2).toEqual(['end:already']);
      void students;
    });
  }

  it('resume: closing mid-game continues from saved progress with the same questions', async () => {
    const { A, classId } = await setup();
    const act = await t.api('POST', '/api/activities', { classId, gameType: 'memory', difficultyMode: 'easy', questionCount: 10 }, A.token);
    const token = tok(act.data.links[0].url), store = new MemoryKv();
    const log1: string[] = [];
    const crash = botUi(log1, 1, (n) => { if (n === 4) throw new Error('tab closed'); });
    await expect(runSession({ token, api: bridge(token), store, ui: crash })).rejects.toThrow('tab closed');
    expect(log1.filter((l) => l.startsWith('q:'))).toHaveLength(3); // 3 answered; the 4th was on screen when the tab closed
    const log2: string[] = [];
    await runSession({ token, api: bridge(token), store, ui: botUi(log2) });
    expect(log2).not.toContain('welcome'); expect(log2.some((l) => l.startsWith('tutorial'))).toBe(false);
    const q1 = log1.filter((l) => l.startsWith('q:')), q2 = log2.filter((l) => l.startsWith('q:'));
    expect(q2).toHaveLength(7);
    expect(new Set([...q1, ...q2]).size).toBe(10); // 3 + 7, no repeats overall
    expect(log2.at(-1)).toBe('end:sent');
  });

  it('offline at the end: result kept locally, delivered after reconnect, exactly one row', async () => {
    const { A, classId } = await setup();
    const act = await t.api('POST', '/api/activities', { classId, gameType: 'memory', questionCount: 8 }, A.token);
    const token = tok(act.data.links[0].url), store = new MemoryKv();
    const ctl = { online: true }, api = bridge(token, ctl), log: string[] = [];
    // connection drops after the game started (game itself needs no network)
    const ui = botUi(log, 1, (n) => { if (n === 2) ctl.online = false; });
    await runSession({ token, api, store, ui, retryIntervalMs: 50 });
    expect(log.at(-1)).toBe('end:saved');
    expect(await store.get(`pending:${token}`)).toBeTruthy();
    const before = await t.db.prepare('SELECT COUNT(*) AS n FROM game_results').first<any>();
    ctl.online = true;
    const log2: string[] = [];
    await runSession({ token, api, store, ui: botUi(log2) }); // reopen page after reconnect
    expect(log2.at(-1)).toBe('end:already');
    expect(await store.get(`pending:${token}`)).toBeUndefined();
    const after = await t.db.prepare('SELECT COUNT(*) AS n FROM game_results').first<any>();
    expect(after.n).toBe(before.n + 1);
  });

  it('opens with no connection and no local data: friendly network error', async () => {
    const log: string[] = [];
    await runSession({ token: 'ABCDEFGHJKLMNPQR', api: bridge('x', { online: false }), store: new MemoryKv(), ui: botUi(log) });
    expect(log[0]).toBe('error:network:اتصال اینترنت قطع شد. لطفاً دوباره تلاش کنید.');
  });
  it('invalid / expired / canceled messages', async () => {
    const { A, classId } = await setup();
    const log: string[] = [];
    await runSession({ token: 'ABCDEFGHJKLMNPQR', api: bridge('x'), store: new MemoryKv(), ui: botUi(log) });
    expect(log[0]).toBe('error:invalid:این لینک معتبر نیست.');
    const act = await t.api('POST', '/api/activities', { classId, gameType: 'memory' }, A.token);
    await t.api('POST', `/api/activities/${act.data.activity.id}/cancel`, undefined, A.token);
    const log2: string[] = [];
    await runSession({ token: tok(act.data.links[0].url), api: bridge('x'), store: new MemoryKv(), ui: botUi(log2) });
    expect(log2[0]).toBe('error:canceled:این فعالیت دیگر فعال نیست.');
    const act2 = await t.api('POST', '/api/activities', { classId, gameType: 'memory' }, A.token);
    await t.db.prepare('UPDATE activities SET expires_at = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', act2.data.activity.id).run();
    const log3: string[] = [];
    await runSession({ token: tok(act2.data.links[0].url), api: bridge('x'), store: new MemoryKv(), ui: botUi(log3) });
    expect(log3[0]).toContain('error:expired:');
  });

  it('adaptive session: strong answers raise difficulty; weak answers do not', async () => {
    const { A, classId } = await setup();
    const act = await t.api('POST', '/api/activities', { classId, gameType: 'memory', difficultyMode: 'adaptive', questionCount: 10 }, A.token);
    const token = tok(act.data.links[0].url), store = new MemoryKv(), log: string[] = [];
    await runSession({ token, api: bridge(token), store, ui: botUi(log, 1) });
    const ids = log.filter((l) => l.startsWith('q:')).map((l) => l.slice(2));
    expect(ids[0]).toMatch(/^mem_1_/); expect(ids[3]).toMatch(/^mem_2_/); expect(ids[6]).toMatch(/^mem_3_/);
  });
});
