import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findBanned, GAME_IDS, levelCeiling, levelFloor, playBot, type GameId } from '../../core/kids';
import { createEnv, registerTeacher, type TestEnv } from './helpers';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60_000);
afterAll(async () => { await t?.dispose(); });

let n = 0;
const phone = () => `0935${String(2000000 + ++n).slice(-7)}`;
async function parent(name = 'مادر آزمون') {
  const ph = phone();
  const r = await t.api('POST', '/api/kids/parent/register', { name, phone: ph, password: 'parent-pass-1' });
  expect(r.status).toBe(201);
  return { token: r.data.token as string, phone: ph, id: r.data.parent.id as string, recoveryCode: r.data.recoveryCode as string };
}
async function child(p: { token: string }, name = 'سارا', age = 7) {
  const r = await t.api('POST', '/api/kids/parent/children', { name, age }, p.token);
  expect(r.status).toBe(201);
  return { id: r.data.child.id as string, token: r.data.childToken as string, link: r.data.childLink as string, res: r };
}
/** Submits a bot-played session exactly as the Student Web client does (raw trials only — never a score). */
const submit = (ct: string, gameId: GameId, level: number, accuracy = 1, sessionId = `s-${crypto.randomUUID()}`, seed = `seed-${sessionId}`) => {
  const raw = playBot(gameId, level, seed, accuracy);
  return { sessionId, body: { sessionId, gameId, level, seed, startedAt: new Date(Date.now() - raw.durationMs).toISOString(), durationMs: raw.durationMs, completed: raw.completed, trials: raw.trials }, send: (token = ct) => t.api('POST', '/api/kids/session/result', { sessionId, gameId, level, seed, startedAt: new Date(Date.now() - raw.durationMs).toISOString(), durationMs: raw.durationMs, completed: raw.completed, trials: raw.trials }, token) };
};

describe('parent & child authentication are separate', () => {
  it('register / login / wrong password / recovery', async () => {
    const p = await parent();
    expect((await t.api('POST', '/api/kids/parent/login', { phone: p.phone, password: 'parent-pass-1' })).status).toBe(200);
    expect((await t.api('POST', '/api/kids/parent/login', { phone: p.phone, password: 'nope-nope-1' })).status).toBe(401);
    expect((await t.api('POST', '/api/kids/parent/register', { name: 'x y', phone: p.phone, password: 'parent-pass-1' })).status).toBe(409);
    const reset = await t.api('POST', '/api/kids/parent/reset-password', { phone: p.phone, recoveryCode: p.recoveryCode, newPassword: 'brand-new-pass-2' });
    expect(reset.status).toBe(200); expect(reset.data.recoveryCode).not.toBe(p.recoveryCode);
    expect((await t.api('POST', '/api/kids/parent/login', { phone: p.phone, password: 'brand-new-pass-2' })).status).toBe(200);
  });
  it('a parent token never opens teacher routes, a teacher token never opens parent routes, a child token opens neither', async () => {
    const p = await parent(); const c = await child(p); const teacher = await registerTeacher(t);
    expect((await t.api('GET', '/api/classes', undefined, p.token)).status).toBe(401);
    expect((await t.api('GET', '/api/kids/parent', undefined, teacher.token)).status).toBe(401);
    expect((await t.api('GET', '/api/kids/parent', undefined, c.token)).status).toBe(401);
    expect((await t.api('GET', '/api/kids/journey', undefined, p.token)).status).toBe(401);
    expect((await t.api('GET', '/api/kids/journey', undefined, teacher.token)).status).toBe(401);
    expect((await t.api('GET', '/api/kids/journey')).status).toBe(401);
    expect((await t.api('GET', '/api/kids/journey', undefined, 'kc_' + 'A'.repeat(32))).status).toBe(401);
    expect((await t.api('GET', '/api/classes', undefined, teacher.token)).status).toBe(200); // Teacher product untouched
  });
  it('the child device token is stored only as a hash and the link points at /kids/c/…', async () => {
    const p = await parent(); const c = await child(p);
    expect(c.link).toContain(`/kids/c/${c.token}`);
    const row = await t.db.prepare('SELECT token_hash FROM kids_profiles WHERE id = ?').bind(c.id).first<{ token_hash: string }>();
    expect(row!.token_hash).not.toContain(c.token); expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rotating the link kills the old one at once', async () => {
    const p = await parent(); const c = await child(p);
    const r = await t.api('POST', `/api/kids/parent/children/${c.id}/link`, undefined, p.token);
    expect(r.status).toBe(200);
    expect((await t.api('GET', '/api/kids/profile', undefined, c.token)).status).toBe(401);
    expect((await t.api('GET', '/api/kids/profile', undefined, r.data.childToken)).status).toBe(200);
  });
});

