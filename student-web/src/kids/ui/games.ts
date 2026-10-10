import { createGame, GAME_META, type GameId, type SessionRaw, type Theme } from '../../../../core/kids';
import { itemKey, type PItem } from '../../../../core/kids/games/pattern_logic';
import { clear, h } from '../../components/dom';
import { wait, type PlayCtx } from './common';

/**
 * DOM views for the six games. Each view is a thin renderer over the pure game state machine in core/kids/games:
 * it forwards taps as inputs (with a timestamp) and draws the returned view model. Resolves with the raw trials, or null if the
 * child left before doing anything. The view never computes a score.
 */
export interface GameRun { raw: SessionRaw | null }
export type Runner = (root: HTMLElement, gameId: GameId, level: number, seed: string, theme: Theme, ctx: PlayCtx) => Promise<SessionRaw | null>;

function frame(root: HTMLElement, gameId: GameId, theme: Theme, onQuit: () => void, hint?: string) {
  clear(root);
  const body = h('div', { class: 'play-body', 'aria-live': 'polite' });
  const quit = h('button', { class: 'quit', type: 'button', 'aria-label': 'برگشت به خانه', onclick: onQuit }, '🏠');
  root.append(h('section', { class: `play ${theme.bg}`, 'data-game': gameId }, h('header', { class: 'play-head' }, quit, h('div', { class: 'play-title' }, `${GAME_META[gameId].emoji} ${GAME_META[gameId].title}`)), hint ? h('p', { class: 'play-hint' }, hint) : null, body));
  return body;
}
const shakeIf = (el: HTMLElement, ctx: PlayCtx) => { if (!ctx.reduceMotion) { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 400); } };

export const runGame: Runner = (root, gameId, level, seed, theme, ctx) =>
  new Promise<SessionRaw | null>((resolve) => {
    const game: any = createGame(gameId, level, seed, theme);
    const t0 = ctx.now(); const T = () => ctx.now() - t0;
    let closed = false;
    const finish = (natural: boolean) => {
      if (closed) return; closed = true;
      const raw: SessionRaw = game.finish(T());
      resolve(raw.trials.length === 0 && !natural ? null : raw);
    };
    const body = frame(root, gameId, theme, () => finish(false), GAME_META[gameId].story);
    const guard = (fn: () => void) => { if (!closed) fn(); };
    const doneCheck = async () => { if (game.isDone()) { await wait(ctx, 600); finish(true); return true; } return false; };
    game.start(T());
    VIEWS[gameId]({ body, game, T, ctx, theme, guard, doneCheck, isClosed: () => closed });
  });

interface V { body: HTMLElement; game: any; T: () => number; ctx: PlayCtx; theme: Theme; guard: (f: () => void) => void; doneCheck: () => Promise<boolean>; isClosed: () => boolean }

