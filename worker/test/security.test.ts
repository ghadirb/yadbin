import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEnv, registerTeacher, type TestEnv } from './helpers';
import { corsHeaders } from '../src/utils/http';
import { requireSecret } from '../src/auth/middleware';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60_000);
afterAll(async () => { await t?.dispose(); });

describe('Security headers', () => {
  it('sends hardening headers on success and error responses', async () => {
    for (const path of ['/api/health', '/api/nope']) {
      const res = await t.raw('GET', path);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(res.headers.get('strict-transport-security')).toContain('max-age=');
      await res.text();
    }
  });
});

describe('Login brute-force protection', () => {
  it('locks an account after 8 failed attempts with Retry-After, independent of IP', async () => {
    const r = await registerTeacher(t);
    for (let i = 0; i < 8; i++) {
      expect((await t.api('POST', '/api/auth/login', { phone: r.phone, password: 'wrong-password' })).status).toBe(401);
    }
    const blocked = await t.raw('POST', '/api/auth/login', {}, { phone: r.phone, password: 'pass12345' });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    const body: any = await blocked.json();
    expect(body.error).toBe('rate_limited');
  });

  it('a successful login resets the counter', async () => {
    const r = await registerTeacher(t);
    for (let i = 0; i < 5; i++) await t.api('POST', '/api/auth/login', { phone: r.phone, password: 'wrong-password' });
    expect((await t.api('POST', '/api/auth/login', { phone: r.phone, password: 'pass12345' })).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await t.api('POST', '/api/auth/login', { phone: r.phone, password: 'wrong-password' })).status).toBe(401);
  });
});

describe('IP rate limit', () => {
  it('limits registrations per client IP (10/hour) and not other IPs', async () => {
    const ipA = { 'CF-Connecting-IP': '203.0.113.7' }, ipB = { 'CF-Connecting-IP': '203.0.113.8' };
    const reg = (ip: Record<string, string>, i: number) =>
      t.raw('POST', '/api/auth/register', ip, { name: 'معلم', phone: `0935${String(1000000 + i).slice(-7)}`, password: 'pass12345' });
    for (let i = 0; i < 10; i++) expect((await reg(ipA, i)).status).toBe(201);
    expect((await reg(ipA, 99)).status).toBe(429);
    expect((await reg(ipB, 100)).status).toBe(201);
  });
});

describe('Configuration safety', () => {
  it('production CORS never falls back to wildcard', () => {
    expect(corsHeaders({ ENVIRONMENT: 'production' } as any)['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsHeaders({ ENVIRONMENT: 'production', ALLOWED_ORIGIN: 'https://x.pages.dev' } as any)['Access-Control-Allow-Origin']).toBe('https://x.pages.dev');
    expect(corsHeaders({} as any)['Access-Control-Allow-Origin']).toBe('*');
  });
  it('rejects a missing or short JWT secret (fail closed)', () => {
    expect(() => requireSecret({} as any)).toThrow();
    expect(() => requireSecret({ JWT_SECRET: 'short' } as any)).toThrow();
    expect(() => requireSecret({ JWT_SECRET: 'x'.repeat(32) } as any)).not.toThrow();
  });
});