describe('child profile (minimal data, supported ages)', () => {
  it('validates age 4–12 and stores only name, age, avatar', async () => {
    const p = await parent();
    for (const age of [3, 13, 7.5, -1]) expect((await t.api('POST', '/api/kids/parent/children', { name: 'علی', age }, p.token)).status).toBe(400);
    expect((await t.api('POST', '/api/kids/parent/children', { name: '', age: 7 }, p.token)).status).toBe(400);
    const cols = (await t.db.prepare('PRAGMA table_info(kids_profiles)').all<{ name: string }>()).results.map((c) => c.name);
    for (const banned of ['phone', 'email', 'location', 'lat', 'lng', 'contacts', 'sms', 'device_id', 'ip']) expect(cols.some((c) => c.includes(banned))).toBe(false);
  });
  it('limits children per parent and lets the parent edit them', async () => {
    const p = await parent(); const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await child(p, `کودک${i}`, 5)).id);
    expect((await t.api('POST', '/api/kids/parent/children', { name: 'هفتم', age: 6 }, p.token)).status).toBe(409);
    const u = await t.api('PUT', `/api/kids/parent/children/${ids[0]}`, { name: 'نام تازه', age: 8 }, p.token);
    expect(u.status).toBe(200); expect(u.data.child.name).toBe('نام تازه'); expect(u.data.child.age).toBe(8);
  });
});

describe('daily journey', () => {
  it('3 games, 3 different skills, inside the hard ceiling; the same all day', async () => {
    const p = await parent(); const c = await child(p, 'آرین', 7);
    const j = await t.api('GET', '/api/kids/journey', undefined, c.token);
    expect(j.status).toBe(200); expect(j.data.items).toHaveLength(3);
    expect(new Set(j.data.items.map((i: any) => i.skill)).size).toBe(3);
    for (const i of j.data.items) { expect(i.level).toBeLessThanOrEqual(levelCeiling(7)); expect(i.level).toBeGreaterThanOrEqual(levelFloor(7)); expect(i.done).toBe(false); }
    const again = await t.api('GET', '/api/kids/journey', undefined, c.token);
    expect(again.data.items.map((i: any) => i.seed)).toEqual(j.data.items.map((i: any) => i.seed));
    expect(findBanned(JSON.stringify(j.data))).toEqual([]);
  });
});