const VIEWS: Record<GameId, (v: V) => void> = {
  // ---------- 1. Memory Match: find the matching cards ----------
  memory_match({ body, game, T, ctx, guard, doneCheck }) {
    const render = () => guard(() => {
      const v = game.view(); clear(body);
      body.append(h('p', { class: 'meter' }, `${'🟢'.repeat(v.matchedPairs)}${'⚪'.repeat(v.pairs - v.matchedPairs)}`));
      const cols = v.cards.length <= 6 ? 3 : 4;
      const grid = h('div', { class: 'grid', style: `--n:${cols}` });
      v.cards.forEach((c: any) => {
        const open = c.faceUp || c.matched;
        grid.append(h('button', { class: `tile card ${open ? 'open' : ''} ${c.matched ? 'matched' : ''}`.trim(), type: 'button', 'aria-label': open ? `کارت ${c.symbol}` : 'کارت پنهان', 'aria-pressed': open ? 'true' : 'false', disabled: v.phase === 'peek' || undefined,
          onclick: async () => {
            if (v.phase !== 'play') return; const before = game.view();
            const after = game.handleInput({ type: 'flip', index: c.id }, T()); render();
            if (after.matchedPairs > before.matchedPairs) ctx.sound.good();
            if (after.locked) { ctx.sound.soft(); await wait(ctx, 900); guard(() => { game.handleInput({ type: 'resolve' }, T()); render(); }); }
            await doneCheck();
          } }, open ? c.symbol : '❓'));
      });
      body.append(grid);
    });
    render();
    const peek = game.view().peekMs;
    body.prepend(h('p', { class: 'say' }, 'خوب نگاه کن! 👀'));
    wait(ctx, peek).then(() => guard(() => { game.handleInput({ type: 'peekEnd' }, T()); render(); }));
  },

  // ---------- 2. Visual Attention: find the friend ----------
  visual_attention({ body, game, T, ctx, guard, doneCheck }) {
    let roundToken = 0;
    const render = () => guard(() => {
      const v = game.view(); clear(body);
      body.append(h('p', { class: 'say big' }, `پیداش کن: ${v.target}`), h('p', { class: 'meter' }, `${'🔸'.repeat(v.round)}${'▫️'.repeat(v.rounds - v.round)}`));
      const grid = h('div', { class: 'grid', style: `--n:${v.grid}` });
      v.cells.forEach((c: string, i: number) => {
        const found = v.found.includes(i), wrong = v.wrong.includes(i);
        const el = h('button', { class: `tile kcell ${found ? 'found' : ''} ${wrong ? 'wrong' : ''}`.trim(), type: 'button', 'aria-label': `${c}${found ? ' پیدا شد' : ''}`, onclick: async (e: Event) => {
          const round = game.view().round; const after = game.handleInput({ type: 'tap', index: i }, T());
          if (after.round !== round || after.done) { ctx.sound.good(); roundToken++; render(); await doneCheck(); startTimer(); return; }
          if (after.wrong.includes(i)) { ctx.sound.soft(); shakeIf(e.currentTarget as HTMLElement, ctx); } else ctx.sound.good();
          render();
        } }, found ? `${c}✔` : wrong ? `${c}✖` : c);
        grid.append(el);
      });
      body.append(grid);
    });
    const startTimer = () => {
      if (game.isDone()) return; const tok = ++roundToken; const round = game.view().round;
      wait(ctx, game.view().timeLimitMs).then(() => guard(() => { if (tok === roundToken && game.view().round === round && !game.isDone()) { game.handleInput({ type: 'timeout' }, T()); render(); doneCheck().then((d) => { if (!d) startTimer(); }); } }));
    };
    render(); startTimer();
  },

  // ---------- 3. Pattern Logic: what comes next ----------
  pattern_logic({ body, game, T, ctx, guard, doneCheck }) {
    const show = (it: PItem | null, hidden = false) => {
      if (hidden || !it) return h('span', { class: 'p-item hidden', 'aria-label': 'جای خالی' }, '❓');
      const txt = it.n ? it.s.repeat(it.n) : it.s;
      return h('span', { class: `p-item ${it.c ?? ''}`.trim(), 'aria-label': txt }, txt);
    };
    const render = () => guard(() => {
      const v = game.view(); clear(body);
      body.append(h('p', { class: 'say' }, 'بعدش چی می‌آید؟'), h('p', { class: 'meter' }, `${'🔷'.repeat(v.round)}${'◽'.repeat(v.rounds - v.round)}`));
      body.append(h('div', { class: 'p-row' }, ...v.sequence.map((it: PItem | null) => show(it, it === null))));
      body.append(h('div', { class: 'p-options' }, ...v.options.map((o: PItem, i: number) => h('button', { class: `tile kopt ${o.c ?? ''}`.trim(), type: 'button', 'aria-label': `گزینه ${i + 1}`, key: itemKey(o), onclick: async () => {
        const ok = i === game.correctIndex(); ok ? ctx.sound.good() : ctx.sound.soft();
        game.handleInput({ type: 'choose', index: i }, T()); render(); await doneCheck();
      } }, o.n ? o.s.repeat(o.n) : o.s))));
    });
    render();
  },

  // ---------- 4. Reaction Control: catch the bunny, let the wolf sleep ----------
  async reaction_control({ body, game, T, ctx, guard, doneCheck, isClosed }) {
    const v0 = game.view();
    const stage = h('button', { class: 'react-stage', type: 'button', 'aria-label': 'ضربه بزن' }, '…');
    const msg = h('p', { class: 'say big' }, 'آماده؟');
    body.append(msg, h('p', { class: 'say' }, '🐰 را بگیر · 🐺 خوابیده، دست نزن!'), stage);
    let tapped = false, active = false;
    stage.addEventListener('click', () => { if (active && !tapped) { tapped = true; } });
    await wait(ctx, 1200);
    for (let i = 0; i < v0.trials && !isClosed(); i++) {
      msg.textContent = `${'🟣'.repeat(i)}${'⚪'.repeat(v0.trials - i)}`; stage.textContent = '·'; stage.className = 'react-stage';
      await wait(ctx, game.view().gapMs);
      if (isClosed()) return;
      tapped = false; game.handleInput({ type: 'show' }, T()); active = true;
      const go = game.currentStimulus() === 'go';
      stage.textContent = go ? '🐰' : '🐺💤'; stage.className = `react-stage ${go ? 'go' : 'nogo'}`;
      const tapAt = await new Promise<number | null>((res) => { const iv = setInterval(() => { if (tapped) { clearInterval(iv); res(T()); } }, 8); wait(ctx, game.view().windowMs).then(() => { clearInterval(iv); res(tapped ? T() : null); }); });
      active = false; if (isClosed()) return;
      game.handleInput(tapAt === null ? { type: 'timeout' } : { type: 'tap' }, tapAt ?? T());
      const ok = go ? tapAt !== null : tapAt === null;
      stage.textContent = ok ? '✨' : '🙈'; ok ? ctx.sound.good() : ctx.sound.soft(); await wait(ctx, 350);
    }
    guard(() => { void doneCheck(); });
  },

  // ---------- 5. Path Puzzle: collect the stars, reach home ----------
  path_puzzle({ body, game, T, ctx, guard, doneCheck, theme }) {
    const render = () => guard(() => {
      const v = game.view(); clear(body);
      const left = v.stars.length - v.collected.length;
      body.append(h('p', { class: 'say' }, left > 0 ? `⭐ ${left} ستاره مانده، بعد برو خانه 🏡` : 'حالا برو خانه 🏡'), h('p', { class: 'meter' }, `${'🧩'.repeat(v.round)}${'◽'.repeat(v.rounds - v.round)}`));
      const grid = h('div', { class: 'grid path', style: `--n:${v.size}` });
      for (let i = 0; i < v.size * v.size; i++) {
        const wall = v.walls.includes(i), here = i === v.pos, star = v.stars.includes(i) && !v.collected.includes(i), goal = i === v.goal;
        const glyph = here ? theme.emojis[0] : wall ? '🪨' : star ? '⭐' : goal ? '🏡' : '';
        grid.append(h('button', { class: `tile pcell ${wall ? 'wall' : ''} ${here ? 'here' : ''}`.trim(), type: 'button', 'aria-label': here ? 'تو اینجایی' : wall ? 'سنگ' : star ? 'ستاره' : goal ? 'خانه' : 'راه', onclick: async (e: Event) => {
          const before = game.view(); const after = game.handleInput({ type: 'move', index: i }, T());
          if (after.bumps > before.bumps) { ctx.sound.soft(); shakeIf(e.currentTarget as HTMLElement, ctx); } else if (after.pos !== before.pos) { after.collected.length > before.collected.length || after.round > before.round ? ctx.sound.good() : undefined; }
          render(); await doneCheck();
        } }, glyph));
      }
      body.append(grid);
    });
    render();
  },

  // ---------- 6. Rule Switch: the magic rule changes ----------
  rule_switch({ body, game, T, ctx, guard, doneCheck }) {
    const swatch = (c: 'red' | 'blue') => h('span', { class: `sw ${c === 'red' ? 'c-red' : 'c-blue'}`, 'aria-hidden': 'true' });
    const shape = (s: 'circle' | 'square', c: 'red' | 'blue') => h('span', { class: `shape ${s} ${c === 'red' ? 'c-red' : 'c-blue'}`, 'aria-label': `${s === 'circle' ? 'دایره' : 'مربع'} ${c === 'red' ? 'قرمز' : 'آبی'}` });
    const render = () => guard(() => {
      const v = game.view(); clear(body);
      const cue = v.rule === 'color' ? '🎨 بر اساس رنگ' : '🔷 بر اساس شکل';
      body.append(h('p', { class: 'meter' }, `${'🟡'.repeat(v.index)}${'⚪'.repeat(v.trials - v.index)}`));
      body.append(v.showCue || v.ruleJustChanged ? h('div', { class: `rule-cue ${v.ruleJustChanged ? 'changed' : ''}`.trim(), role: 'status' }, v.ruleJustChanged ? `🔀 قانون عوض شد! ${cue}` : cue) : h('div', { class: 'rule-cue ghost' }, '❔'));
      if (v.card) body.append(h('div', { class: 'card-stage' }, shape(v.card.shape, v.card.color)));
      const L = v.rule === 'color' ? swatch('red') : shape('circle', 'red'), R = v.rule === 'color' ? swatch('blue') : shape('square', 'blue');
      const choose = (side: 'left' | 'right') => { const ok = !v.card ? false : (v.rule === 'color' ? (v.card.color === 'red') === (side === 'left') : (v.card.shape === 'circle') === (side === 'left')); ok ? ctx.sound.good() : ctx.sound.soft(); game.handleInput({ type: 'choose', side }, T()); render(); void doneCheck(); };
      body.append(h('div', { class: 'bins' }, h('button', { class: 'tile bin', type: 'button', 'aria-label': 'سمت چپ', onclick: () => choose('left') }, L), h('button', { class: 'tile bin', type: 'button', 'aria-label': 'سمت راست', onclick: () => choose('right') }, R)));
    });
    render();
  },
};
