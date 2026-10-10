import '../styles.css';
import './kids.css';
import { GAME_META, THEMES, type GameId, type JourneyItem } from '../../../core/kids';
import { clear, h } from '../components/dom';
import { offlineBanner } from '../play/screens';
import { openStore, type KvStore } from '../storage/kv';
import { createKidsApi } from './api';
import { KidsEngine, uuid } from './engine';
import { defaultCtx, defaultSettings, type Settings } from './ui/common';
import { runGame } from './ui/games';
import { createParentApp } from './ui/parent';
import { homeScreen, progressScreen, resultScreen, settingsScreen, unpairedScreen } from './ui/screens';

export type KidsRoute = { kind: 'link'; token: string } | { kind: 'child' } | { kind: 'parent' } | null;
export function kidsRoute(path: string): KidsRoute {
  const link = /^\/kids\/c\/(kc_[A-Z2-9]{32})\/?$/.exec(path);
  if (link) return { kind: 'link', token: link[1] };
  if (/^\/kids\/parent\/?$/.test(path)) return { kind: 'parent' };
  if (/^\/kids\/?$/.test(path)) return { kind: 'child' };
  return null;
}

export async function bootKids(root: HTMLElement, route: NonNullable<KidsRoute>, base = (import.meta as any).env?.VITE_API_BASE ?? '') {
  root.classList.add('kids-root');
  root.before(offlineBanner());
  if ('serviceWorker' in navigator && (import.meta as any).env?.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const store: KvStore = await openStore();
  let childToken: string | null = null, parentToken: string | null = null;
  const api = createKidsApi(base, { child: () => childToken, parent: () => parentToken });
  const eng = new KidsEngine(store, api);
  const goChild = () => { history.replaceState(null, '', '/kids'); void childApp(); };
  const goParent = () => { history.replaceState(null, '', '/kids/parent'); void parentApp(); };

  async function parentApp() { await createParentApp(root, api, store, (t) => { parentToken = t; }, goChild).start(); }

  async function childApp() {
    childToken = await eng.getToken();
    if (!childToken) return unpairedScreen(root, goParent);
    const state = await eng.refresh();
    if (state.error === 'unauthorized') { await eng.signOut(); childToken = null; return unpairedScreen(root, goParent); }
    let settings = (await store.get<Settings>('kids:settings')) ?? defaultSettings();
    root.classList.toggle('reduce', settings.reduceMotion);
    let pending = await eng.pending();
    const stop = eng.autoSync((left) => { pending = left; });
    void stop;

    const home = async () => {
      const [j, profile, left] = [await eng.journey(), await eng.profile(), await eng.pending()];
      homeScreen(root, { profile, items: j.journey.items.map((i) => ({ gameId: i.gameId, level: i.level, done: i.done, order: i.order })), rest: j.rest, allDone: j.allDone, pending: left, online: navigator.onLine }, {
        play: (g) => void play(j.journey.items.find((i) => i.gameId === g)!, j.journey.items),
        progress: () => void showProgress(), settings: () => settingsScreen(root, settings, { change: async (s) => { settings = s; root.classList.toggle('reduce', s.reduceMotion); await store.set('kids:settings', s); settingsScreen(root, s, { change: () => {}, back: () => void home() }); void home(); }, back: () => void home() }),
      });
    };
    const showProgress = async () => { const r = await api.progress(); progressScreen(root, r.kind === 'ok' ? r.data : null, await eng.profile(), () => void home()); };
    const play = async (item: JourneyItem & { done?: boolean }, all: (JourneyItem & { done: boolean })[]) => {
      const theme = THEMES.find((t) => t.id === item.themeId) ?? THEMES[0];
      const sessionId = uuid(), startedAt = Date.now();
      const raw = await runGame(root, item.gameId, item.level, item.seed, theme, defaultCtx(settings));
      if (!raw) return void home();
      const rw = await eng.finishGame(raw, { sessionId, themeId: theme.id, startedAt });
      void eng.flush().then(() => eng.refresh().catch(() => {}));
      if (settings.sound) defaultCtx(settings).sound.win();
      const rest = (await eng.journey()).journey.items.find((i) => !i.done && i.gameId !== item.gameId);
      await resultScreen(root, rw, item.gameId, { next: rest ? () => void play(rest, all) : null, home: () => void home() });
    };
    await home();
    void GAME_META; void clear; void h;
  }

  if (route.kind === 'link') { await eng.signOut(); await eng.setToken(route.token); history.replaceState(null, '', '/kids'); return childApp(); }
  if (route.kind === 'parent') return parentApp();
  return childApp();
}
export type { GameId };
