import { describe, expect, it } from 'vitest';
import { GAME_IDS, levelCeiling, levelFloor, playBot, type GameId } from '../../core/kids';
import type { ApiResult } from '../src/sync/api';
import type { KidsApi } from '../src/kids/api';
import { KidsEngine, QUEUE_PREFIX, streakOf } from '../src/kids/engine';
import { MemoryKv } from '../src/storage/kv';

type Mode = 'online' | 'offline' | 'server_error' | 'bad_request';
function fakeApi(mode: { v: Mode }, log: any[] = []) {
  const seen = new Set<string>();
  const ok = (data: any): ApiResult<any> => ({ kind: 'ok', data });
  const api: KidsApi = {
    profile: async () => (mode.v === 'offline' ? { kind: 'network' } : ok({ name: 'سارا', avatar: '🦊', age: 7, xp: 0, stars: 0, badges: [], worlds: ['forest'] })),
    progress: async () => (mode.v === 'offline' ? { kind: 'network' } : ok({ gamesPlayed: 0, sync: undefined })),
    journey: async () => ({ kind: 'network' }),
    result: async (p: any) => {
      if (mode.v === 'offline') return { kind: 'network' };
      if (mode.v === 'server_error') return { kind: 'http', status: 503, error: 'x', message: 'x' };
      if (mode.v === 'bad_request') return { kind: 'http', status: 400, error: 'validation_error', message: 'x' };
      log.push(p.sessionId); const dup = seen.has(p.sessionId); seen.add(p.sessionId);
      return ok({ ok: true, duplicate: dup, result: {}, sync: Object.fromEntries(GAME_IDS.map((g) => [g, { level: 4, history: [], sessionsAtLevel: 0, cooldown: 0, plays: 99, bestPerformance: 0.5, lastTheme: null }])) });
    },
    parent: {} as any,
  };
  return api;
}
async function setup(mode: Mode = 'offline') {
  const store = new MemoryKv(); const m = { v: mode }; const log: any[] = []; let clock = Date.parse('2026-03-10T08:00:00Z');
  const eng = new KidsEngine(store, fakeApi(m, log), () => (clock += 4_000));
  await eng.setToken('kc_' + 'A'.repeat(32)); await eng.refresh();
  await store.set('kids:profile', { name: 'سارا', avatar: '🦊', age: 7, xp: 0, stars: 0, gamesPlayed: 0, badges: [], worlds: ['forest'] });
  return { eng, store, m, log };
}
const play = (eng: KidsEngine, g: GameId, acc = 1, level = 4, id?: string) => eng.finishGame(playBot(g, level, `s-${Math.random()}`, acc), { sessionId: id ?? `id-${Math.random().toString(36).slice(2, 12)}` });

