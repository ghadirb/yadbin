import {
  adapt, AVATARS, baseLevelForAge, BADGES, buildDailyJourney, buildReport, computeMetrics, computeSkillGrowth, dailySeries, DEFAULT_KIDS_CONFIG, evaluateRewards, GAME_IDS, GAME_META, GAME_SPECS,
  initialAdaptiveState, learningCurve, levelBandLabel, localDay, restAdvice, REST_TEXT, sessionSeed, SKILL_META, skillSignals, themeFor, trendOf, worldsFor, WORLDS, ARROW, LABEL_FA, TREND_FA, activityStats,
  type AdaptiveState, type GameId, type Journey, type SessionRaw, type SessionSummary, type SignalRecord,
} from '../../../core/kids';
import { hashPassword, verifyPassword } from '../auth/password';
import { signJwt, verifyJwt } from '../auth/jwt';
import { requireSecret } from '../auth/middleware';
import type { Env } from '../env';
import { HttpError, json, readJson, unauthorized } from '../utils/http';
import { newId, nowIso } from '../utils/ids';
import { clearRateLimit, rateLimit, rateLimitIp } from '../utils/ratelimit';
import { loginSchema, parse, registerSchema, resetPasswordSchema } from '../validation/schemas';
import { childSchema, childUpdateSchema, deleteAccountSchema, resultSchema, startSchema } from '../validation/kids';
import { normalizeRecoveryCode } from './auth';

