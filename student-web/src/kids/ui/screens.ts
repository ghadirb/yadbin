import { BADGES, GAME_META, WORLDS, type GameId } from '../../../../core/kids';
import { bigButton, clear, h } from '../../components/dom';
import type { KidsEngine, LocalProfile, RewardView } from '../engine';
import { fa, stars, type Settings } from './common';

const ART: Record<string, string> = { forest: '🌲', sea: '🌊', desert: '🏜️', space: '🚀', castle: '🏰' };

export interface HomeData { profile: LocalProfile | null; items: { gameId: GameId; level: number; done: boolean; order: number }[]; rest: { text: string } | null; allDone: boolean; pending: number; online: boolean }

/** Child home: «🎮 بازی امروز». Minimum text, maximum picture. Never the words test / exam / score. */
export function homeScreen(root: HTMLElement, d: HomeData, a: { play: (g: GameId) => void; progress: () => void; settings: () => void }) {
  clear(root);
  const p = d.profile;
  const next = d.items.find((i) => !d.rest && !i.done);
  root.append(h('section', { class: 'kids-home' },
    h('header', { class: 'kids-top' },
      h('div', { class: 'hello' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, p?.avatar ?? '🦊'), h('div', {}, h('h1', {}, `سلام ${p?.name || 'قهرمان'}! 👋`), h('p', { class: 'sub' }, d.allDone ? '🎉 ماجراجویی امروز تمام شد!' : '🎮 بازی امروز'))),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'تنظیمات', onclick: a.settings }, '⚙️')),
    d.rest ? h('div', { class: 'rest', role: 'status' }, d.rest.text) : null,
    h('div', { class: 'journey' }, ...d.items.map((i) => h('button', { class: `journey-card ${i.done ? 'done' : ''} ${next === i ? 'next' : ''}`.trim(), type: 'button', disabled: (!!d.rest && !i.done) || undefined, 'aria-label': `${GAME_META[i.gameId].title}${i.done ? ' انجام شد' : ''}`, onclick: () => a.play(i.gameId) },
      h('span', { class: 'big-emoji' }, GAME_META[i.gameId].emoji), h('span', { class: 'jt' }, h('strong', {}, GAME_META[i.gameId].title), h('small', {}, GAME_META[i.gameId].story)), h('span', { class: 'jstate', 'aria-hidden': 'true' }, i.done ? '✅' : next === i ? '▶️' : '⭐')))),
    h('button', { class: 'btn primary wide', type: 'button', onclick: a.progress }, '🌟 پیشرفت من'),
    h('p', { class: 'sync', role: 'status' }, d.pending > 0 ? `☁️ ${fa(d.pending)} بازی منتظر ارسال است؛ نگران نباش، ذخیره شده.` : d.online ? '☁️ همه‌چیز ذخیره شد' : '📴 بدون اینترنت هم می‌توانی بازی کنی')));
}

export async function resultScreen(root: HTMLElement, r: RewardView, game: GameId, a: { next: (() => void) | null; home: () => void }) {
  clear(root);
  const lines = [
    r.levelUp ? h('p', { class: 'chip up' }, '🔓 مرحلهٔ بعد باز شد!') : null,
    r.personalBest ? h('p', { class: 'chip' }, '🌟 رکورد خودت را بهتر کردی!') : null,
    ...r.newBadges.map((b) => h('p', { class: 'chip' }, `${BADGES[b]?.emoji ?? '🏅'} ${BADGES[b]?.name ?? b}`)),
    ...r.newWorlds.map((w) => { const x = WORLDS.find((k) => k.code === w); return h('p', { class: 'chip up' }, `${x?.emoji ?? '🌍'} دنیای تازه: ${x?.name ?? w}`); }),
  ];
  root.append(h('section', { class: 'card center result' },
    h('h1', {}, 'آفرین! 🎉'), h('p', { class: 'stars', role: 'img', 'aria-label': `${r.stars} ستاره` }, stars(r.stars)),
    h('p', { class: 'end-line' }, `${GAME_META[game].emoji} ${GAME_META[game].title}`), h('p', { class: 'xp' }, `+${fa(r.xp)} امتیاز`), ...lines,
    a.next ? bigButton('بازی بعدی ▶️', a.next, 'primary') : null, bigButton('🏠 خانه', a.home, a.next ? '' : 'primary')));
}