describe('result submission: server-side scoring, adaptive, idempotency', () => {
  it('a finished game is stored, scored on the server, rewarded — and the journey item turns done', async () => {
    const p = await parent(); const c = await child(p, 'نیکا', 7);
    const j = (await t.api('GET', '/api/kids/journey', undefined, c.token)).data.items[0];
    const s = submit(c.token, j.gameId, j.level, 0.9);
    const r = await s.send();
    expect(r.status).toBe(200); expect(r.data.duplicate).toBe(false);
    expect(r.data.result.stars).toBeGreaterThanOrEqual(1); expect(r.data.result.newBadges.map((b: any) => b.code)).toContain('first_game');
    expect(JSON.stringify(r.data.result)).not.toMatch(/accuracy|performance|score|iq/i);   // the child never sees measurements
    const after = (await t.api('GET', '/api/kids/journey', undefined, c.token)).data;
    expect(after.items.find((i: any) => i.gameId === j.gameId).done).toBe(true);
    const row = await t.db.prepare('SELECT performance, accuracy FROM kids_game_sessions WHERE child_id = ?').bind(c.id).first<any>();
    expect(row.performance).toBeGreaterThan(0.3); expect(row.performance).toBeLessThanOrEqual(1);
  });
  it('a fake score in the payload is ignored: scoring comes from raw trials only', async () => {
    const p = await parent(); const c = await child(p);
    const s = submit(c.token, 'pattern_logic', 4, 0.2);
    const r = await t.api('POST', '/api/kids/session/result', { ...s.body, performance: 1, accuracy: 1, stars: 3, xp: 99999 }, c.token);
    expect(r.status).toBe(200); expect(r.data.result.xp).toBeLessThan(60);
    const row = await t.db.prepare('SELECT performance, stars FROM kids_game_sessions WHERE child_id = ?').bind(c.id).first<any>();
    expect(row.performance).toBeLessThan(0.8);
  });
  it('duplicate prevention: retry / double tap / reconnect never create a second result or double the XP', async () => {
    const p = await parent(); const c = await child(p);
    const s = submit(c.token, 'memory_match', 4, 1);
    const first = await s.send(); expect(first.data.duplicate).toBe(false);
    const again = await s.send(); expect(again.status).toBe(200); expect(again.data.duplicate).toBe(true);
    const burst = await Promise.all(Array.from({ length: 6 }, () => s.send()));
    expect(burst.every((x) => x.status === 200)).toBe(true);
    const cnt = await t.db.prepare('SELECT COUNT(*) AS n FROM kids_game_sessions WHERE child_id = ?').bind(c.id).first<{ n: number }>();
    expect(cnt!.n).toBe(1);
    const prof = (await t.api('GET', '/api/kids/profile', undefined, c.token)).data;
    expect(prof.xp).toBe(first.data.result.xp);
  });
  it('concurrent identical submissions (race) still count once', async () => {
    const p = await parent(); const c = await child(p);
    const s = submit(c.token, 'rule_switch', 4, 1);
    const all = await Promise.all(Array.from({ length: 8 }, () => s.send()));
    expect(all.filter((x) => x.data.duplicate === false)).toHaveLength(1);
    const prof = await t.db.prepare('SELECT games_completed, xp FROM kids_profiles WHERE id = ?').bind(c.id).first<any>();
    expect(prof.games_completed).toBe(1);
    expect(prof.xp).toBe(all.find((x) => x.data.duplicate === false)!.data.result.xp);
  });
  it('offline queue replay: the same ordered batch sent twice ends in the same state', async () => {
    const p = await parent(); const c = await child(p);
    const batch = ['memory_match', 'visual_attention', 'pattern_logic', 'reaction_control'].map((g, i) => submit(c.token, g as GameId, 4, 0.9, `queued-${c.id.slice(0, 8)}-${i}`));
    for (const s of batch) expect((await s.send()).status).toBe(200);
    const snap = async () => JSON.stringify(await t.db.prepare('SELECT xp, stars, games_completed, total_play_ms FROM kids_profiles WHERE id = ?').bind(c.id).first());
    const once = await snap();
    for (const s of batch) expect((await s.send()).data.duplicate).toBe(true);
    expect(await snap()).toBe(once);
  });
  it('rejects garbage: no trials, impossible values, unknown game, other child\'s session id space', async () => {
    const p = await parent(); const c = await child(p); const s = submit(c.token, 'pattern_logic', 3, 1);
    const bad = async (patch: any) => (await t.api('POST', '/api/kids/session/result', { ...s.body, sessionId: `bad-${crypto.randomUUID()}`, ...patch }, c.token)).status;
    expect(await bad({ trials: [] })).toBe(400); expect(await bad({ gameId: 'iq_test' })).toBe(400); expect(await bad({ level: 11 })).toBe(400); expect(await bad({ durationMs: 99_999_999 })).toBe(400);
    expect(await bad({ trials: [{ correct: true, rtMs: -5, errors: 0, attempts: 1 }] })).toBe(400);
    expect(await bad({ trials: Array(500).fill({ correct: true, rtMs: 1, errors: 0, attempts: 1 }) })).toBe(400);
    expect(await bad({ sessionId: 'x' })).toBe(400);
  });
  it('the same session id from two different children are independent records', async () => {
    const p = await parent(); const a = await child(p, 'الف'), b = await child(p, 'ب');
    const sA = submit(a.token, 'pattern_logic', 4, 1, 'shared-session-id');
    expect((await sA.send(a.token)).data.duplicate).toBe(false); expect((await sA.send(b.token)).data.duplicate).toBe(false);
  });
});

