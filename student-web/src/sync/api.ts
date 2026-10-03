export type ApiResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'http'; status: number; error: string; message: string }
  | { kind: 'network' };

export interface PlayApi {
  getPlay(token: string): Promise<ApiResult<any>>;
  complete(token: string, payload: unknown): Promise<ApiResult<any>>;
  /** Child's own progress (v1.1). Optional so older fakes keep working. */
  progress?(token: string): Promise<ApiResult<any>>;
}

export function createApi(base = '', previewOrFetch: boolean | typeof fetch = false, fetchOrTimeout: typeof fetch | number = (...a) => fetch(...a), timeoutMs = 15000): PlayApi {
  const preview = typeof previewOrFetch === 'boolean' ? previewOrFetch : false;
  const fetchImpl = (typeof previewOrFetch === 'function' ? previewOrFetch : typeof fetchOrTimeout === 'function' ? fetchOrTimeout : (...a: Parameters<typeof fetch>) => fetch(...a)) as typeof fetch;
  if (typeof fetchOrTimeout === 'number') timeoutMs = fetchOrTimeout;
  async function call(method: string, path: string, body?: unknown): Promise<ApiResult<any>> {
    // Filtered/slow networks often hang instead of failing: abort so the UI can offer a retry.
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), timeoutMs);
    let res: Response;
    let data: any = null;
    try {
      res = await fetchImpl(`${base}${path}`, { method, signal: ctl?.signal, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      try { data = await res.json(); } catch { /* non-JSON */ }
    } catch { return { kind: 'network' }; } finally { clearTimeout(timer); }
    if (res.ok) return { kind: 'ok', data };
    return { kind: 'http', status: res.status, error: data?.error ?? 'error', message: data?.message ?? 'خطا' };
  }
  return {
    getPlay: (t) => call('GET', `/api/${preview ? 'preview' : 'play'}/${encodeURIComponent(t)}`),
    progress: (t) => call('GET', `/api/play/${encodeURIComponent(t)}/progress`),
    complete: (t, p) => call('POST', `/api/${preview ? 'preview' : 'play'}/${encodeURIComponent(t)}/complete`, p),
  };
}