const CFG = DEFAULT_KIDS_CONFIG;
const DAY_MS = 86_400_000;
const MAX_CHILDREN = 6;
const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------- auth: parent (JWT, own key) and child (opaque device token) ----------
/** Parent tokens are signed with a key DERIVED from JWT_SECRET, so a parent token can never pass teacher auth and vice versa. */
const parentKey = (env: Env) => `${env.JWT_SECRET}|kids-parent`;
export async function requireParent(req: Request, env: Env): Promise<string> {
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '');
  if (!m) throw unauthorized();
  requireSecret(env);
  const p = await verifyJwt(m[1], parentKey(env));
  if (!p) throw unauthorized('نشست شما منقضی شده است. دوباره وارد شوید.');
  return p.sub;
}
const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const newChildToken = () => 'kc_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => TOKEN_ALPHABET[b & 31]).join('');
const newRecoveryCode = () => { const raw = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(''); return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`; };

interface Child { id: string; parent_id: string; display_name: string; age_years: number; age_set_at: string; avatar: string; xp: number; stars: number; total_play_ms: number; games_completed: number; last_played_at: string | null; current_level: number; current_stage: string; created_at: string }
export async function requireChild(req: Request, env: Env): Promise<Child> {
  const m = /^Bearer (kc_[A-Z2-9]{32})$/.exec(req.headers.get('Authorization') ?? '');
  if (!m) throw unauthorized('پیوند بازی معتبر نیست.');
  const row = await env.DB.prepare('SELECT * FROM kids_profiles WHERE token_hash = ?').bind(await sha256Hex(m[1])).first<Child>();
  if (!row) throw unauthorized('پیوند بازی معتبر نیست.');
  await rateLimit(env, `kids:child:${row.id}`, 600, 3600);
  return row;
}
/** Current age: the age the parent entered + whole years elapsed since. Always inside what the engine supports. */
export function currentAge(c: Pick<Child, 'age_years' | 'age_set_at'>, now = Date.now()): number {
  return c.age_years + Math.max(0, Math.floor((now - Date.parse(c.age_set_at)) / (365.25 * DAY_MS)));
}
const dayStartUtcMs = (day: string) => Date.parse(`${day}T00:00:00Z`) - 210 * 60_000;
const todayKey = (now = Date.now()) => localDay(new Date(now).toISOString());

const parentDto = (p: { id: string; name: string; phone: string }) => ({ id: p.id, name: p.name, phone: p.phone });
const childDto = (c: Child) => ({ id: c.id, name: c.display_name, age: currentAge(c), avatar: c.avatar, lastPlayedAt: c.last_played_at, gamesCompleted: c.games_completed, playMinutes: Math.round(c.total_play_ms / 60_000), createdAt: c.created_at });

// ---------- parent account ----------
export async function parentRegister(req: Request, env: Env) {
  requireSecret(env);
  await rateLimitIp(env, req, 'kids-register', 10, 3600);
  const { name, phone, password } = parse(registerSchema, await readJson(req));
  if (await env.DB.prepare('SELECT id FROM kids_parent_accounts WHERE phone = ?').bind(phone).first()) throw new HttpError(409, 'phone_taken', 'این شماره موبایل قبلاً ثبت‌نام کرده است.');
  const id = newId(), now = nowIso(), recoveryCode = newRecoveryCode();
  await env.DB.prepare('INSERT INTO kids_parent_accounts (id,name,phone,password_hash,recovery_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, name, phone, await hashPassword(password), await hashPassword(normalizeRecoveryCode(recoveryCode)), now, now).run();
  return json({ token: await signJwt(id, parentKey(env)), parent: { id, name, phone }, recoveryCode }, 201);
}
export async function parentLogin(req: Request, env: Env) {
  requireSecret(env);
  await rateLimitIp(env, req, 'kids-login', 30, 600);
  const { phone, password } = parse(loginSchema, await readJson(req));
  await rateLimit(env, `kids-login:phone:${phone}`, 8, 600);
  const p = await env.DB.prepare('SELECT * FROM kids_parent_accounts WHERE phone = ?').bind(phone).first<any>();
  const ok = await verifyPassword(password, p?.password_hash ?? DUMMY_HASH);
  if (!p || !ok) throw new HttpError(401, 'invalid_credentials', 'شماره موبایل یا رمز عبور اشتباه است.');
  await clearRateLimit(env, `kids-login:phone:${phone}`);
  return json({ token: await signJwt(p.id, parentKey(env)), parent: parentDto(p) });
}
export async function parentResetPassword(req: Request, env: Env) {
  requireSecret(env);
  await rateLimitIp(env, req, 'kids-reset', 10, 3600);
  const { phone, recoveryCode, newPassword } = parse(resetPasswordSchema, await readJson(req));
  await rateLimit(env, `kids-reset:phone:${phone}`, 5, 3600);
  const p = await env.DB.prepare('SELECT * FROM kids_parent_accounts WHERE phone = ?').bind(phone).first<any>();
  const ok = await verifyPassword(normalizeRecoveryCode(recoveryCode), p?.recovery_hash ?? DUMMY_HASH);
  if (!p || !p.recovery_hash || !ok) throw new HttpError(401, 'invalid_recovery', 'شماره موبایل یا کد بازیابی اشتباه است.');
  const next = newRecoveryCode();
  await env.DB.prepare('UPDATE kids_parent_accounts SET password_hash=?, recovery_hash=?, updated_at=? WHERE id=?').bind(await hashPassword(newPassword), await hashPassword(normalizeRecoveryCode(next)), nowIso(), p.id).run();
  await clearRateLimit(env, `kids-login:phone:${phone}`);
  return json({ token: await signJwt(p.id, parentKey(env)), parent: parentDto(p), recoveryCode: next });
}
/** Permanently deletes the parent and every child under them (privacy: nothing is kept). */
export async function parentDeleteAccount(req: Request, env: Env, parentId: string) {
  const { password } = parse(deleteAccountSchema, await readJson(req));
  await rateLimit(env, `kids-delete:${parentId}`, 5, 3600);
  const p = await env.DB.prepare('SELECT * FROM kids_parent_accounts WHERE id = ?').bind(parentId).first<any>();
  if (!p) throw new HttpError(404, 'not_found', 'حساب پیدا نشد.');
  if (!(await verifyPassword(password, p.password_hash))) throw new HttpError(403, 'wrong_password', 'رمز عبور اشتباه است.');
  const kids = (await env.DB.prepare('SELECT id FROM kids_profiles WHERE parent_id = ?').bind(parentId).all<{ id: string }>()).results;
  await env.DB.batch([...kids.flatMap((k) => deleteChildStatements(env, k.id)), env.DB.prepare('DELETE FROM kids_parent_accounts WHERE id = ?').bind(parentId)]);
  return json({ ok: true });
}

// ---------- parent: children ----------
async function ownedChild(env: Env, parentId: string, childId: string): Promise<Child> {
  const c = await env.DB.prepare('SELECT * FROM kids_profiles WHERE id = ? AND parent_id = ?').bind(childId, parentId).first<Child>();
  if (!c) throw new HttpError(404, 'not_found', 'یافت نشد.'); // a foreign id looks exactly like a missing one
  return c;
}
const linkFor = (env: Env, token: string) => `${(env.PLAY_BASE_URL ?? '').replace(/\/$/, '')}/kids/c/${token}`;

export async function parentHome(env: Env, parentId: string) {
  const p = await env.DB.prepare('SELECT id,name,phone FROM kids_parent_accounts WHERE id = ?').bind(parentId).first<any>();
  if (!p) throw unauthorized();
  const kids = (await env.DB.prepare('SELECT * FROM kids_profiles WHERE parent_id = ? ORDER BY created_at').bind(parentId).all<Child>()).results;
  return json({ parent: parentDto(p), children: kids.map(childDto), avatars: AVATARS });
}
export async function createChild(req: Request, env: Env, parentId: string) {
  const b = parse(childSchema, await readJson(req));
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM kids_profiles WHERE parent_id = ?').bind(parentId).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_CHILDREN) throw new HttpError(409, 'too_many_children', `حداکثر ${MAX_CHILDREN} کودک می‌توانید ثبت کنید.`);
  const id = newId(), now = nowIso(), token = newChildToken();
  await env.DB.prepare('INSERT INTO kids_profiles (id,parent_id,display_name,age_years,age_set_at,avatar,token_hash,current_level,current_stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, parentId, b.name, b.age, now, b.avatar ?? AVATARS[Math.floor(Math.random() * AVATARS.length)], await sha256Hex(token), baseLevelForAge(b.age), levelBandLabel(baseLevelForAge(b.age), b.age), now, now).run();
  const c = (await env.DB.prepare('SELECT * FROM kids_profiles WHERE id = ?').bind(id).first<Child>())!;
  return json({ child: childDto(c), childToken: token, childLink: linkFor(env, token) }, 201);
}
export async function updateChild(req: Request, env: Env, parentId: string, childId: string) {
  const c = await ownedChild(env, parentId, childId);
  const b = parse(childUpdateSchema, await readJson(req));
  const age = b.age ?? currentAge(c);
  await env.DB.prepare('UPDATE kids_profiles SET display_name=?, age_years=?, age_set_at=?, avatar=?, updated_at=? WHERE id=?')
    .bind(b.name ?? c.display_name, age, b.age !== undefined ? nowIso() : c.age_set_at, b.avatar ?? c.avatar, nowIso(), c.id).run();
  return json({ child: childDto((await env.DB.prepare('SELECT * FROM kids_profiles WHERE id = ?').bind(c.id).first<Child>())!) });
}
/** New link; the old one stops working at once (lost phone / shared by mistake). */
export async function rotateChildLink(env: Env, parentId: string, childId: string) {
  const c = await ownedChild(env, parentId, childId);
  const token = newChildToken();
  await env.DB.prepare('UPDATE kids_profiles SET token_hash=?, updated_at=? WHERE id=?').bind(await sha256Hex(token), nowIso(), c.id).run();
  return json({ childToken: token, childLink: linkFor(env, token) });
}
const deleteChildStatements = (env: Env, id: string) => ['kids_rewards', 'kids_daily_journeys', 'kids_skill_progress', 'kids_game_progress', 'kids_game_sessions'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE child_id = ?`).bind(id)).concat([env.DB.prepare('DELETE FROM kids_profiles WHERE id = ?').bind(id)]);
export async function deleteChild(env: Env, parentId: string, childId: string) {
  const c = await ownedChild(env, parentId, childId);
  await env.DB.batch(deleteChildStatements(env, c.id));
  return json({ ok: true });
}

