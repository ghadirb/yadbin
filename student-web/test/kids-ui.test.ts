// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findBanned, GAME_IDS, THEMES, type GameId } from '../../core/kids';
import { createParentApp } from '../src/kids/ui/parent';
import { defaultCtx } from '../src/kids/ui/common';
import { runGame } from '../src/kids/ui/games';
import { homeScreen, progressScreen, resultScreen } from '../src/kids/ui/screens';
import { lineChart } from '../src/kids/ui/charts';
import { kidsRoute } from '../src/kids/main';
import { MemoryKv } from '../src/storage/kv';

const ctx = () => ({ ...defaultCtx({ sound: false, reduceMotion: true }), speed: 0.002 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A "random child": taps whatever is tappable until the game resolves. Proves every view completes without help and without errors. */
async function randomChild(gameId: GameId, level: number, quitAfterMs?: number) {
  const root = document.createElement('div'); document.body.append(root);
  const c = ctx(); let rng = 7; const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
  const p = runGame(root, gameId, level, `ui-${gameId}`, THEMES[1], c);
  const iv = setInterval(() => {
    const t = [...root.querySelectorAll<HTMLButtonElement>('.play-body .tile, .play-body .react-stage')].filter((b) => !b.disabled);
    if (t.length) t[Math.floor(rand() * t.length)].click();
  }, 3);
  if (quitAfterMs) setTimeout(() => (root.querySelector('.quit') as HTMLButtonElement).click(), quitAfterMs);
  const raw = await Promise.race([p, sleep(15000).then(() => 'timeout' as const)]);
  clearInterval(iv);
  return { raw, text: root.textContent ?? '' };
}

describe('game views (DOM)', () => {
  for (const g of ['memory_match', 'visual_attention', 'pattern_logic', 'reaction_control', 'rule_switch'] as GameId[]) {
    it(`${g}: a child tapping at random reaches the end; trials are recorded; no test-like wording`, async () => {
      const { raw, text } = await randomChild(g, 3);
      expect(raw).not.toBe('timeout'); expect(raw).not.toBeNull();
      const r = raw as any; expect(r.trials.length).toBeGreaterThan(0); expect(r.gameId).toBe(g); expect(r.level).toBe(3);
      expect(findBanned(text)).toEqual([]);
      if (g !== 'memory_match') expect(r.completed).toBe(true);
    });
  }
  it('path_puzzle: renders, accepts taps (walls bump), and the child can always leave', async () => {
    const { raw } = await randomChild('path_puzzle', 2, 400); expect(raw).not.toBe('timeout');
  });
  it('leaving before doing anything records nothing', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const p = runGame(root, 'pattern_logic', 3, 'q', THEMES[0], ctx()); (root.querySelector('.quit') as HTMLButtonElement).click(); expect(await p).toBeNull();
  });
  it('every touch target is a real, labelled button (accessibility)', async () => {
    const root = document.createElement('div'); document.body.append(root);
    void runGame(root, 'rule_switch', 4, 'a11y', THEMES[0], { ...ctx(), speed: 1 });
    await sleep(20);
    for (const b of root.querySelectorAll('button')) expect(b.getAttribute('aria-label') || b.textContent).toBeTruthy();
  });
});

describe('screens', () => {
  it('home: three journey cards, rest banner disables the rest, offline message', () => {
    const root = document.createElement('div');
    const items = [{ gameId: 'memory_match' as GameId, level: 4, done: true, order: 1 }, { gameId: 'pattern_logic' as GameId, level: 4, done: false, order: 2 }, { gameId: 'rule_switch' as GameId, level: 4, done: false, order: 3 }];
    homeScreen(root, { profile: { name: 'سارا', avatar: '🦊', age: 7, xp: 5, stars: 2, gamesPlayed: 1, badges: [], worlds: [] }, items, rest: { text: '🌱 وقت یک استراحت کوتاهه!' }, allDone: false, pending: 2, online: false }, { play: () => {}, progress: () => {}, settings: () => {} });
    expect(root.querySelectorAll('.journey-card')).toHaveLength(3); expect(root.querySelectorAll('.journey-card:disabled')).toHaveLength(2);
    expect(root.textContent).toContain('سارا'); expect(root.textContent).toContain('استراحت'); expect(findBanned(root.textContent!)).toEqual([]);
  });
  it('result: at least one star always, friendly wording, next button only when there is a next game', async () => {
    const root = document.createElement('div');
    await resultScreen(root, { stars: 1, xp: 18, levelUp: true, personalBest: false, newBadges: ['first_game'], newWorlds: ['sea'] }, 'memory_match', { next: null, home: () => {} });
    expect(root.querySelector('.stars')!.getAttribute('aria-label')).toBe('1 ستاره'); expect(root.textContent).toContain('مرحلهٔ بعد باز شد'); expect(root.textContent).toContain('آفرین');
    expect(root.textContent).not.toMatch(/اشتباه|شکست|باختی|ضعیف|نمره/);
  });
  it('progress: stars, worlds, badges — and no ranking / comparison', () => {
    const root = document.createElement('div'); progressScreen(root, { xp: 130, stars: 9, streakDays: 3, badges: [{ code: 'first_game', earned: true }], games: [{ emoji: '🐰', title: 'خانه‌ها را پیدا کن', stage: 4 }] }, null, () => {});
    expect(root.querySelectorAll('.world.on').length).toBe(2); expect(root.textContent).not.toMatch(/رتبه|برترین|جدول/);
  });
  it('routes: pairing link, child home, parent — everything else is not Kids', () => {
    expect(kidsRoute('/kids/c/kc_' + 'A'.repeat(32))).toEqual({ kind: 'link', token: 'kc_' + 'A'.repeat(32) }); expect(kidsRoute('/kids')).toEqual({ kind: 'child' }); expect(kidsRoute('/kids/parent')).toEqual({ kind: 'parent' });
    expect(kidsRoute('/play/ABCDEFGHJKLMNPQR')).toBeNull(); expect(kidsRoute('/kids/c/short')).toBeNull(); expect(kidsRoute('/kidsx')).toBeNull();
  });
});

describe('parent app', () => {
  const dash = { child: { id: 'c1', name: 'سارا', age: 7 }, notice: 'فقط عملکرد مشاهده‌شده در بازی‌ها.', status: { band: '7', stage: '7', lastPlayedAt: '2026-03-10T08:00:00Z', gamesCompleted: 12, totalPlayMinutes: 30, streakDays: 3, stars: 20 },
    skills: [{ skill: 'memory', name: 'حافظه', emoji: '🧠', label: 'خوب', labelCode: 'good', trend: 'up', trendText: 'رو به رشد', arrow: '↑', score: 72, samples: 8, series: [{ day: '2026-03-01', value: 60 }, { day: '2026-03-05', value: 70 }, { day: '2026-03-09', value: 75 }] }, { skill: 'logic', name: 'منطق و الگو', emoji: '🔷', label: 'در حال جمع‌آوری', labelCode: 'collecting', trend: 'insufficient', trendText: 'هنوز داده کافی نیست', arrow: '…', score: null, samples: 1, series: [] }],
    overall: { series: [{ day: '2026-03-01', value: 60 }, { day: '2026-03-09', value: 75 }], trend: 'up' }, strengths: [{ name: 'حافظه', emoji: '🧠' }], needsPractice: [], activity: { week: { games: 5, activeDays: 3 }, month: { games: 12 }, stagesGained: 1 }, learning: { points: [] },
    recentGames: [{ title: 'خانه‌ها را پیدا کن', minutes: 2, stars: 3, at: '2026-03-10T08:00:00Z' }], recommendations: [{ text: 'بازی‌های «منطق و الگو» برای ۳ جلسهٔ آینده', gameTitle: 'ادامهٔ ماجرا' }], weekly: 'این هفته کودک در بازی‌های حافظه پیشرفت بیشتری نشان داده است.' };
  const ok = (data: any) => Promise.resolve({ kind: 'ok' as const, data });
  const api: any = { parent: { home: () => ok({ parent: { name: 'م' }, children: [{ id: 'c1', name: 'سارا', age: 7, avatar: '🦊', lastPlayedAt: null, gamesCompleted: 0 }], avatars: [] }), dashboard: () => ok(dash), login: () => ok({ token: 't' }) } };
  it('signed-out parents see the login form; signed-in parents see children, then the growth dashboard with charts and gentle wording', async () => {
    const root = document.createElement('div'); document.body.append(root); const store = new MemoryKv();
    await createParentApp(root, api, store, () => {}, () => {}).start(); expect(root.querySelector('#p-phone')).not.toBeNull();
    await store.set('kidsp:token', 'jwt'); await createParentApp(root, api, store, () => {}, () => {}).start(); expect(root.textContent).toContain('سارا');
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('رشد'))!.click(); await sleep(20);
    expect(root.querySelectorAll('.skill')).toHaveLength(2); expect(root.querySelector('svg.chart-svg')).not.toBeNull(); expect(root.textContent).toContain('هنوز داده کافی نیست');
    expect(root.textContent).toContain('فقط عملکرد مشاهده‌شده'); expect(findBanned(root.textContent!)).toEqual([]);
  });
  it('charts: honest when data is thin, accessible summary when there is data', () => {
    expect(lineChart([{ day: '2026-03-01', value: 50 }], { title: 'x' }).getAttribute('aria-label')).toContain('هنوز'); const c = lineChart([{ day: '2026-03-01', value: 50 }, { day: '2026-03-02', value: 70 }], { title: 'حافظه' });
    expect(c.querySelector('svg')!.getAttribute('aria-label')).toContain('از 50 به 70');
  });
});
void GAME_IDS;