export function progressScreen(root: HTMLElement, p: any, profile: LocalProfile | null, back: () => void) {
  clear(root);
  const xp = p?.xp ?? profile?.xp ?? 0; const nextW = WORLDS.find((w) => w.xp > xp); const prevW = [...WORLDS].reverse().find((w) => w.xp <= xp);
  const pct = nextW ? Math.round(((xp - (prevW?.xp ?? 0)) / (nextW.xp - (prevW?.xp ?? 0))) * 100) : 100;
  root.append(h('section', { class: 'kids-progress' },
    h('header', { class: 'kids-top' }, h('h1', {}, '🌟 پیشرفت من'), h('button', { class: 'icon', type: 'button', 'aria-label': 'برگشت', onclick: back }, '🏠')),
    h('div', { class: 'card center' }, h('p', { class: 'stars big' }, `⭐ ${fa(p?.stars ?? profile?.stars ?? 0)}`), h('p', {}, `${fa(xp)} امتیاز`),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }, h('span', { style: `width:${pct}%` })),
      h('p', { class: 'sub' }, nextW ? `تا ${nextW.emoji} ${nextW.name}` : '🏰 همهٔ دنیاها باز شد!'), p?.streakDays ? h('p', { class: 'chip' }, `🔥 ${fa(p.streakDays)} روز پشت سر هم`) : null),
    h('h2', {}, 'دنیاهای من'), h('div', { class: 'worlds' }, ...WORLDS.map((w) => h('div', { class: `world ${xp >= w.xp ? 'on' : 'off'}`, 'aria-label': `${w.name}${xp >= w.xp ? '' : ' قفل'}` }, h('span', { class: 'big-emoji' }, xp >= w.xp ? ART[w.code] : '🔒'), h('small', {}, w.name)))),
    h('h2', {}, 'مدال‌های من'), h('div', { class: 'badges' }, ...Object.entries(BADGES).map(([code, b]) => { const on = (p?.badges ?? []).some((x: any) => x.code === code && x.earned) || (profile?.badges ?? []).includes(code); return h('div', { class: `badge ${on ? 'on' : 'off'}`, 'aria-label': `${b.name}${on ? '' : ' هنوز باز نشده'}` }, h('span', { class: 'big-emoji' }, on ? b.emoji : '❔'), h('small', {}, b.name)); })),
    (p?.games?.length ?? 0) ? h('div', {}, h('h2', {}, 'مرحلهٔ من در هر بازی'), ...p.games.map((g: any) => h('p', { class: 'stage-row' }, `${g.emoji} ${g.title}`, h('strong', {}, `مرحلهٔ ${fa(g.stage)}`)))) : null));
}

export function settingsScreen(root: HTMLElement, s: Settings, a: { change: (s: Settings) => void; back: () => void }) {
  clear(root);
  const row = (label: string, key: keyof Settings) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: s[key] || undefined, onchange: (e: Event) => { a.change({ ...s, [key]: (e.target as HTMLInputElement).checked }); } }), h('span', {}, label));
  root.append(h('section', { class: 'card' }, h('h1', {}, '⚙️ تنظیمات'), row('🔊 صدا', 'sound'), row('🐢 حرکت‌های کمتر', 'reduceMotion'), h('p', { class: 'sub' }, 'پیوند بازی را فقط والد می‌تواند عوض کند.'), bigButton('🏠 خانه', a.back, 'primary')));
}

export function unpairedScreen(root: HTMLElement, goParent: () => void) {
  clear(root);
  root.append(h('section', { class: 'card center' }, h('h1', {}, 'سلام قهرمان! 👋'), h('p', { class: 'big-emoji' }, '🎮'), h('p', {}, 'برای شروع بازی، از پدر یا مادرت بخواه پیوند بازی تو را باز کنند.'), bigButton('👨‍👩‍👧 ورود والدین', goParent)));
}
