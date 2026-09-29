import { Miniflare } from 'miniflare';
import { buildSync } from 'esbuild';
import { readdirSync, readFileSync } from 'node:fs';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);
const SQL = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, MIGRATIONS_DIR), 'utf8')).join('\n');

export async function createEnv() {
  const out = buildSync({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, platform: 'neutral', target: 'es2022', mainFields: ['module', 'main'] });
  const mf = new Miniflare({
    workers: [{
      name: 'yadbin', modules: true, script: out.outputFiles[0].text, compatibilityDate: '2025-01-01',
      d1Databases: { DB: crypto.randomUUID() },
      bindings: { JWT_SECRET: 'test-secret-test-secret-test-secret', ALLOWED_ORIGIN: '*', PLAY_BASE_URL: 'https://play.example' },
    }],
  });
  const db = await mf.getD1Database('DB');
  const stmts = SQL.replace(/--.*$/gm, '').split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (const s of stmts) await db.prepare(s).run();

  // Each helper call comes from a distinct client IP so per-IP limits don't couple unrelated tests.
  let ipCounter = 0;
  const nextIp = () => `198.51.${Math.floor(++ipCounter / 250) % 250}.${ipCounter % 250 + 1}`;
  async function api(method: string, path: string, body?: unknown, token?: string) {
    const res = await mf.dispatchFetch(`http://localhost${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': nextIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  return { mf, db, api, raw: (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => mf.dispatchFetch(`http://localhost${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), dispose: () => mf.dispose() };
}
export type TestEnv = Awaited<ReturnType<typeof createEnv>>;

let phoneCounter = 0;
export async function registerTeacher(t: TestEnv, name = 'معلم آزمون') {
  const phone = `0912${String(1000000 + ++phoneCounter).slice(-7)}`;
  const r = await t.api('POST', '/api/auth/register', { name, phone, password: 'pass12345' });
  return { token: r.data.token as string, phone, id: r.data.teacher.id as string, res: r };
}

/** Builds valid events for a game. `acc` = fraction correct. */
export function memoryEvents(n: number, correctCount: number, difficulty = 1) {
  return Array.from({ length: n }, (_, i) => ({ sequenceLength: 4, displayDuration: 1500, difficulty, isReverse: false, correct: i < correctCount, attempts: 1, responseTime: 2000, mistakes: i < correctCount ? 0 : 1 }));
}
