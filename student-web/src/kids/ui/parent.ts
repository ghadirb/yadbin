import { AVATARS, SKILL_META } from '../../../../core/kids';
import { bigButton, clear, h } from '../../components/dom';
import type { KvStore } from '../../storage/kv';
import type { KidsApi } from '../api';
import { barRow, lineChart } from './charts';
import { fa } from './common';

const PT = 'kidsp:token';
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fa-IR', { month: 'long', day: 'numeric' }) : 'هنوز بازی نکرده');
const ARROW_CLASS: Record<string, string> = { up: 'up', stable: 'flat', down: 'down', insufficient: 'na' };

/** Parent dashboard app (/kids/parent). Separate sign-in, never reachable with a child link. Plain, calm language: observed play, not verdicts. */
export function createParentApp(root: HTMLElement, api: KidsApi, store: KvStore, setToken: (t: string | null) => void, goChild: () => void) {
  const view = (...c: (Node | null)[]) => { clear(root); root.append(h('div', { class: 'parent' }, ...c)); };
  const err = (msg: string) => h('p', { class: 'form-error', role: 'alert' }, msg);
  const topbar = (title: string, back?: () => void) => h('header', { class: 'ptop' }, back ? h('button', { class: 'icon', type: 'button', 'aria-label': 'برگشت', onclick: back }, '→') : null, h('h1', {}, title), h('button', { class: 'link', type: 'button', onclick: async () => { await store.del(PT); setToken(null); auth(); } }, 'خروج'));

  async function start() {
    const t = await store.get<string>(PT);
    if (!t) return auth();
    setToken(t); const r = await api.parent.home();
    if (r.kind === 'ok') return home(r.data);
    if (r.kind === 'http' && r.status === 401) { await store.del(PT); setToken(null); return auth(); }
    view(h('p', { class: 'card' }, 'اتصال برقرار نشد. اینترنت را بررسی و دوباره تلاش کنید.'), bigButton('تلاش دوباره', () => void start(), 'primary'));
  }

  function auth(mode: 'login' | 'register' | 'reset' = 'login', message = '') {
    const f = (id: string, label: string, type = 'text', extra: Record<string, any> = {}) => h('label', { class: 'field' }, h('span', {}, label), h('input', { id, type, required: true, autocomplete: 'off', ...extra }));
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
    const errBox = h('div', {}, message ? err(message) : null);
    const submit = async () => {
      const phone = val('p-phone').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
      const r = mode === 'register' ? await api.parent.register({ name: val('p-name'), phone, password: val('p-pass') }) : mode === 'login' ? await api.parent.login({ phone, password: val('p-pass') }) : await api.parent.reset({ phone, recoveryCode: val('p-code'), newPassword: val('p-pass') });
      if (r.kind === 'ok') { await store.set(PT, r.data.token); setToken(r.data.token); return r.data.recoveryCode ? recovery(r.data.recoveryCode) : void start(); }
      errBox.replaceChildren(err(r.kind === 'http' ? r.message : 'اتصال برقرار نشد.'));
    };
    view(h('section', { class: 'card' }, h('h1', {}, '👨‍👩‍👧 والدین'), h('p', { class: 'sub' }, 'اینجا فقط والدین گزارش رشد کودک را می‌بینند.'),
      mode === 'register' ? f('p-name', 'نام شما') : null, f('p-phone', 'شماره موبایل', 'tel', { inputmode: 'numeric', dir: 'ltr' }), mode === 'reset' ? f('p-code', 'کد بازیابی', 'text', { dir: 'ltr' }) : null,
      f('p-pass', mode === 'reset' ? 'رمز عبور جدید' : 'رمز عبور', 'password', { minlength: 8 }), errBox, bigButton(mode === 'register' ? 'ساخت حساب' : mode === 'login' ? 'ورود' : 'تغییر رمز', () => void submit(), 'primary'),
      h('p', { class: 'row' }, mode !== 'login' ? h('button', { class: 'link', type: 'button', onclick: () => auth('login') }, 'ورود') : null, mode !== 'register' ? h('button', { class: 'link', type: 'button', onclick: () => auth('register') }, 'حساب جدید') : null, mode !== 'reset' ? h('button', { class: 'link', type: 'button', onclick: () => auth('reset') }, 'فراموشی رمز') : null),
      h('p', { class: 'fine' }, 'اگر کودک شما فقط می‌خواهد بازی کند، از والدین بخواهید پیوند بازی او را باز کنند.'), h('button', { class: 'link', type: 'button', onclick: goChild }, '🎮 بازگشت به بازی')));
  }
  function recovery(code: string) {
    view(h('section', { class: 'card' }, h('h1', {}, '🔑 کد بازیابی'), h('p', {}, 'این کد را جای امنی نگه دارید. فقط با آن می‌توانید رمز را بازیابی کنید و دیگر نمایش داده نمی‌شود.'), h('p', { class: 'code', dir: 'ltr' }, code), bigButton('ذخیره کردم، ادامه', () => void start(), 'primary')));
  }

  function home(d: any) {
    const kids: any[] = d.children;
    view(topbar('کودکان من'),
      kids.length === 0 ? h('section', { class: 'card center' }, h('p', { class: 'big-emoji' }, '🧒'), h('p', {}, 'هنوز کودکی اضافه نکرده‌اید.')) : null,
      ...kids.map((c) => h('section', { class: 'card kid-row' }, h('span', { class: 'avatar' }, c.avatar), h('div', { class: 'grow' }, h('strong', {}, c.name), h('small', {}, `${fa(c.age)} ساله · آخرین بازی: ${when(c.lastPlayedAt)} · ${fa(c.gamesCompleted)} بازی`)),
        h('div', { class: 'row' }, bigButton('📈 رشد', () => void dashboard(c, d), 'primary'), h('button', { class: 'btn', type: 'button', onclick: () => void linkCard(c, d) }, '🔗 پیوند بازی')))),
      bigButton('➕ افزودن کودک', () => addChild(d), kids.length ? '' : 'primary'),
      h('details', { class: 'fine' }, h('summary', {}, 'حساب و حریم خصوصی'), h('p', {}, 'فقط نام (یا لقب)، سن و آواتار کودک نگهداری می‌شود. هیچ شمارهٔ تماس، مکان، عکس یا شناسهٔ دستگاهی ذخیره نمی‌شود و داده‌ها با کودکان دیگر مقایسه نمی‌شوند.'), h('button', { class: 'btn danger', type: 'button', onclick: () => void deleteAccount() }, 'حذف حساب و همهٔ داده‌ها')));
  }

  function addChild(d: any) {
    let avatar = AVATARS[0]; const errBox = h('div', {});
    const av = h('div', { class: 'avatars', role: 'radiogroup', 'aria-label': 'آواتار' }, ...AVATARS.map((a) => h('button', { class: `avatar-pick ${a === avatar ? 'on' : ''}`, type: 'button', role: 'radio', 'aria-checked': a === avatar ? 'true' : 'false', onclick: (e: Event) => { avatar = a; av.querySelectorAll('.avatar-pick').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); }); (e.currentTarget as HTMLElement).classList.add('on'); (e.currentTarget as HTMLElement).setAttribute('aria-checked', 'true'); } }, a)));
    const age = h('select', { id: 'c-age', 'aria-label': 'سن' }, ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => h('option', { value: String(n), selected: n === 7 || undefined }, `${fa(n)} ساله`)));
    view(topbar('کودک جدید', () => home(d)), h('section', { class: 'card' }, h('label', { class: 'field' }, h('span', {}, 'نام یا لقب'), h('input', { id: 'c-name', maxlength: 30, required: true })), h('label', { class: 'field' }, h('span', {}, 'سن'), age), av, errBox,
      bigButton('ساخت و دریافت پیوند بازی', async () => {
        const name = (document.getElementById('c-name') as HTMLInputElement).value.trim();
        const r = await api.parent.createChild({ name, age: Number((age as HTMLSelectElement).value), avatar });
        if (r.kind === 'ok') { const h2 = await api.parent.home(); return linkScreen(r.data.child, r.data.childLink, h2.kind === 'ok' ? h2.data : d); }
        errBox.replaceChildren(err(r.kind === 'http' ? r.message : 'اتصال برقرار نشد.'));
      }, 'primary')));
  }
  function linkScreen(c: any, link: string, d: any) {
    view(topbar('پیوند بازی', () => home(d)), h('section', { class: 'card' }, h('p', {}, `این پیوند را روی دستگاه ${c.name} باز کنید. بعد از اولین بار، بازی بدون ورود و حتی بدون اینترنت کار می‌کند.`), h('p', { class: 'code', dir: 'ltr' }, link),
      h('div', { class: 'row' }, bigButton('📋 کپی', async () => { try { await navigator.clipboard.writeText(link); } catch { /* manual copy */ } }, 'primary'),
        typeof navigator !== 'undefined' && 'share' in navigator ? bigButton('📤 اشتراک', () => void navigator.share({ url: link, title: 'یادبین کودک' }).catch(() => {})) : null),
      h('p', { class: 'fine' }, 'پیوند را فقط به خود کودک بدهید. اگر جای دیگری فرستاده شد، پیوند جدید بسازید؛ پیوند قبلی بی‌اثر می‌شود.')));
  }
  async function linkCard(c: any, d: any) {
    view(h('section', { class: 'card center' }, h('p', { class: 'big-emoji' }, '🔗'), h('p', {}, `برای ${c.name} پیوند تازه ساخته می‌شود و پیوند قبلی از کار می‌افتد.`), bigButton('ساخت پیوند تازه', async () => { const r = await api.parent.rotateLink(c.id); if (r.kind === 'ok') linkScreen(c, r.data.childLink, d); }, 'primary'), bigButton('انصراف', () => home(d))));
  }
  async function deleteAccount() {
    const pass = prompt('برای حذف همهٔ داده‌ها، رمز عبور را وارد کنید:'); if (!pass) return;
    const r = await api.parent.deleteAccount(pass);
    if (r.kind === 'ok') { await store.del(PT); setToken(null); auth('login', 'حساب و همهٔ داده‌ها حذف شد.'); } else alert(r.kind === 'http' ? r.message : 'اتصال برقرار نشد.');
  }

  async function dashboard(c: any, d: any) {
    view(topbar(`رشد ${c.name}`, () => home(d)), h('p', { class: 'card' }, 'در حال بارگذاری…'));
    const r = await api.parent.dashboard(c.id);
    if (r.kind !== 'ok') return view(topbar(c.name, () => home(d)), h('p', { class: 'card' }, 'دریافت گزارش ممکن نشد. اینترنت را بررسی کنید.'));
    const x = r.data; const sk: any[] = x.skills.filter((s: any) => s.skill !== 'learning' || s.samples > 0);
    const chip = (t: string) => h('span', { class: 'chip' }, t);
    view(topbar(`رشد ${c.name}`, () => home(d)),
      h('section', { class: 'card status' }, h('div', { class: 'row wrap' }, chip(`🕒 آخرین بازی: ${when(x.status.lastPlayedAt)}`), chip(`🎮 ${fa(x.status.gamesCompleted)} بازی`), chip(`⏱ ${fa(x.status.totalPlayMinutes)} دقیقه`), chip(`🔥 ${fa(x.status.streakDays)} روز پیاپی`), chip(`🧭 سطح فعلی: ${x.status.band}`))),
      h('section', { class: 'card' }, h('h2', {}, 'روند کلی'), lineChart(x.overall.series, { title: 'روند کلی' }), h('p', { class: 'sub' }, x.weekly)),
      h('section', { class: 'card' }, h('h2', {}, 'مهارت‌ها'), ...sk.map((s) => h('details', { class: 'skill' }, h('summary', {}, h('span', { class: 'sk-name' }, `${s.emoji} ${s.name}`), h('span', { class: `sk-label ${s.labelCode}` }, s.label), h('span', { class: `arrow ${ARROW_CLASS[s.trend]}`, 'aria-label': s.trendText }, `${s.arrow} ${s.trendText}`)), lineChart(s.series, { title: s.name, compact: true }), h('small', {}, s.score === null ? 'هنوز داده کافی نیست؛ چند بازی دیگر لازم است.' : `بر پایهٔ ${fa(s.samples)} نمونه بازی`)))),
      h('section', { class: 'card' }, h('h2', {}, 'نقاط قوت و تمرین بیشتر'), x.strengths.length ? h('p', {}, '💪 ', x.strengths.map((s: any) => `${s.emoji} ${s.name}`).join('، ')) : h('p', { class: 'sub' }, 'با بازی بیشتر، نقاط قوت نمایان می‌شود.'), x.needsPractice.length ? h('p', {}, '🌱 تمرین بیشتر: ', x.needsPractice.map((s: any) => `${s.emoji} ${s.name}`).join('، ')) : null,
        ...x.recommendations.map((rc: any) => h('p', { class: 'reco' }, `💡 ${rc.text} (${rc.gameTitle})`))),
      h('section', { class: 'card' }, h('h2', {}, 'فعالیت'), barRow('این هفته', x.activity.week.games, 21, `${fa(x.activity.week.games)} بازی`), barRow('این ماه', x.activity.month.games, 90, `${fa(x.activity.month.games)} بازی`), h('p', { class: 'sub' }, `${fa(x.activity.week.activeDays)} روز فعال در هفته · ${fa(x.activity.stagesGained)} مرحله باز شد`),
        h('h3', {}, 'بهتر شدن با تکرار'), lineChart(x.learning.points.map((p: any) => ({ day: p.at.slice(0, 10), value: p.performance })), { title: 'بهتر شدن با تکرار', compact: true })),
      h('section', { class: 'card' }, h('h2', {}, 'بازی‌های اخیر'), ...(x.recentGames.length ? x.recentGames.map((g: any) => h('p', { class: 'recent' }, `${g.title} · ${fa(g.minutes)} دقیقه · ${'⭐'.repeat(g.stars)}`, h('small', {}, ` ${when(g.at)}`))) : [h('p', { class: 'sub' }, 'هنوز بازی‌ای ثبت نشده است.')])),
      h('section', { class: 'card' }, h('div', { class: 'row' }, bigButton('📄 گزارش هفتگی', () => void report(c, d, 'week'), 'primary'), bigButton('📅 گزارش ماهانه', () => void report(c, d, 'month'))), h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (confirm(`همهٔ اطلاعات ${c.name} برای همیشه حذف شود؟`)) { const r2 = await api.parent.deleteChild(c.id); if (r2.kind === 'ok') void start(); } } }, 'حذف کودک و داده‌هایش')),
      h('p', { class: 'fine' }, x.notice));
  }

  async function report(c: any, d: any, period: 'week' | 'month') {
    const r = await api.parent.report(c.id, period);
    if (r.kind !== 'ok') return;
    const x = r.data;
    view(topbar(x.title, () => void dashboard(c, d)), h('section', { class: 'card report' }, h('h2', {}, `${c.name} — ${x.title}`), h('p', {}, x.summary),
      h('p', { class: 'sub' }, `${fa(x.games)} بازی · ${fa(x.playMinutes)} دقیقه · ${fa(x.activeDays)} روز فعال`),
      h('table', { class: 'rtable' }, h('tbody', {}, ...x.lines.map((l: any) => h('tr', {}, h('td', {}, `${l.emoji} ${l.name}`), h('td', {}, l.label), h('td', {}, `${l.arrow} ${l.trend}`))))),
      x.mostGrowth ? h('p', {}, `📈 بیشترین رشد: ${SKILL_META[x.mostGrowth as keyof typeof SKILL_META].name}`) : null, ...x.recommendations.map((rc: any) => h('p', { class: 'reco' }, `💡 ${rc.text}`)), h('p', { class: 'fine' }, x.disclaimer), bigButton('🖨 چاپ / ذخیره PDF', () => window.print())));
  }
  return { start };
}
