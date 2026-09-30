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
