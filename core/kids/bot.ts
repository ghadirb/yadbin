import { THEMES } from './content';
import { createGame } from './games';
import { correctSide } from './games/rule_switch';
import { makeRng } from './rng';
import type { GameId, SessionRaw } from './types';

/**
 * A scripted "child" for tests: plays any game through the public GameInstance contract. `accuracy` = chance of a correct move.
 * Used by Worker, student-web and e2e tests (no browser needed to exercise the real engines).
 */
export function playBot(gameId: GameId, level: number, seed: string, accuracy = 1, themeIndex = 0): SessionRaw {
  const rng = makeRng(`bot|${seed}`);
  const g: any = createGame(gameId, level, seed, THEMES[themeIndex % THEMES.length]);
  let t = 1000; g.start(t); let guard = 0;
  const good = () => rng() < accuracy;
  if (gameId === 'memory_match') {
    const v0 = g.view(); const pos = new Map<string, number[]>(); v0.cards.forEach((c: any) => pos.set(c.symbol, [...(pos.get(c.symbol) ?? []), c.id]));
    g.handleInput({ type: 'peekEnd' }, (t += 2000));
    const pairs = [...pos.values()];
    for (const [a, b] of pairs) {
      if (g.isDone()) break;
      if (!good() && pairs.length > 1) { const other = pairs.find((p) => p[0] !== a)!; g.handleInput({ type: 'flip', index: a }, (t += 900)); g.handleInput({ type: 'flip', index: other[0] }, (t += 900)); g.handleInput({ type: 'resolve' }, (t += 800)); }
      g.handleInput({ type: 'flip', index: a }, (t += 900)); g.handleInput({ type: 'flip', index: b }, (t += 900));
    }
  } else if (gameId === 'visual_attention') {
    while (!g.isDone() && guard++ < 200) {
      const v = g.view(); const wrongCell = v.cells.findIndex((c: string) => c !== v.target);
      if (!good()) { g.handleInput({ type: 'tap', index: wrongCell }, (t += 700)); g.handleInput({ type: 'timeout' }, (t += 9000)); continue; }
      v.cells.forEach((c: string, i: number) => { if (c === v.target) g.handleInput({ type: 'tap', index: i }, (t += 650)); });
    }
  } else if (gameId === 'pattern_logic') {
    while (!g.isDone() && guard++ < 200) { const c = g.correctIndex(); const n = g.view().options.length; g.handleInput({ type: 'choose', index: good() ? c : (c + 1) % n }, (t += 1800)); }
  } else if (gameId === 'reaction_control') {
    while (!g.isDone() && guard++ < 200) {
      g.handleInput({ type: 'show' }, (t += 800)); const go = g.currentStimulus() === 'go'; const ok = good();
      const tap = ok ? go : !go;
      g.handleInput(tap ? { type: 'tap' } : { type: 'timeout' }, (t += tap ? 480 : 1500));
    }
  } else if (gameId === 'path_puzzle') {
    while (!g.isDone() && guard++ < 3000) {
      if (!good()) { const v = g.view(); const w = v.walls[0]; g.handleInput({ type: 'move', index: w ?? 0 }, (t += 600)); }
      g.handleInput({ type: 'move', index: g.hint() }, (t += 700));
    }
  } else {
    while (!g.isDone() && guard++ < 200) { const v = g.view(); const side = correctSide(v.card, v.rule); g.handleInput({ type: 'choose', side: good() ? side : side === 'left' ? 'right' : 'left' }, (t += v.ruleJustChanged ? 1500 : 900)); }
  }
  return g.finish(t);
}
