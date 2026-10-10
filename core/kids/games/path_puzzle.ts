import { shuffle } from '../rng';
import type { GameInput, Rng, Theme } from '../types';
import { GAME_SPECS } from './specs';
import { BaseGame } from './base';

export interface Puzzle { size: number; walls: number[]; start: number; goal: number; stars: number[]; optimal: number }
export interface PathView { round: number; rounds: number; size: number; walls: number[]; pos: number; goal: number; stars: number[]; collected: number[]; steps: number; bumps: number; done: boolean }
interface P { rounds: number; size: number; stars: number; walls: number }

const neighbors = (i: number, n: number, blocked: Set<number>) => {
  const r = Math.floor(i / n), c = i % n, out: number[] = [];
  if (r > 0) out.push(i - n); if (r < n - 1) out.push(i + n); if (c > 0) out.push(i - 1); if (c < n - 1) out.push(i + 1);
  return out.filter((x) => !blocked.has(x));
};
export function bfs(from: number, n: number, blocked: Set<number>): number[] {
  const d = new Array(n * n).fill(-1); d[from] = 0; const q = [from];
  for (let h = 0; h < q.length; h++) for (const nb of neighbors(q[h], n, blocked)) if (d[nb] < 0) { d[nb] = d[q[h]] + 1; q.push(nb); }
  return d;
}
const permutations = <T>(a: T[]): T[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));

/** Always solvable: walls are only kept if start, every star and the goal stay connected. `optimal` = shortest tour start→stars→goal. */
export function makePuzzle(size: number, walls: number, stars: number, rng: Rng): Puzzle {
  const n = size, total = n * n;
  for (let attempt = 0; attempt < 500; attempt++) {
    const start = 0, goal = total - 1;
    const free = Array.from({ length: total }, (_, i) => i).filter((i) => i !== start && i !== goal);
    const sh = shuffle(free, rng);
    const starCells = sh.slice(0, stars); const wallCells = new Set(sh.slice(stars, stars + Math.min(walls, free.length - stars)));
    const d0 = bfs(start, n, wallCells);
    if ([goal, ...starCells].some((c) => d0[c] < 0)) continue;
    let best = Infinity;
    for (const perm of permutations(starCells)) {
      let cur = start, len = 0, ok = true;
      for (const t of [...perm, goal]) { const d = bfs(cur, n, wallCells)[t]; if (d < 0) { ok = false; break; } len += d; cur = t; }
      if (ok) best = Math.min(best, len);
    }
    if (best < Infinity && best >= n) return { size: n, walls: [...wallCells].sort((a, b) => a - b), start, goal, stars: starCells, optimal: best };
  }
  return { size: n, walls: [], start: 0, goal: total - 1, stars: [], optimal: 2 * (n - 1) }; // open board fallback
}

export class PathPuzzleGame extends BaseGame<PathView> {
  private idx = 0; private pz!: Puzzle; private pos = 0; private collected = new Set<number>(); private steps = 0; private bumps = 0; private shownAt = 0;
  constructor(level: number, seed: string, theme: Theme) { super(GAME_SPECS.path_puzzle, level, seed, theme); }
  private get p() { return this.difficulty as unknown as P; }
  protected onStart(now: number) { this.next(now); }
  private next(now: number) { this.pz = makePuzzle(this.p.size, this.p.walls, this.p.stars, this.rng); this.pos = this.pz.start; this.collected.clear(); this.steps = 0; this.bumps = 0; this.shownAt = now; }
  view(): PathView { const z = this.pz; return { round: this.idx, rounds: this.p.rounds, size: z?.size ?? 0, walls: z?.walls ?? [], pos: this.pos, goal: z?.goal ?? 0, stars: z?.stars ?? [], collected: [...this.collected], steps: this.steps, bumps: this.bumps, done: this.done }; }
  private endPuzzle(now: number, solved: boolean) {
    const detours = Math.max(0, this.steps - this.pz.optimal);
    this.record({ correct: solved, rtMs: Math.round(now - this.shownAt), errors: this.bumps + Math.min(detours, 12), attempts: Math.max(1, this.steps) });
    this.idx++;
    if (this.idx >= this.p.rounds) this.finishNaturally(); else this.next(now);
  }
  handleInput(input: GameInput, now: number): PathView {
    if (this.done || input.type !== 'move') return this.view();
    const t = Number(input.index), n = this.pz.size;
    if (!Number.isInteger(t) || t < 0 || t >= n * n || t === this.pos) return this.view();
    const walls = new Set(this.pz.walls);
    const adjacent = neighbors(this.pos, n, new Set()).includes(t);
    if (!adjacent) return this.view();            // tapping far away is just ignored
    if (walls.has(t)) { this.bumps++; return this.view(); }
    this.pos = t; this.steps++;
    if (this.pz.stars.includes(t)) this.collected.add(t);
    if (t === this.pz.goal && this.collected.size === this.pz.stars.length) this.endPuzzle(now, true);
    else if (this.steps > this.pz.optimal * 4 + 6) this.endPuzzle(now, false); // gentle stop; the next puzzle starts
    return this.view();
  }
  /** Bot helper: the next cell on a shortest route to the next target. */
  hint(): number {
    const n = this.pz.size, walls = new Set(this.pz.walls);
    const remaining = this.pz.stars.filter((s) => !this.collected.has(s));
    const target = remaining.length ? remaining.sort((a, b) => bfs(this.pos, n, walls)[a] - bfs(this.pos, n, walls)[b])[0] : this.pz.goal;
    const d = bfs(target, n, walls);
    return neighbors(this.pos, n, walls).sort((a, b) => d[a] - d[b])[0];
  }
}
