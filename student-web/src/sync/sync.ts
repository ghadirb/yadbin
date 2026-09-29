import type { KvStore } from '../storage/kv';
import type { PlayApi } from './api';

export const pendingKey = (token: string) => `pending:${token}`;
export type SubmitOutcome = 'sent' | 'saved_locally' | 'rejected';

/**
 * Result submission with local persistence. The payload is written to IndexedDB BEFORE the network call,
 * so closing the tab or losing connectivity never loses a finished game. The server is idempotent, so
 * re-sending (retry, double tap, reconnect) can never create a duplicate result.
 */
export async function submitResult(token: string, payload: unknown, api: PlayApi, store: KvStore): Promise<SubmitOutcome> {
  await store.set(pendingKey(token), payload);
  return flushPending(token, api, store);
}

export async function flushPending(token: string, api: PlayApi, store: KvStore): Promise<SubmitOutcome> {
  const payload = await store.get(pendingKey(token));
  if (!payload) return 'sent';
  const r = await api.complete(token, payload);
  if (r.kind === 'ok') { await store.del(pendingKey(token)); return 'sent'; }
  if (r.kind === 'http' && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
    await store.del(pendingKey(token)); // permanent rejection (e.g. canceled): retrying can never succeed
    return 'rejected';
  }
  return 'saved_locally'; // network down / 5xx / rate limit: keep and retry later
}

/** Retry on reconnect and on a timer until the pending result is delivered. Returns a stop function. */
export function autoRetry(token: string, api: PlayApi, store: KvStore, onSent: () => void, intervalMs = 15000): () => void {
  let stopped = false, busy = false;
  const attempt = async () => {
    if (stopped || busy) return;
    busy = true;
    try { if ((await flushPending(token, api, store)) !== 'saved_locally') { stopped = true; cleanup(); onSent(); } } finally { busy = false; }
  };
  const timer = setInterval(attempt, intervalMs);
  const cleanup = () => { clearInterval(timer); if (typeof window !== 'undefined') window.removeEventListener('online', attempt); };
  if (typeof window !== 'undefined') window.addEventListener('online', attempt);
  return () => { stopped = true; cleanup(); };
}