// ---------- shared reads ----------
async function loadStates(env: Env, c: Child): Promise<Record<GameId, AdaptiveState & { bestPerformance: number | null; lastTheme: string | null }>> {
  const rows = (await env.DB.prepare('SELECT * FROM kids_game_progress WHERE child_id = ?').bind(c.id).all<any>()).results;
  const age = currentAge(c);
  const out = {} as Record<GameId, any>;
  for (const g of GAME_IDS) {
    const r = rows.find((x) => x.game_id === g);
    out[g] = r ? { ...(JSON.parse(r.state_json) as AdaptiveState), bestPerformance: r.best_performance, lastTheme: r.last_theme } : { ...initialAdaptiveState(age, CFG), bestPerformance: null, lastTheme: null };
  }
  return out;
}
const SIGNAL_DAYS = 180;
async function loadSignals(env: Env, childId: string, now = Date.now()): Promise<SignalRecord[]> {
  const rows = (await env.DB.prepare('SELECT ended_at, signals_json FROM kids_game_sessions WHERE child_id = ? AND ended_at >= ? ORDER BY ended_at DESC LIMIT 400').bind(childId, new Date(now - SIGNAL_DAYS * DAY_MS).toISOString()).all<any>()).results;
  return rows.flatMap((r) => (JSON.parse(r.signals_json) as { skill: any; value: number; weight: number }[]).map((s) => ({ ...s, at: r.ended_at as string })));
}
async function loadSessions(env: Env, childId: string, sinceMs: number, limit = 400): Promise<(SessionSummary & { stars: number; id: string; levelBefore: number; levelAfter: number })[]> {
  const rows = (await env.DB.prepare('SELECT id, game_id, ended_at, duration_ms, level, level_before, level_after, performance, completed, stars FROM kids_game_sessions WHERE child_id = ? AND ended_at >= ? ORDER BY ended_at DESC LIMIT ?').bind(childId, new Date(sinceMs).toISOString(), limit).all<any>()).results;
  return rows.map((r) => ({ id: r.id, gameId: r.game_id, at: r.ended_at, durationMs: r.duration_ms, level: r.level, performance: r.performance, completed: !!r.completed, stars: r.stars, levelBefore: r.level_before, levelAfter: r.level_after }));
}
function streakOf(days: string[], today: string): number {
  const set = new Set(days); let d = set.has(today) ? today : new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10); let n = 0;
  while (set.has(d)) { n++; d = new Date(Date.parse(`${d}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10); }
  return n;
}

// ---------- child: profile / journey / session / progress ----------
export async function childProfile(req: Request, env: Env) {
  const c = await requireChild(req, env);
  const rewards = (await env.DB.prepare('SELECT kind, code FROM kids_rewards WHERE child_id = ?').bind(c.id).all<{ kind: string; code: string }>()).results;
  const age = currentAge(c);
  return json({ name: c.display_name, avatar: c.avatar, age, ageSupported: age >= CFG.minAge && age <= CFG.maxAge, xp: c.xp, stars: c.stars, worlds: worldsFor(c.xp), badges: rewards.filter((r) => r.kind === 'badge').map((r) => r.code), config: { maxDailyMinutes: CFG.journey.maxDailyMinutes } });
}

async function journeyFor(env: Env, c: Child, now = Date.now()): Promise<Journey> {
  const day = todayKey(now);
  const have = await env.DB.prepare('SELECT journey_json FROM kids_daily_journeys WHERE child_id = ? AND day = ?').bind(c.id, day).first<{ journey_json: string }>();
  if (have) return JSON.parse(have.journey_json);
  const states = await loadStates(env, c);
  const prog = (await env.DB.prepare('SELECT game_id, plays, last_theme FROM kids_game_progress WHERE child_id = ?').bind(c.id).all<any>()).results;
  const skills = (await env.DB.prepare('SELECT skill, score, trend, samples FROM kids_skill_progress WHERE child_id = ?').bind(c.id).all<any>()).results;
  const recent = await loadSessions(env, c.id, now - CFG.journey.recentDays * DAY_MS, 60);
  const journey = buildDailyJourney({
    childKey: c.id, age: currentAge(c), day, nowIso: new Date(now).toISOString(),
    recent: recent.map((s) => ({ gameId: s.gameId, at: s.at, durationMs: s.durationMs, performance: s.performance })),
    levels: Object.fromEntries(GAME_IDS.map((g) => [g, states[g].level])) as any,
    growth: skills, playCounts: Object.fromEntries(prog.map((p) => [p.game_id, p.plays])), lastTheme: Object.fromEntries(prog.filter((p) => p.last_theme).map((p) => [p.game_id, p.last_theme])),
  });
  await env.DB.prepare('INSERT OR IGNORE INTO kids_daily_journeys (child_id, day, journey_json, created_at) VALUES (?,?,?,?)').bind(c.id, day, JSON.stringify(journey), nowIso()).run();
  const stored = await env.DB.prepare('SELECT journey_json FROM kids_daily_journeys WHERE child_id = ? AND day = ?').bind(c.id, day).first<{ journey_json: string }>();
  return JSON.parse(stored!.journey_json);
}
const withMeta = (g: GameId) => ({ title: GAME_META[g].title, story: GAME_META[g].story, emoji: GAME_META[g].emoji, skillEmoji: GAME_META[g].skillEmoji, durationSec: GAME_SPECS[g].sessionDurationSec });

export async function childJourney(req: Request, env: Env) {
  const c = await requireChild(req, env);
  const now = Date.now();
  const journey = await journeyFor(env, c, now);
  const today = await loadSessions(env, c.id, dayStartUtcMs(journey.day), 60);
  const doneIds = new Set(today.map((s) => s.gameId));
  const rest = restAdvice(today.map((s) => ({ at: s.at, durationMs: s.durationMs })), now);
  return json({
    day: journey.day, estimatedMinutes: journey.estimatedMinutes,
    items: journey.items.map((i) => ({ ...i, ...withMeta(i.gameId), done: doneIds.has(i.gameId) })),
    allDone: journey.items.every((i) => doneIds.has(i.gameId)),
    rest: rest.rest ? { reason: rest.reason, text: REST_TEXT[rest.reason as 'in_a_row' | 'daily_cap'], minutes: rest.restMinutes } : null,
  });
}

/** Optional online hint. Offline play never needs it: the device derives the same level/seed from the shared core. */
export async function childSessionStart(req: Request, env: Env) {
  const c = await requireChild(req, env);
  const { gameId } = parse(startSchema, await readJson(req));
  const journey = await journeyFor(env, c);
  const item = journey.items.find((i) => i.gameId === gameId);
  const states = await loadStates(env, c);
  const day = todayKey();
  const plays = (await env.DB.prepare('SELECT plays FROM kids_game_progress WHERE child_id = ? AND game_id = ?').bind(c.id, gameId).first<{ plays: number }>())?.plays ?? 0;
  const level = item?.level ?? states[gameId].level;
  return json({ sessionId: newId(), gameId, level, seed: item?.seed ?? sessionSeed(c.id, day, gameId, plays), themeId: item?.themeId ?? themeFor(c.id, gameId, plays, states[gameId].lastTheme).id, startedAt: nowIso() });
}

const statesDto = (s: Record<GameId, AdaptiveState & { bestPerformance: number | null; lastTheme: string | null }>) => Object.fromEntries(GAME_IDS.map((g) => [g, { level: s[g].level, history: s[g].history, sessionsAtLevel: s[g].sessionsAtLevel, cooldown: s[g].cooldown, plays: s[g].plays, bestPerformance: s[g].bestPerformance, lastTheme: s[g].lastTheme }]));

/**
 * Idempotent result submission. The client never sends a score: metrics, signals, stars and the next level are all recomputed
 * here from the raw trials with the shared core. Every state-changing statement is guarded by "this session id does not exist yet",
 * and the session row is inserted LAST in the same D1 batch, so a repeated / concurrent identical submission changes nothing.
 */
export async function childSessionResult(req: Request, env: Env) {
  const c = await requireChild(req, env);
  await rateLimitIp(env, req, 'kids-result', 600, 60);
  const b = parse(resultSchema, await readJson(req));
  const existing = await env.DB.prepare('SELECT stars, level_before, level_after FROM kids_game_sessions WHERE child_id = ? AND id = ?').bind(c.id, b.sessionId).first<any>();
  if (existing) return json({ ok: true, duplicate: true, result: { stars: existing.stars, levelUp: existing.level_after > existing.level_before }, sync: statesDto(await loadStates(env, c)) });

  const now = Date.now(), age = currentAge(c);
  const t0 = Date.parse(b.startedAt);
  const startedMs = Number.isFinite(t0) && t0 > now - 30 * DAY_MS && t0 < now + 5 * 60_000 ? t0 : now - b.durationMs; // device clocks lie: keep it plausible
  const endedAt = new Date(Math.min(startedMs + b.durationMs, now)).toISOString();
  const raw: SessionRaw = { gameId: b.gameId, level: b.level, seed: b.seed, trials: b.trials, completed: b.completed, durationMs: b.durationMs };
  const metrics = computeMetrics(raw);
  const states = await loadStates(env, c);
  const st = states[b.gameId];
  const { state: nextState, decision } = adapt({ level: st.level, history: st.history, sessionsAtLevel: st.sessionsAtLevel, cooldown: st.cooldown, plays: st.plays }, metrics.performance, age, CFG);
  const signals = skillSignals(raw, metrics, baseLevelForAge(age, CFG));

  // rewards (personal records only — compared with this child's own past)
  const day = localDay(endedAt);
  const recent = await loadSessions(env, c.id, now - 40 * DAY_MS, 400);
  const dayList = [...new Set([...recent.map((s) => localDay(s.at)), day])];
  const played = (await env.DB.prepare('SELECT DISTINCT game_id FROM kids_game_sessions WHERE child_id = ?').bind(c.id).all<{ game_id: GameId }>()).results.map((r) => r.game_id);
  const held = (await env.DB.prepare("SELECT code FROM kids_rewards WHERE child_id = ? AND kind = 'badge'").bind(c.id).all<{ code: string }>()).results.map((r) => r.code);
  const journey = await journeyFor(env, c, now);
  const doneToday = new Set(recent.filter((s) => localDay(s.at) === day).map((s) => s.gameId));
  const before = journey.items.every((i) => doneToday.has(i.gameId));
  const after = journey.items.every((i) => doneToday.has(i.gameId) || i.gameId === b.gameId);
  const rw = evaluateRewards({ performance: metrics.performance, level: b.level, levelUp: decision.delta > 0, previousBest: st.bestPerformance, totalSessionsBefore: c.games_completed, gamesPlayedBefore: played, gameId: b.gameId, streakDays: streakOf(dayList, day), journeyJustCompleted: !before && after && journey.day === day, recoveryDelta: metrics.recoveryDelta, xpBefore: c.xp, badgesHeld: held });

  // growth (moving average over the stored signals + this session)
  const prior = await loadSignals(env, c.id, now);
  const growth = computeSkillGrowth([...prior, ...signals.map((s) => ({ ...s, at: endedAt }))], CFG);
  const levels = GAME_IDS.map((g) => (g === b.gameId ? nextState.level : states[g].level));
  const avgLevel = Math.round(levels.reduce((a, x) => a + x, 0) / levels.length);

  const NOT_SEEN = 'NOT EXISTS (SELECT 1 FROM kids_game_sessions WHERE child_id = ? AND id = ?)';
  const g = [c.id, b.sessionId];
  const ts = nowIso();
  const D = env.DB;
  const stmts = [
    D.prepare(`INSERT INTO kids_game_progress (child_id, game_id, level, state_json, best_performance, plays, last_theme, updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${NOT_SEEN}
      ON CONFLICT(child_id, game_id) DO UPDATE SET level=excluded.level, state_json=excluded.state_json, best_performance=excluded.best_performance, plays=excluded.plays, last_theme=excluded.last_theme, updated_at=excluded.updated_at`)
      .bind(c.id, b.gameId, nextState.level, JSON.stringify(nextState), Math.max(st.bestPerformance ?? 0, metrics.performance), nextState.plays, b.themeId ?? st.lastTheme, ts, ...g),
    ...growth.map((s) => D.prepare(`INSERT INTO kids_skill_progress (child_id, skill, score, trend, samples, updated_at) SELECT ?,?,?,?,?,? WHERE ${NOT_SEEN}
      ON CONFLICT(child_id, skill) DO UPDATE SET score=excluded.score, trend=excluded.trend, samples=excluded.samples, updated_at=excluded.updated_at`).bind(c.id, s.skill, s.score, s.trend, s.samples, ts, ...g)),
    D.prepare(`UPDATE kids_profiles SET xp = xp + ?, stars = stars + ?, total_play_ms = total_play_ms + ?, games_completed = games_completed + 1, last_played_at = ?, current_level = ?, current_stage = ?, updated_at = ? WHERE id = ? AND ${NOT_SEEN}`)
      .bind(rw.xp, rw.stars, b.durationMs, endedAt, avgLevel, levelBandLabel(avgLevel, age, CFG), ts, c.id, ...g),
    ...rw.newBadges.map((code) => D.prepare(`INSERT OR IGNORE INTO kids_rewards (child_id, kind, code, earned_at) SELECT ?,?,?,? WHERE ${NOT_SEEN}`).bind(c.id, 'badge', code, ts, ...g)),
    ...rw.newWorlds.map((code) => D.prepare(`INSERT OR IGNORE INTO kids_rewards (child_id, kind, code, earned_at) SELECT ?,?,?,? WHERE ${NOT_SEEN}`).bind(c.id, 'world', code, ts, ...g)),
    D.prepare(`INSERT OR IGNORE INTO kids_game_sessions (id, child_id, game_id, level, level_before, level_after, seed, theme_id, started_at, ended_at, duration_ms, completed, trials_json, performance, accuracy, median_rt_ms, errors, stars, signals_json, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(b.sessionId, c.id, b.gameId, b.level, st.level, nextState.level, b.seed, b.themeId ?? null, new Date(startedMs).toISOString(), endedAt, b.durationMs, b.completed ? 1 : 0, JSON.stringify(b.trials), metrics.performance, metrics.accuracy, metrics.medianRtMs, metrics.errors, rw.stars, JSON.stringify(signals), ts),
  ];
  const res = await D.batch(stmts);
  const inserted = (res[res.length - 1].meta?.changes ?? 0) > 0;
  const fresh = await loadStates(env, c);
  if (!inserted) return json({ ok: true, duplicate: true, result: { stars: rw.stars, levelUp: false }, sync: statesDto(fresh) });
  return json({
    ok: true, duplicate: false,
    // No numbers about "how well": stars, XP, badges, worlds — and a gentle sentence.
    result: { stars: rw.stars, xp: rw.xp, levelUp: decision.delta > 0, personalBest: rw.personalBest, newBadges: rw.newBadges.map((code) => ({ code, ...BADGES[code] })), newWorlds: rw.newWorlds.map((code) => WORLDS.find((w) => w.code === code)) },
    sync: statesDto(fresh), // device-local adaptive state for offline play; never rendered
  });
}

/** The child's own progress: stars, worlds, badges, personal stage per game. Never another child's data, never a ranking. */
export async function childProgress(req: Request, env: Env) {
  const c = await requireChild(req, env);
  const states = await loadStates(env, c);
  const rewards = (await env.DB.prepare('SELECT kind, code FROM kids_rewards WHERE child_id = ?').bind(c.id).all<{ kind: string; code: string }>()).results;
  const days = (await loadSessions(env, c.id, Date.now() - 40 * DAY_MS, 400)).map((s) => localDay(s.at));
  return json({
    xp: c.xp, stars: c.stars, gamesPlayed: c.games_completed, streakDays: streakOf(days, todayKey()),
    worlds: WORLDS.map((w) => ({ ...w, unlocked: c.xp >= w.xp })),
    badges: Object.entries(BADGES).map(([code, b]) => ({ code, ...b, earned: rewards.some((r) => r.kind === 'badge' && r.code === code) })),
    games: GAME_IDS.map((g) => ({ gameId: g, ...withMeta(g), stage: states[g].level, plays: states[g].plays })),
    sync: statesDto(states),
  });
}

// ---------- parent: dashboard & reports ----------
export async function parentDashboard(env: Env, parentId: string, childId: string) {
  const c = await ownedChild(env, parentId, childId);
  const now = Date.now(), age = currentAge(c);
  const [signals, sessions, states] = [await loadSignals(env, c.id, now), await loadSessions(env, c.id, now - 90 * DAY_MS), await loadStates(env, c)];
  const growth = computeSkillGrowth(signals, CFG);
  const week = sessions.filter((s) => Date.parse(s.at) >= now - 7 * DAY_MS), month = sessions.filter((s) => Date.parse(s.at) >= now - 30 * DAY_MS);
  const report = buildReport('week', signals, week, CFG);
  const overall = dailySeries(signals);
  const skillDto = growth.map((g) => ({ skill: g.skill, name: SKILL_META[g.skill].name, emoji: SKILL_META[g.skill].emoji, label: LABEL_FA[g.label], labelCode: g.label, trend: g.trend, trendText: TREND_FA[g.trend], arrow: ARROW[g.trend], score: g.score, samples: g.samples, series: g.series }));
  return json({
    child: childDto(c), notice: report.disclaimer,
    status: { band: levelBandLabel(c.current_level, age, CFG), stage: c.current_stage, lastPlayedAt: c.last_played_at, gamesCompleted: c.games_completed, totalPlayMinutes: Math.round(c.total_play_ms / 60_000), streakDays: streakOf(sessions.map((s) => localDay(s.at)), todayKey(now)), stars: c.stars },
    skills: skillDto,
    overall: { series: overall, trend: overall.length >= 4 ? trendOf(overall.map((p) => p.value), CFG) : 'insufficient' },
    strengths: report.strengths.map((s) => ({ skill: s, name: SKILL_META[s].name, emoji: SKILL_META[s].emoji })),
    needsPractice: report.needsPractice.map((s) => ({ skill: s, name: SKILL_META[s].name, emoji: SKILL_META[s].emoji })),
    activity: { week: activityStats(week), month: activityStats(month), stagesGained: month.filter((s) => s.levelAfter > s.levelBefore).length },
    learning: learningCurve(sessions),
    games: GAME_IDS.map((g) => ({ gameId: g, title: GAME_META[g].title, skill: GAME_SPECS[g].skill, stage: states[g].level, band: levelBandLabel(states[g].level, age, CFG), plays: states[g].plays })),
    recentGames: sessions.slice(0, 10).map((s) => ({ gameId: s.gameId, title: GAME_META[s.gameId].title, at: s.at, minutes: Math.max(1, Math.round(s.durationMs / 60_000)), stars: s.stars, completed: s.completed })),
    recommendations: report.recommendations.map((r) => ({ ...r, gameTitle: GAME_META[r.gameId].title })),
    weekly: report.summary,
  });
}
export async function parentReport(req: Request, env: Env, parentId: string, childId: string) {
  const c = await ownedChild(env, parentId, childId);
  const period = new URL(req.url).searchParams.get('period') === 'month' ? 'month' : 'week';
  const now = Date.now();
  const signals = await loadSignals(env, c.id, now);
  const sessions = await loadSessions(env, c.id, now - (period === 'week' ? 7 : 30) * DAY_MS);
  return json({ child: childDto(c), ...buildReport(period, signals, sessions, CFG), generatedAt: new Date(now).toISOString() });
}
/** Spec alias: GET /api/kids/report?childId=…&period=week|month (parent auth). */
export async function parentReportQuery(req: Request, env: Env, parentId: string) {
  const childId = new URL(req.url).searchParams.get('childId') ?? '';
  return parentReport(req, env, parentId, childId);
}