describe('adaptive difficulty over real submissions', () => {
  const state = async (cid: string, g: GameId) => JSON.parse((await t.db.prepare('SELECT state_json FROM kids_game_progress WHERE child_id = ? AND game_id = ?').bind(cid, g).first<any>()).state_json);
  it('level rises gradually after sustained success, never past the hard ceiling', async () => {
    const p = await parent(); const c = await child(p, 'تیزهوش', 7); // age is only a start
    const seen: number[] = [];
    for (let i = 0; i < 14; i++) { const lvl = (await state(c.id, 'pattern_logic').catch(() => ({ level: 4 }))).level; await submit(c.token, 'pattern_logic', lvl, 1).send(); seen.push((await state(c.id, 'pattern_logic')).level); }
    expect(Math.max(...seen)).toBe(levelCeiling(7));
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i] - seen[i - 1])).toBeLessThanOrEqual(1);
  });
  it('level drops (one step at a time) after repeated struggle, never below the floor', async () => {
    const p = await parent(); const c = await child(p, 'نیازمند', 9);
    const seen: number[] = [];
    for (let i = 0; i < 16; i++) { const lvl = (await state(c.id, 'visual_attention').catch(() => ({ level: 6 }))).level; await submit(c.token, 'visual_attention', lvl, 0.1).send(); seen.push((await state(c.id, 'visual_attention')).level); }
    expect(Math.min(...seen)).toBeLessThan(6); expect(Math.min(...seen)).toBeGreaterThanOrEqual(levelFloor(9));
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i] - seen[i - 1])).toBeLessThanOrEqual(1);
  });
  it('the response carries the canonical state so a device can reconcile its offline copy', async () => {
    const p = await parent(); const c = await child(p, 'الف', 6);
    const r = await submit(c.token, 'path_puzzle', 3, 1).send();
    expect(Object.keys(r.data.sync).sort()).toEqual([...GAME_IDS].sort()); expect(r.data.sync.path_puzzle.plays).toBe(1);
  });
});

describe('parent dashboard & reports', () => {
  it('honest with no data, then shows growth with trends once there are enough games', async () => {
    const p = await parent(); const c = await child(p, 'گزارش', 8);
    const empty = await t.api('GET', `/api/kids/parent/children/${c.id}/dashboard`, undefined, p.token);
    expect(empty.status).toBe(200); expect(empty.data.skills.every((s: any) => s.score === null && s.labelCode === 'collecting')).toBe(true);
    for (let i = 0; i < 4; i++) for (const g of ['memory_match', 'visual_attention', 'pattern_logic', 'reaction_control', 'path_puzzle', 'rule_switch'] as GameId[]) await submit(c.token, g, 5, 0.85).send();
    const d = (await t.api('GET', `/api/kids/parent/children/${c.id}/dashboard`, undefined, p.token)).data;
    expect(d.skills.find((s: any) => s.skill === 'memory').score).toBeGreaterThan(40);
    expect(d.status.gamesCompleted).toBe(24); expect(d.activity.week.games).toBe(24); expect(d.recentGames).toHaveLength(10); expect(d.games).toHaveLength(6);
    expect(d.skills.find((s: any) => s.skill === 'memory').series.length).toBeGreaterThan(0);
    const w = (await t.api('GET', `/api/kids/parent/children/${c.id}/report?period=week`, undefined, p.token)).data;
    const m = (await t.api('GET', `/api/kids/report?childId=${c.id}&period=month`, undefined, p.token)).data;
    expect(w.period).toBe('week'); expect(m.period).toBe('month'); expect(w.enoughData).toBe(true); expect(w.games).toBe(24);
    expect(JSON.stringify([d, w, m])).not.toMatch(/ADHD|\bIQ\b|اختلال|نابغه|آزمون|ضعیف/);
    expect(findBanned(JSON.stringify([w, m]))).toEqual([]);
  });
});

