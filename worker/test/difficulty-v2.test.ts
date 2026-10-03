import { describe, expect, it } from 'vitest';
import { buildPools } from '../src/questions/generate';
import { problemComplexity } from '../src/questions/generate-v2';
import { tuningFor, tuningForV2 } from '../src/education/tuning';

type T = -1 | 0 | 1;
const TUNINGS: T[] = [-1, 0, 1];
const pool = (game: any, level: 1 | 2 | 3, count: number, t: T) => buildPools(game, 'seed-x', [level], count, t, 2)[level] as any[];

describe('generator v2 — difficulty really changes the parameters', () => {
  it('memory: more items and less display time as the level rises, in every band', () => {
    for (const t of TUNINGS) {
      const m = [1, 2, 3].map((l) => pool('memory', l as 1 | 2 | 3, 10, t));
      const maxLen = m.map((p) => Math.max(...p.map((q) => q.sequence.length)));
      const dur = m.map((p) => p[0].displayDuration);
      expect(maxLen[0]).toBeLessThan(maxLen[1]); expect(maxLen[1]).toBeLessThan(maxLen[2]);
      expect(dur[0]).toBeGreaterThan(dur[1]); expect(dur[1]).toBeGreaterThan(dur[2]);
    }
  });
  it('attention: bigger grid / less time never goes backwards with the level', () => {
    for (const t of TUNINGS) {
      const a = [1, 2, 3].map((l) => pool('attention', l as 1 | 2 | 3, 6, t)[0]);
      expect(a[0].gridSize).toBeLessThanOrEqual(a[1].gridSize); expect(a[1].gridSize).toBeLessThanOrEqual(a[2].gridSize);
      expect(a[0].timeLimit).toBeGreaterThan(a[1].timeLimit); expect(a[1].timeLimit).toBeGreaterThan(a[2].timeLimit);
    }
  });
  it('younger band is easier, older band harder, at the same level', () => {
    for (const l of [1, 2, 3] as const) {
      const len = (t: T) => Math.max(...pool('memory', l, 10, t).map((q) => q.sequence.length));
      expect(len(-1)).toBeLessThanOrEqual(len(0)); expect(len(0)).toBeLessThanOrEqual(len(1));
      expect(pool('memory', l, 10, -1)[0].displayDuration).toBeGreaterThan(pool('memory', l, 10, 1)[0].displayDuration);
    }
  });
});

describe('generator v2 — no sudden jump inside a 10-item activity', () => {
  it('memory: sequence length never decreases and never jumps by more than 1', () => {
    for (const t of TUNINGS) for (const l of [1, 2, 3] as const) {
      const lens = pool('memory', l, 10, t).map((q) => q.sequence.length);
      for (let i = 1; i < lens.length; i++) { expect(lens[i] - lens[i - 1]).toBeGreaterThanOrEqual(0); expect(lens[i] - lens[i - 1]).toBeLessThanOrEqual(1); }
    }
  });
  it('memory hard limits: ≤ 7 items, ≥ 2, reverse only at level 3, never in the youngest band, only on the shortest sequences', () => {
    for (const t of TUNINGS) for (const l of [1, 2, 3] as const) for (const q of pool('memory', l, 10, t)) {
      expect(q.sequence.length).toBeLessThanOrEqual(7); expect(q.sequence.length).toBeGreaterThanOrEqual(2);
      expect(new Set(q.sequence).size).toBe(q.sequence.length);
      if (q.isReverse) { expect(l).toBe(3); expect(t).not.toBe(-1); expect(q.sequence.length).toBeLessThanOrEqual(5); }
    }
  });
  it('attention: targets to find never drop and never jump by more than 1 between items (same rule phase)', () => {
    for (const t of TUNINGS) {
      const p = pool('attention', 2, 10, t);
      for (let i = 1; i < p.length; i++) expect(Math.abs(p[i].targetCount - p[i - 1].targetCount)).toBeLessThanOrEqual(1);
      expect(p.every((q) => q.timeLimit === p[0].timeLimit)).toBe(true);
    }
  });
  it('problem solving: presentation order is a ramp (bank level, then simple → pattern → multi-step); no upward borrowing before downward', () => {
    for (const t of TUNINGS) for (const l of [1, 2, 3] as const) {
      const p = pool('problem_solving', l, 10, t);
      expect(p.length).toBe(10);
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i];
        expect(b.difficulty > a.difficulty || (b.difficulty === a.difficulty && problemComplexity(b) >= problemComplexity(a))).toBe(true);
      }
      if (l === 2) expect(Math.max(...p.map((q) => q.difficulty))).toBeLessThanOrEqual(2 + (10 - 7 > 0 ? 1 : 0)); // level 2 has 7 questions → at most the 3 missing are borrowed
      if (l === 3) expect(p.filter((q) => q.difficulty === 3).length).toBeGreaterThanOrEqual(7);
    }
  });
  it('determinism: same seed → same pool; a different seed differs', () => {
    expect(JSON.stringify(pool('memory', 2, 10, 0))).toBe(JSON.stringify(pool('memory', 2, 10, 0)));
    expect(JSON.stringify(buildPools('memory', 'other', [2], 10, 0, 2))).not.toBe(JSON.stringify(buildPools('memory', 'seed-x', [2], 10, 0, 2)));
  });
});

describe('tuningForV2 — grade 6 is a normal grade, not the "older" band', () => {
  it('grade 6 + intermediate → band 0 (this was +1 in v1.2 and made the last memory items too hard)', () => {
    expect(tuningFor({ gradeOrder: 6 })).toBe(1); // legacy behaviour is preserved for old sessions
    expect(tuningForV2({ gradeOrder: 6 })).toBe(0);
    expect(tuningForV2({ gradeOrder: 6, level: 'intermediate' })).toBe(0);
    expect(tuningForV2({ gradeOrder: 6, level: 'basic' })).toBe(0);
  });
  it('other bands: preschool–2 → -1, 9+ → +1, age fallback, level nudges one step, grade wins over age', () => {
    expect(tuningForV2({})).toBe(0);
    expect(tuningForV2({ gradeOrder: 0 })).toBe(-1); expect(tuningForV2({ gradeOrder: 2 })).toBe(-1);
    expect(tuningForV2({ gradeOrder: 8 })).toBe(0); expect(tuningForV2({ gradeOrder: 9 })).toBe(1);
    expect(tuningForV2({ age: 7 })).toBe(-1); expect(tuningForV2({ age: 12 })).toBe(0); expect(tuningForV2({ age: 14 })).toBe(1);
    expect(tuningForV2({ gradeOrder: 6, level: 'advanced' })).toBe(1);
    expect(tuningForV2({ gradeOrder: 6, level: 'introductory' })).toBe(-1);
    expect(tuningForV2({ gradeOrder: 2, age: 14 })).toBe(-1);
  });
  it('acceptance case: grade 6 + intermediate, 10-question memory activity → every item ≤ 6 symbols, ≥ 1100 ms', () => {
    const t = tuningForV2({ gradeOrder: 6, level: 'intermediate' });
    for (const l of [1, 2, 3] as const) for (const q of pool('memory', l, 10, t)) {
      expect(q.sequence.length).toBeLessThanOrEqual(6); expect(q.displayDuration).toBeGreaterThanOrEqual(1100);
    }
  });
});
