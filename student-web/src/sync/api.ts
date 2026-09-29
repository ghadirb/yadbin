export type ApiResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'http'; status: number; error: string; message: string }
  | { kind: 'network' };

export interface PlayApi {
  getPlay(token: string): Promise<ApiResult<any>>;
  complete(token: string, payload: unknown): Promise<ApiResult<any>>;
}

export function createApi(base = '', fetchImpl: typeof fetch = (...a) => fetch(...a)): PlayApi {
  async function call(method: string, path: string, body?: unknown): Promise<ApiResult<any>> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    } catch { return { kind: 'network' }; }
    let data: any = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (res.ok) return { kind: 'ok', data };
    return { kind: 'http', status: res.status, error: data?.error ?? 'error', message: data?.message ?? 'خطا' };
  }
  return {
    getPlay: (t) => call('GET', `/api/play/${encodeURIComponent(t)}`),
    complete: (t, p) => call('POST', `/api/play/${encodeURIComponent(t)}/complete`, p),
  };
}
