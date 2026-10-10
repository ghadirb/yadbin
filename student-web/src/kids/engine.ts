import {
  adapt, baseLevelForAge, buildDailyJourney, computeMetrics, computeSkillGrowth, DEFAULT_KIDS_CONFIG, evaluateRewards, GAME_IDS, GAME_SPECS, initialAdaptiveState, localDay, restAdvice, REST_TEXT,
  skillSignals, themeFor, worldsFor, type AdaptiveState, type GameId, type Journey, type JourneyItem, type SessionRaw, type SignalRecord,
} from '../../../core/kids';
import type { KvStore } from '../storage/kv';
import type { KidsApi } from './api';

export type States = Record<GameId, AdaptiveState & { bestPerformance: number | null; lastTheme: string | null }>;
export interface LocalProfile { name: string; avatar: string; age: number; xp: number; stars: number; gamesPlayed: number; badges: string[]; worlds: string[] }
export interface HistoryItem { gameId: GameId; at: string; durationMs: number; performance: number; level: number; stars: number }
export interface QueuedResult { sessionId: string; queuedAt: number; payload: any }
export interface RewardView { stars: 1 | 2 | 3; xp: number; levelUp: boolean; personalBest: boolean; newBadges: string[]; newWorlds: string[] }

const K = { token: 'kids:token', profile: 'kids:profile', states: 'kids:states', history: 'kids:history', signals: 'kids:signals', journey: (d: string) => `kids:journey:${d}`, queue: (id: string) => `kids:queue:${id}` };
export const QUEUE_PREFIX = 'kids:queue:';
const MAX_HISTORY = 80, MAX_SIGNALS = 160;
export const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`).replace(/[^A-Za-z0-9_-]/g, '');

/**
 * Device-side brain of Yadbin Kids. Everything a child needs to keep playing (journey, levels, rewards) is derived from the SAME
 * pure core the Worker uses, so it works with no network; the Worker stays the source of truth and its state wins on every sync.
 */
export class KidsEngine {
  private flushing: Promise<void> | null = null;
  constructor(readonly store: KvStore, readonly api: KidsApi, readonly now: () => number = Date.now, readonly cfg = DEFAULT_KIDS_CONFIG) {}

  // ---- device pairing ----
  getToken() { return this.store.get<string>(K.token).then((t) => t ?? null); }
  async setToken(t: string) { await this.store.set(K.token, t); }
  async signOut() { for (const k of await this.store.keys('kids:')) await this.store.del(k); }

  // ---- local state ----
  async profile(): Promise<LocalProfile | null> { return (await this.store.get<LocalProfile>(K.profile)) ?? null; }
  async states(): Promise<States> {
    const saved = await this.store.get<States>(K.states); const p = await this.profile(); const age = p?.age ?? 7;
    return Object.fromEntries(GAME_IDS.map((g) => [g, saved?.[g] ?? { ...initialAdaptiveState(age, this.cfg), bestPerformance: null, lastTheme: null }])) as States;
  }
  async history(): Promise<HistoryItem[]> { return (await this.store.get<HistoryItem[]>(K.history)) ?? []; }
  private async signals(): Promise<SignalRecord[]> { return (await this.store.get<SignalRecord[]>(K.signals)) ?? []; }

  /** Refresh profile/progress from the server when online; silently keep the cache when offline. */
  async refresh(): Promise<{ online: boolean; error?: 'unauthorized' }> {
    const [pr, pg] = [await this.api.profile(), await this.api.progress()];
    if (pr.kind === 'http' && pr.status === 401) return { online: true, error: 'unauthorized' };
    if (pr.kind !== 'ok') return { online: false };
    const cur = await this.profile();
    // never roll back rewards we earned offline but have not synced yet
    const pending = (await this.store.keys(QUEUE_PREFIX)).length > 0;
    if (!pending || !cur) await this.store.set(K.profile, { name: pr.data.name, avatar: pr.data.avatar, age: pr.data.age, xp: pr.data.xp, stars: pr.data.stars, gamesPlayed: pg.kind === 'ok' ? pg.data.gamesPlayed : cur?.gamesPlayed ?? 0, badges: pr.data.badges, worlds: pr.data.worlds } satisfies LocalProfile);
    else await this.store.set(K.profile, { ...cur, name: pr.data.name, avatar: pr.data.avatar, age: pr.data.age });
    if (pg.kind === 'ok' && !pending) await this.adoptServerStates(pg.data.sync);
    return { online: true };
  }
  private async adoptServerStates(sync: any) {
    if (!sync) return;
    const cur = await this.states();
    for (const g of GAME_IDS) if (sync[g]) cur[g] = { ...sync[g] };
    await this.store.set(K.states, cur);
  }

  // ---- journey ----
  async journey(): Promise<{ journey: { day: string; estimatedMinutes: number; items: (JourneyItem & { done: boolean })[] }; rest: { text: string; reason: string } | null; allDone: boolean; fromServer: boolean }> {
    const day = localDay(new Date(this.now()).toISOString());
    const hist = await this.history();
    const todays = hist.filter((h) => localDay(h.at) === day);
    const doneIds = new Set(todays.map((h) => h.gameId));
    const r = await this.api.journey();
    let base: Journey | null = null; let fromServer = false;
    if (r.kind === 'ok' && r.data?.items) {
      base = { day: r.data.day, estimatedMinutes: r.data.estimatedMinutes, items: r.data.items.map(({ order, gameId, skill, level, seed, themeId }: JourneyItem) => ({ order, gameId, skill, level, seed, themeId })) };
      r.data.items.forEach((i: any) => { if (i.done) doneIds.add(i.gameId); });
      await this.store.set(K.journey(day), base); fromServer = true;
    } else base = (await this.store.get<Journey>(K.journey(day))) ?? null;
    if (!base || base.day !== day) { base = await this.buildLocal(day, hist); await this.store.set(K.journey(day), base); }
    const rest = restAdvice(todays.map((h) => ({ at: h.at, durationMs: h.durationMs })), this.now(), this.cfg);
    const items = base.items.map((i) => ({ ...i, done: doneIds.has(i.gameId) }));
    return { journey: { ...base, items }, rest: rest.rest ? { text: REST_TEXT[rest.reason as 'in_a_row' | 'daily_cap'], reason: rest.reason as string } : null, allDone: items.every((i) => i.done), fromServer };
  }
  private async buildLocal(day: string, hist: HistoryItem[]): Promise<Journey> {
    const p = await this.profile(); const states = await this.states();
    const growth = computeSkillGrowth(await this.signals(), this.cfg);
    return buildDailyJourney({
      childKey: (await this.getToken())?.slice(3, 15) ?? 'device', age: p?.age ?? 7, day, nowIso: new Date(this.now()).toISOString(),
      recent: hist.map((h) => ({ gameId: h.gameId, at: h.at, durationMs: h.durationMs, performance: h.performance })),
      levels: Object.fromEntries(GAME_IDS.map((g) => [g, states[g].level])) as any, growth,
      playCounts: Object.fromEntries(GAME_IDS.map((g) => [g, states[g].plays])), lastTheme: Object.fromEntries(GAME_IDS.filter((g) => states[g].lastTheme).map((g) => [g, states[g].lastTheme as string])), cfg: this.cfg,
    });
  }
  themeIdFor(item: JourneyItem) { return item.themeId ?? themeFor('device', item.gameId, 0).id; }

  // ---- finishing a game: local-first ----
  /** Records a finished game on the device and queues it. Safe to call with a flaky network; nothing here needs it. */
  async finishGame(raw: SessionRaw, meta: { sessionId?: string; themeId?: string; startedAt?: number }): Promise<RewardView> {
    const sessionId = meta.sessionId ?? uuid();
    const metrics = computeMetrics(raw);
    const p = (await this.profile()) ?? { name: '', avatar: '🦊', age: 7, xp: 0, stars: 0, gamesPlayed: 0, badges: [], worlds: [] };
    const states = await this.states(); const st = states[raw.gameId];
    const { state: next, decision } = adapt({ level: st.level, history: st.history, sessionsAtLevel: st.sessionsAtLevel, cooldown: st.cooldown, plays: st.plays }, metrics.performance, p.age, this.cfg);
    const endedAt = new Date(this.now()).toISOString();
    const hist = await this.history();
    const day = localDay(endedAt);
    const days = [...new Set([...hist.map((h) => localDay(h.at)), day])];
    const streak = streakOf(days, day);
    const journey = await this.store.get<Journey>(K.journey(day));
    const doneToday = new Set(hist.filter((h) => localDay(h.at) === day).map((h) => h.gameId));
    const jDone = (extra?: GameId) => !!journey && journey.items.every((i) => doneToday.has(i.gameId) || i.gameId === extra);
    const rw = evaluateRewards({ performance: metrics.performance, level: raw.level, levelUp: decision.delta > 0, previousBest: st.bestPerformance, totalSessionsBefore: p.gamesPlayed, gamesPlayedBefore: [...new Set(hist.map((h) => h.gameId))], gameId: raw.gameId, streakDays: streak, journeyJustCompleted: !jDone() && jDone(raw.gameId), recoveryDelta: metrics.recoveryDelta, xpBefore: p.xp, badgesHeld: p.badges });

    states[raw.gameId] = { ...next, bestPerformance: Math.max(st.bestPerformance ?? 0, metrics.performance), lastTheme: meta.themeId ?? st.lastTheme };
    await this.store.set(K.states, states);
    await this.store.set(K.profile, { ...p, xp: rw.xpAfter, stars: p.stars + rw.stars, gamesPlayed: p.gamesPlayed + 1, badges: [...p.badges, ...rw.newBadges], worlds: worldsFor(rw.xpAfter) } satisfies LocalProfile);
    await this.store.set(K.history, [...hist, { gameId: raw.gameId, at: endedAt, durationMs: raw.durationMs, performance: metrics.performance, level: raw.level, stars: rw.stars }].slice(-MAX_HISTORY));
    const sigs = skillSignals(raw, metrics, baseLevelForAge(p.age, this.cfg)).map((s) => ({ ...s, at: endedAt }));
    await this.store.set(K.signals, [...(await this.signals()), ...sigs].slice(-MAX_SIGNALS));

    // WRITE-AHEAD: the result is on disk before any network call, so closing the tab can never lose a finished game.
    const startedAt = new Date(meta.startedAt ?? this.now() - raw.durationMs).toISOString();
    const payload = { sessionId, gameId: raw.gameId, level: raw.level, seed: raw.seed, themeId: meta.themeId, startedAt, durationMs: raw.durationMs, completed: raw.completed, trials: raw.trials };
    await this.store.set(K.queue(sessionId), { sessionId, queuedAt: this.now(), payload } satisfies QueuedResult);
    return { stars: rw.stars, xp: rw.xp, levelUp: decision.delta > 0, personalBest: rw.personalBest, newBadges: rw.newBadges, newWorlds: rw.newWorlds };
  }

  // ---- sync ----
  async pending(): Promise<number> { return (await this.store.keys(QUEUE_PREFIX)).length; }
  /** Sends queued results oldest-first. Idempotent on the server (same sessionId ⇒ stored once), so retries/double flushes are harmless. */
  flush(): Promise<{ sent: number; left: number }> {
    const run = async () => {
      let sent = 0;
      const items = (await Promise.all((await this.store.keys(QUEUE_PREFIX)).map((k) => this.store.get<QueuedResult>(k)))).filter((x): x is QueuedResult => !!x).sort((a, b) => a.queuedAt - b.queuedAt);
      for (const q of items) {
        const r = await this.api.result(q.payload);
        if (r.kind === 'ok') { await this.store.del(K.queue(q.sessionId)); sent++; if (r.data?.sync && (await this.pending()) === 0) await this.adoptServerStates(r.data.sync); }
        else if (r.kind === 'http' && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429 && r.status !== 401) await this.store.del(K.queue(q.sessionId)); // permanently invalid: retrying can never succeed
        else break;                                                                                                                                                               // network down / 5xx / rate-limited / re-pairing needed: keep & stop (preserve order)
      }
      return { sent, left: await this.pending() };
    };
    const chain = (this.flushing ?? Promise.resolve()).then(run);
    this.flushing = chain.then(() => undefined, () => undefined);
    return chain;
  }
  /** Retry on reconnect and on a timer. Returns a stop function. */
  autoSync(onChange: (left: number) => void, intervalMs = 20000): () => void {
    let stopped = false;
    const tick = async () => { if (stopped) return; try { const r = await this.flush(); onChange(r.left); } catch { /* retry next tick */ } };
    const timer = setInterval(tick, intervalMs);
    if (typeof window !== 'undefined') window.addEventListener('online', tick);
    void tick();
    return () => { stopped = true; clearInterval(timer); if (typeof window !== 'undefined') window.removeEventListener('online', tick); };
  }
  specFor(g: GameId) { return GAME_SPECS[g]; }
}

export function streakOf(days: string[], today: string): number {
  const set = new Set(days); const DAY = 86_400_000; const step = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  let d = set.has(today) ? today : step(today); let n = 0;
  while (set.has(d)) { n++; d = step(d); }
  return n;
}
