import type { ApiResult } from '../sync/api';

export interface KidsApi {
  // child (device token)
  profile(): Promise<ApiResult<any>>;
  journey(): Promise<ApiResult<any>>;
  progress(): Promise<ApiResult<any>>;
  result(payload: unknown): Promise<ApiResult<any>>;
  // parent (JWT)
  parent: {
    register(b: unknown): Promise<ApiResult<any>>; login(b: unknown): Promise<ApiResult<any>>; reset(b: unknown): Promise<ApiResult<any>>;
    home(): Promise<ApiResult<any>>; createChild(b: unknown): Promise<ApiResult<any>>; updateChild(id: string, b: unknown): Promise<ApiResult<any>>;
    deleteChild(id: string): Promise<ApiResult<any>>; rotateLink(id: string): Promise<ApiResult<any>>;
    dashboard(id: string): Promise<ApiResult<any>>; report(id: string, period: 'week' | 'month'): Promise<ApiResult<any>>; deleteAccount(password: string): Promise<ApiResult<any>>;
  };
}
export interface Tokens { child: () => string | null; parent: () => string | null }

export function createKidsApi(base: string, tokens: Tokens, fetchImpl: typeof fetch = (...a) => fetch(...a), timeoutMs = 15000): KidsApi {
  async function call(method: string, path: string, who: 'child' | 'parent' | 'none', body?: unknown): Promise<ApiResult<any>> {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), timeoutMs);
    const tk = who === 'child' ? tokens.child() : who === 'parent' ? tokens.parent() : null;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (tk) headers.Authorization = `Bearer ${tk}`;
    let res: Response; let data: any = null;
    try { res = await fetchImpl(`${base}${path}`, { method, signal: ctl?.signal, headers, body: body === undefined ? undefined : JSON.stringify(body) }); try { data = await res.json(); } catch { /* non-JSON */ } }
    catch { return { kind: 'network' }; } finally { clearTimeout(timer); }
    return res.ok ? { kind: 'ok', data } : { kind: 'http', status: res.status, error: data?.error ?? 'error', message: data?.message ?? 'خطا' };
  }
  const P = '/api/kids/parent';
  return {
    profile: () => call('GET', '/api/kids/profile', 'child'), journey: () => call('GET', '/api/kids/journey', 'child'), progress: () => call('GET', '/api/kids/progress', 'child'),
    result: (p) => call('POST', '/api/kids/session/result', 'child', p),
    parent: {
      register: (b) => call('POST', `${P}/register`, 'none', b), login: (b) => call('POST', `${P}/login`, 'none', b), reset: (b) => call('POST', `${P}/reset-password`, 'none', b),
      home: () => call('GET', P, 'parent'), createChild: (b) => call('POST', `${P}/children`, 'parent', b), updateChild: (id, b) => call('PUT', `${P}/children/${id}`, 'parent', b),
      deleteChild: (id) => call('DELETE', `${P}/children/${id}`, 'parent'), rotateLink: (id) => call('POST', `${P}/children/${id}/link`, 'parent'),
      dashboard: (id) => call('GET', `${P}/children/${id}/dashboard`, 'parent'), report: (id, period) => call('GET', `${P}/children/${id}/report?period=${period}`, 'parent'),
      deleteAccount: (password) => call('POST', `${P}/delete-account`, 'parent', { password, confirm: true }),
    },
  };
}