describe('offline-first engine', () => {
  it('works completely offline: journey, play, rewards, adaptive — and queues the results', async () => {
    const { eng, store } = await setup('offline');
    const j = await eng.journey();
    expect(j.fromServer).toBe(false); expect(j.journey.items).toHaveLength(3); expect(new Set(j.journey.items.map((i) => i.skill)).size).toBe(3);
    for (const i of j.journey.items) { expect(i.level).toBeLessThanOrEqual(levelCeiling(7)); expect(i.level).toBeGreaterThanOrEqual(levelFloor(7)); }
    const rw = await play(eng, j.journey.items[0].gameId, 0.9, j.journey.items[0].level);
    expect(rw.stars).toBeGreaterThanOrEqual(1); expect(rw.newBadges).toContain('first_game');
    expect(await eng.pending()).toBe(1);
    const again = await eng.journey(); expect(again.journey.items.find((i) => i.gameId === j.journey.items[0].gameId)!.done).toBe(true);
    expect(again.journey.items.map((i) => i.seed)).toEqual(j.journey.items.map((i) => i.seed));      // same journey all day, offline too
    expect((await eng.profile())!.xp).toBeGreaterThan(0); expect(await store.keys(QUEUE_PREFIX)).toHaveLength(1);
  });
  it('write-ahead: the finished game is on disk BEFORE any network call', async () => {
    const { eng, store } = await setup('offline'); await play(eng, 'pattern_logic', 1, 4, 'wal-1');
    expect((await store.get<any>('kids:queue:wal-1'))!.payload.trials.length).toBeGreaterThan(0);
  });
  it('flush: nothing is lost while offline; once online everything is sent exactly once, oldest first', async () => {
    const { eng, m, log } = await setup('offline');
    for (const [i, g] of (['memory_match', 'visual_attention', 'pattern_logic'] as GameId[]).entries()) await play(eng, g, 1, 4, `q-${i}`);
    expect((await eng.flush()).left).toBe(3);                              // still offline: queue untouched
    m.v = 'online'; const r = await eng.flush(); expect(r).toEqual({ sent: 3, left: 0 }); expect(log).toEqual(['q-0', 'q-1', 'q-2']);
    expect((await eng.flush()).sent).toBe(0);
  });
  it('concurrent flushes never double-send', async () => {
    const { eng, m, log } = await setup('offline'); await play(eng, 'memory_match', 1, 4, 'c-1'); await play(eng, 'pattern_logic', 1, 4, 'c-2'); m.v = 'online';
    await Promise.all([eng.flush(), eng.flush(), eng.flush()]); expect(log.filter((x) => x === 'c-1')).toHaveLength(1); expect(await eng.pending()).toBe(0);
  });
  it('a server error keeps the queue (retry later); a permanently invalid result is dropped so it cannot block the rest', async () => {
    const { eng, m } = await setup('server_error'); await play(eng, 'memory_match', 1, 4, 'e-1');
    expect((await eng.flush()).left).toBe(1);
    m.v = 'bad_request'; expect((await eng.flush()).left).toBe(0);
  });
  it('adopts the server\'s adaptive state after a clean sync (server wins)', async () => {
    const { eng, m } = await setup('offline'); await play(eng, 'memory_match', 1, 4, 'a-1'); m.v = 'online'; await eng.flush();
    const st = await eng.states(); expect(st.memory_match.plays).toBe(99);
  });
  it('adaptive on the device respects the hard ceiling and never jumps', async () => {
    const { eng } = await setup('offline'); const seen: number[] = [];
    for (let i = 0; i < 12; i++) { const lvl = (await eng.states()).pattern_logic.level; await play(eng, 'pattern_logic', 1, lvl); seen.push((await eng.states()).pattern_logic.level); }
    expect(Math.max(...seen)).toBe(levelCeiling(7)); for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i] - seen[i - 1])).toBeLessThanOrEqual(1);
  });
  it('refresh does not roll back rewards that are still waiting to sync', async () => {
    const { eng, m } = await setup('offline'); await play(eng, 'memory_match', 1, 4, 'r-1'); const xp = (await eng.profile())!.xp; m.v = 'online'; await eng.refresh();
    expect((await eng.profile())!.xp).toBe(xp);
  });
  it('signOut wipes the device', async () => {
    const { eng, store } = await setup('offline'); await play(eng, 'memory_match', 1, 4, 'w-1'); await eng.signOut();
    expect(await store.keys('kids:')).toHaveLength(0); expect(await eng.getToken()).toBeNull();
  });
  it('fatigue: after several games in a row the home screen suggests a rest', async () => {
    const { eng } = await setup('offline'); for (let i = 0; i < 3; i++) await play(eng, GAME_IDS[i], 1, 4);
    const j = await eng.journey(); expect(j.rest?.reason).toBe('in_a_row');
  });
  it('streak helper', () => { expect(streakOf(['2026-03-08', '2026-03-09', '2026-03-10'], '2026-03-10')).toBe(3); expect(streakOf(['2026-03-08'], '2026-03-10')).toBe(0); expect(streakOf(['2026-03-09'], '2026-03-10')).toBe(1); });
});