describe('privacy: no leakage between families, no ranking', () => {
  it('another parent gets 404 for every child endpoint; a child sees only their own progress', async () => {
    const a = await parent(), b = await parent(); const ca = await child(a, 'کودک الف', 7), cb = await child(b, 'کودک ب', 7);
    for (const path of [`/api/kids/parent/children/${ca.id}/dashboard`, `/api/kids/parent/children/${ca.id}/report`]) expect((await t.api('GET', path, undefined, b.token)).status).toBe(404);
    expect((await t.api('PUT', `/api/kids/parent/children/${ca.id}`, { name: 'هک' }, b.token)).status).toBe(404);
    expect((await t.api('DELETE', `/api/kids/parent/children/${ca.id}`, undefined, b.token)).status).toBe(404);
    expect((await t.api('POST', `/api/kids/parent/children/${ca.id}/link`, undefined, b.token)).status).toBe(404);
    expect((await t.api('GET', `/api/kids/report?childId=${ca.id}`, undefined, b.token)).status).toBe(404);
    await submit(ca.token, 'pattern_logic', 4).send();
    const pa = (await t.api('GET', '/api/kids/progress', undefined, ca.token)).data, pb = (await t.api('GET', '/api/kids/progress', undefined, cb.token)).data;
    expect(pa.gamesPlayed).toBe(1); expect(pb.gamesPlayed).toBe(0);
    const text = JSON.stringify([pa, (await t.api('GET', '/api/kids/profile', undefined, ca.token)).data, (await t.api('GET', '/api/kids/journey', undefined, ca.token)).data]);
    expect(text).not.toContain(a.phone); expect(text).not.toContain(a.id); expect(text).not.toContain(cb.id); expect(text).not.toMatch(/rank|leaderboard|lead_?er|رتبه/i);
  });
  it('no leaderboard / comparison endpoint exists', async () => {
    const p = await parent();
    for (const path of ['/api/kids/leaderboard', '/api/kids/ranking', '/api/kids/compare', '/api/kids/children']) expect((await t.api('GET', path, undefined, p.token)).status).toBe(404);
  });
  it('deleting a child erases all their data; deleting the parent erases everything under it', async () => {
    const p = await parent(); const c1 = await child(p, 'یک', 7), c2 = await child(p, 'دو', 8);
    await submit(c1.token, 'pattern_logic', 4).send(); await submit(c2.token, 'pattern_logic', 5).send();
    expect((await t.api('DELETE', `/api/kids/parent/children/${c1.id}`, undefined, p.token)).status).toBe(200);
    const left = async (table: string, id: string) => (await t.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE child_id = ?`).bind(id).first<{ n: number }>())!.n;
    for (const tb of ['kids_game_sessions', 'kids_game_progress', 'kids_skill_progress', 'kids_rewards', 'kids_daily_journeys']) expect(await left(tb, c1.id)).toBe(0);
    expect((await t.api('GET', '/api/kids/profile', undefined, c1.token)).status).toBe(401);
    expect(await left('kids_game_sessions', c2.id)).toBe(1);
    expect((await t.api('POST', '/api/kids/parent/delete-account', { password: 'wrong-pass-1', confirm: true }, p.token)).status).toBe(403);
    expect((await t.api('POST', '/api/kids/parent/delete-account', { password: 'parent-pass-1', confirm: true }, p.token)).status).toBe(200);
    expect(await left('kids_game_sessions', c2.id)).toBe(0);
    expect((await t.api('GET', '/api/kids/profile', undefined, c2.token)).status).toBe(401);
  });
});
