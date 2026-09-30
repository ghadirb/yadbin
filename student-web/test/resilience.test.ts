import { describe, expect, it } from 'vitest';
import { createApi } from '../src/sync/api';
import { MemoryKv, openStore } from '../src/storage/kv';

describe('resilience on filtered / hanging networks', () => {
  it('aborts a hanging request and reports a network error', async () => {
    const hang: typeof fetch = (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const api = createApi('', hang, 50);
    const t0 = Date.now();
    expect(await api.getPlay('ABCDEFGH')).toEqual({ kind: 'network' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('falls back to memory when IndexedDB never answers', async () => {
    (globalThis as any).indexedDB = {};
    const never = { get: () => new Promise(() => {}), set: () => new Promise(() => {}), del: () => new Promise(() => {}), keys: () => new Promise(() => {}) } as any;
    const store = await openStore(50, () => never);
    delete (globalThis as any).indexedDB;
    expect(store).toBeInstanceOf(MemoryKv);
  });
  it('treats a non-JSON 200 (HTML fallback) as a generic error, not a crash', async () => {
    const { runSession } = await import('../src/session/controller');
    const api = { getPlay: async () => ({ kind: 'ok', data: null }), complete: async () => ({ kind: 'ok', data: null }) } as any;
    let got = '';
    const ui: any = { error: (k: string) => { got = k; } };
    expect(await runSession({ token: 'ABCDEFGH', api, store: new MemoryKv(), ui })).toBe('error');
    expect(got).toBe('generic');
  });
});

describe('first-load retry', () => {
  it('retries a failed first request quietly and then plays', async () => {
    const { runSession } = await import('../src/session/controller');
    let calls = 0; const errors: string[] = [];
    const payload = { session: { id: 's1' }, status: 'active', game: 'memory', difficultyMode: 'adaptive', questionCount: 5, pools: {}, startDifficulty: 1 };
    const api = { getPlay: async () => (++calls < 3 ? { kind: 'network' } : { kind: 'ok', data: payload }), complete: async () => ({ kind: 'ok', data: {} }) } as any;
    const ui: any = { error: (k: string) => errors.push(k), welcome: async () => { throw new Error('reached welcome'); } };
    await expect(runSession({ token: 'ABCDEFGH', api, store: new MemoryKv(), ui, firstLoadRetryDelayMs: 1 })).rejects.toThrow('reached welcome');
    expect(calls).toBe(3); expect(errors).toEqual([]);
  });
  it('shows the network error only after all retries fail', async () => {
    const { runSession } = await import('../src/session/controller');
    let calls = 0; let kind = '';
    const api = { getPlay: async () => { calls++; return { kind: 'network' }; }, complete: async () => ({ kind: 'network' }) } as any;
    const ui: any = { error: (k: string) => { kind = k; } };
    expect(await runSession({ token: 'ABCDEFGH', api, store: new MemoryKv(), ui, firstLoadRetryDelayMs: 1 })).toBe('error');
    expect(calls).toBe(3); expect(kind).toBe('network');
  });
});
