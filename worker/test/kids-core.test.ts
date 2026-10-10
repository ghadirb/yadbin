import { describe, expect, it } from 'vitest';
import {
  adapt, baseLevelForAge, buildDailyJourney, buildReport, computeMetrics, computeSkillGrowth, createGame, evaluateRewards, findBanned, GAME_IDS, GAME_META, GAME_SPECS,
  initialAdaptiveState, levelBandLabel, levelCeiling, levelFloor, makeRng, recommend, resolveConfig, restAdvice, REST_TEXT, SKILL_META, skillSignals, starsFor, THEMES, themeFor, trendOf,
  type AdaptiveState, type GameId, type SessionRaw, type SignalRecord, type Trial,
} from '../../core/kids';
import { itemKey, makePattern } from '../../core/kids/games/pattern_logic';
import { makeSequence } from '../../core/kids/games/reaction_control';
import { makePuzzle, bfs, PathPuzzleGame } from '../../core/kids/games/path_puzzle';
import { correctSide, RuleSwitchGame } from '../../core/kids/games/rule_switch';
import { MemoryMatchGame } from '../../core/kids/games/memory_match';
import { VisualAttentionGame } from '../../core/kids/games/visual_attention';
import { PatternLogicGame } from '../../core/kids/games/pattern_logic';
import { ReactionControlGame } from '../../core/kids/games/reaction_control';

const T = (correct: boolean, rtMs: number | null = 1500, errors = correct ? 0 : 1): Trial => ({ correct, rtMs, errors, attempts: 1 });
const raw = (gameId: GameId, trials: Trial[], completed = true, level = 3): SessionRaw => ({ gameId, level, seed: 's', trials, completed, durationMs: 60_000 });
const feed = (st: AdaptiveState, ps: number[], age = 7) => { let s = st, last = null as any; for (const p of ps) { const r = adapt(s, p, age); s = r.state; last = r.decision; } return { s, last }; };

describe('age baseline + hard ceiling', () => {
  it('age is only the starting point and the ceiling is configurable', () => {
    expect(baseLevelForAge(7)).toBe(4);
    expect(levelCeiling(7)).toBe(5);              // age_band 7 → max_allowed_band 8
    expect(levelFloor(7)).toBe(2);
    expect(levelCeiling(7, resolveConfig({ maxLevelsAboveBase: 2 }))).toBe(6); // 7++
    expect(levelBandLabel(5, 7)).toBe('7+');
    expect(levelBandLabel(3, 7)).toBe('7-');
    expect(levelBandLabel(4, 7)).toBe('7');
    expect(initialAdaptiveState(7).level).toBe(4);
    expect(baseLevelForAge(3)).toBe(1); expect(baseLevelForAge(40)).toBe(9); // clamped, never undefined
  });
});

describe('adaptive difficulty', () => {
  it('fail-safe: not enough data ⇒ level holds', () => {
    const r = adapt(initialAdaptiveState(7), 1, 7);
    expect(r.decision).toMatchObject({ delta: 0, reason: 'insufficient_data' }); expect(r.state.level).toBe(4);
  });
  it('goes up (by exactly one) after sustained strong performance', () => {
    const { s, last } = feed(initialAdaptiveState(7), [0.95, 0.95, 0.95]);
    expect(s.level).toBe(5); expect(last.reason === 'sustained_success' || s.level === 5).toBe(true);
  });
  it('goes down after consecutive struggling sessions', () => {
    const { s } = feed(initialAdaptiveState(7), [0.3, 0.3, 0.3]);
    expect(s.level).toBe(3);
  });
  it('a single catastrophic session lowers by one at most — never a collapse', () => {
    const base: AdaptiveState = { level: 4, history: [0.6, 0.6], sessionsAtLevel: 3, cooldown: 0, plays: 3 };
    const r = adapt(base, 0.05, 7); expect(r.state.level).toBe(3); expect(r.decision.reason).toBe('emergency');
  });
  it('never passes the hard ceiling no matter how well the child plays', () => {
    const { s } = feed(initialAdaptiveState(7), Array(40).fill(1));
    expect(s.level).toBe(levelCeiling(7));
  });
  it('never drops below the hard floor', () => {
    const { s } = feed(initialAdaptiveState(7), Array(40).fill(0.1));
    expect(s.level).toBeGreaterThanOrEqual(levelFloor(7));
  });
  it('never jumps: |Δlevel| ≤ 1 per session, for any performance stream', () => {
    const rng = makeRng('stream'); let s = initialAdaptiveState(9);
    for (let i = 0; i < 300; i++) { const r = adapt(s, rng(), 9); expect(Math.abs(r.state.level - s.level)).toBeLessThanOrEqual(1); expect(r.state.level).toBeLessThanOrEqual(levelCeiling(9)); expect(r.state.level).toBeGreaterThanOrEqual(levelFloor(9)); s = r.state; }
  });
  it('cooldown: two changes are never back to back', () => {
    const { s } = feed(initialAdaptiveState(7), [0.95, 0.95, 0.95]); // → level 5
    expect(s.cooldown).toBeGreaterThan(0);
    const r = adapt(s, 0.3, 7); expect(r.state.level).toBe(5);       // weak session inside cooldown: hold
    expect(adapt(s, 0.05, 7).state.level).toBe(4);                    // but a catastrophic one may protect the child, by one level only
  });
  it('fluctuating performance holds the level', () => {
    const st: AdaptiveState = { level: 4, history: [0.95, 0.2, 0.95], sessionsAtLevel: 5, cooldown: 0, plays: 5 };
    const r = adapt(st, 0.95, 7); expect(r.decision).toMatchObject({ delta: 0, reason: 'fluctuating' });
  });
  it('progression is not linear: steady middling play stays put', () => {
    const { s } = feed(initialAdaptiveState(7), Array(10).fill(0.65)); expect(s.level).toBe(4);
  });
  it('an age that no longer fits walks back inside the bounds one step at a time', () => {
    const r = adapt({ level: 9, history: [], sessionsAtLevel: 9, cooldown: 0, plays: 9 }, 0.9, 5);
    expect(r.state.level).toBe(8); expect(r.decision.reason).toBe('bounds_correction');
  });
});

describe('scoring', () => {
  it('accuracy, errors, attempts, completion, streak', () => {
    const m = computeMetrics(raw('pattern_logic', [T(true), T(true), T(false), T(true)]));
    expect(m.accuracy).toBe(0.75); expect(m.errors).toBe(1); expect(m.attempts).toBe(4); expect(m.completion).toBe(1); expect(m.bestStreak).toBe(2);
  });
  it('reaction time = median of valid times, ignoring withheld responses', () => {
    const m = computeMetrics(raw('reaction_control', [T(true, 400), T(true, 600), T(true, null), T(true, 500)]));
    expect(m.medianRtMs).toBe(500);
  });
  it('an abandoned game is scored on how far it got', () => {
    const half = computeMetrics(raw('pattern_logic', Array(4).fill(T(true)), false));
    const full = computeMetrics(raw('pattern_logic', Array(8).fill(T(true)), true));
    expect(half.completion).toBe(0.5); expect(half.performance).toBeLessThan(full.performance);
  });
  it('messy play scores lower than clean play at equal accuracy', () => {
    const clean = computeMetrics(raw('visual_attention', Array(8).fill(T(true, 1500, 0))));
    const messy = computeMetrics(raw('visual_attention', Array(8).fill(T(true, 1500, 3))));
    expect(messy.performance).toBeLessThan(clean.performance);
  });
  it('empty / garbage input never produces NaN', () => {
    const m = computeMetrics(raw('memory_match', [], false)); expect(m.performance).toBe(0); expect(Number.isFinite(m.completion)).toBe(true);
  });
  it('learning signal: improving within a session beats fading; speed needs accuracy', () => {
    const improving = computeMetrics(raw('memory_match', [T(false), T(false), T(false), T(true), T(true), T(true), T(true), T(true)]));
    const fading = computeMetrics(raw('memory_match', [T(true), T(true), T(true), T(true), T(false), T(false), T(false), T(false)]));
    const a = skillSignals(raw('memory_match', []), improving, 3).find((s) => s.skill === 'learning')!;
    const b = skillSignals(raw('memory_match', []), fading, 3).find((s) => s.skill === 'learning')!;
    expect(a.value).toBeGreaterThan(b.value);
    const fastWrong = computeMetrics(raw('reaction_control', Array(8).fill(T(false, 300))));
    const fastRight = computeMetrics(raw('reaction_control', Array(8).fill(T(true, 300))));
    const sp = (m: any) => skillSignals(raw('reaction_control', []), m, 3).find((s) => s.skill === 'processing_speed')!.value;
    expect(sp(fastRight)).toBeGreaterThan(sp(fastWrong));
  });
  it('harder levels weigh slightly more', () => {
    const m = computeMetrics(raw('pattern_logic', Array(8).fill(T(true))));
    const hi = skillSignals(raw('pattern_logic', [], true, 8), m, 4)[0].value, lo = skillSignals(raw('pattern_logic', [], true, 2), m, 4)[0].value;
    expect(hi).toBeGreaterThanOrEqual(lo);
  });
});

const sig = (skill: any, values: number[], startDay = 1): SignalRecord[] => values.map((value, i) => ({ skill, value, weight: 1, at: `2026-03-${String(startDay + i).padStart(2, '0')}T08:00:00Z` }));
describe('growth engine', () => {
  const g = (xs: SignalRecord[]) => computeSkillGrowth(xs).find((s) => s.skill === (xs[0]?.skill ?? 'memory'))!;
  it('minimum sample size: no score and no trend with too little data', () => {
    const r = g(sig('memory', [90, 90])); expect(r.score).toBeNull(); expect(r.trend).toBe('insufficient'); expect(r.label).toBe('collecting');
  });
  it('detects growth, stability, and decline', () => {
    expect(g(sig('memory', [50, 52, 55, 70, 74, 78])).trend).toBe('up');
    expect(g(sig('attention', [70, 71, 69, 70, 72, 70])).trend).toBe('stable');
    expect(g(sig('logic', [80, 78, 75, 55, 52, 50])).trend).toBe('down');
  });
  it('moving average: one bad game does not collapse the profile or flip the trend', () => {
    const before = g(sig('memory', [80, 80, 80, 80, 80])).score!;
    const after = g(sig('memory', [80, 80, 80, 80, 80, 30]));
    expect(before - after.score!).toBeLessThan(10); expect(after.trend).toBe('stable');
  });
  it('is stable & deterministic: same input ⇒ same output', () => {
    const xs = sig('memory', [60, 62, 64, 66, 70]); expect(computeSkillGrowth(xs)).toEqual(computeSkillGrowth([...xs].reverse()));
  });
  it('chart series is one smoothed point per active day', () => {
    const s = g(sig('memory', [60, 70, 80, 90])).series; expect(s.length).toBe(4); expect(s[0].day < s[3].day).toBe(true);
  });
  it('trendOf needs ≥4 values', () => { expect(trendOf([1, 2, 3])).toBe('insufficient'); });
  it('recommendations are rule-based and target the least-practised / lowest skill', () => {
    const xs = [...sig('memory', [90, 90, 90, 90]), ...sig('attention', [40, 40, 40, 40])];
    const rec = recommend(computeSkillGrowth(xs));
    expect(rec.length).toBeGreaterThan(0); expect(rec.some((r) => r.skill === 'attention')).toBe(true);
  });
});

describe('daily journey + fatigue', () => {
  const base = { childKey: 'kid1', age: 7, day: '2026-03-10', nowIso: '2026-03-10T09:00:00Z', recent: [], levels: {} as any };
  it('picks 3 games from 3 DIFFERENT skills, inside the age ceiling', () => {
    const j = buildDailyJourney(base);
    expect(j.items).toHaveLength(3); expect(new Set(j.items.map((i) => i.skill)).size).toBe(3);
    for (const i of j.items) { expect(i.level).toBeLessThanOrEqual(levelCeiling(7)); expect(i.level).toBeGreaterThanOrEqual(levelFloor(7)); }
  });
  it('is deterministic per child and day, but differs across days', () => {
    expect(buildDailyJourney(base)).toEqual(buildDailyJourney(base));
    const days = new Set(['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'].map((d) => buildDailyJourney({ ...base, day: d }).items.map((i) => i.gameId).join()));
    expect(days.size).toBeGreaterThan(1);
  });
  it('variety: yesterday\'s games are not repeated while others were neglected', () => {
    const yesterday = buildDailyJourney({ ...base, day: '2026-03-09' }).items.map((i) => i.gameId);
    const recent = yesterday.map((gameId, k) => ({ gameId, at: `2026-03-09T0${6 + k}:00:00Z`, durationMs: 120_000, performance: 0.8 }));
    const today = buildDailyJourney({ ...base, recent }).items.map((i) => i.gameId);
    expect(today.filter((g) => yesterday.includes(g)).length).toBeLessThanOrEqual(1);
  });
  it('skill balance: a neglected / weaker skill is favoured', () => {
    const growth = [{ skill: 'memory', score: 95, trend: 'up', samples: 9 }, { skill: 'attention', score: 30, trend: 'down', samples: 9 }, { skill: 'logic', score: 90, trend: 'stable', samples: 9 }, { skill: 'problem_solving', score: 90, trend: 'stable', samples: 9 }, { skill: 'response_control', score: 90, trend: 'stable', samples: 9 }, { skill: 'cognitive_flexibility', score: 90, trend: 'stable', samples: 9 }] as any;
    const recent = GAME_IDS.map((gameId, k) => ({ gameId, at: `2026-03-08T0${k}:00:00Z`, durationMs: 100_000, performance: 0.8 }));
    expect(buildDailyJourney({ ...base, recent, growth }).items.map((i) => i.gameId)).toContain('visual_attention');
  });
  it('uses the child\'s adaptive level, clamped to the ceiling', () => {
    const j = buildDailyJourney({ ...base, levels: { memory_match: 10, visual_attention: 1, pattern_logic: 10, reaction_control: 10, path_puzzle: 10, rule_switch: 10 } });
    for (const i of j.items) expect(i.level).toBeLessThanOrEqual(5);
  });
  it('content changes between plays (seed / theme), not the measurement', () => {
    const a = buildDailyJourney({ ...base, playCounts: { memory_match: 0, visual_attention: 0, pattern_logic: 0 } }).items;
    const b = buildDailyJourney({ ...base, playCounts: { memory_match: 1, visual_attention: 1, pattern_logic: 1 } }).items;
    expect(a.map((i) => i.seed)).not.toEqual(b.map((i) => i.seed));
    expect(themeFor('k', 'memory_match', 4, 'animals').id).not.toBe('animals');
  });
  it('fatigue: rest after several games in a row, and after the daily cap', () => {
    const now = Date.parse('2026-03-10T10:00:00Z');
    const mk = (minAgo: number, dur = 120_000) => ({ at: new Date(now - minAgo * 60_000).toISOString(), durationMs: dur });
    expect(restAdvice([mk(1)], now).rest).toBe(false);
    expect(restAdvice([mk(1), mk(4), mk(7)], now)).toMatchObject({ rest: true, reason: 'in_a_row' });
    expect(restAdvice([mk(1), mk(60), mk(120)], now).rest).toBe(false);             // gaps ⇒ not "in a row"
    expect(restAdvice([mk(300, 26 * 60_000)], now)).toMatchObject({ rest: true, reason: 'daily_cap' });
  });
});

describe('the six games (deterministic state machines, driven by bots)', () => {
  const theme = THEMES[0];
  function playPerfect(id: GameId, level: number, seed = 'seed-1') {
    const g: any = createGame(id, level, seed, theme); let t = 1000; g.start(t); let guard = 0;
    if (id === 'memory_match') {
      const v0 = g.view(); const pos = new Map<string, number[]>(); v0.cards.forEach((c: any) => pos.set(c.symbol, [...(pos.get(c.symbol) ?? []), c.id]));
      g.handleInput({ type: 'peekEnd' }, t += 2000);
      for (const [, [a, b]] of pos) { g.handleInput({ type: 'flip', index: a }, t += 900); g.handleInput({ type: 'flip', index: b }, t += 900); }
    } else if (id === 'visual_attention') {
      while (!g.isDone() && guard++ < 100) { const v = g.view(); v.cells.forEach((c: string, i: number) => { if (c === v.target) g.handleInput({ type: 'tap', index: i }, (t += 600)); }); }
    } else if (id === 'pattern_logic') { while (!g.isDone() && guard++ < 100) g.handleInput({ type: 'choose', index: (g as PatternLogicGame).correctIndex() }, (t += 1500)); }
    else if (id === 'reaction_control') { while (!g.isDone() && guard++ < 100) { g.handleInput({ type: 'show' }, t += 800); g.handleInput(g.currentStimulus() === 'go' ? { type: 'tap' } : { type: 'timeout' }, t += g.currentStimulus() === 'go' ? 450 : 1000); } }
    else if (id === 'path_puzzle') { while (!g.isDone() && guard++ < 1000) g.handleInput({ type: 'move', index: g.hint() }, (t += 700)); }
    else { while (!g.isDone() && guard++ < 100) { const v = g.view(); g.handleInput({ type: 'choose', side: correctSide(v.card, v.rule) }, (t += 900)); } }
    return g;
  }
  for (const id of GAME_IDS) {
    it(`${id}: every one of the 10 levels is completable, scores high when played well, and is replayable`, () => {
      for (let level = 1; level <= 10; level++) {
        const g = playPerfect(id, level);
        expect(g.isDone()).toBe(true);
        const m = g.metrics(); expect(m.performance).toBeGreaterThan(0.85); expect(m.completion).toBe(1);
        const r1 = g.finish(50_000), r2 = playPerfect(id, level).finish(50_000);
        expect(r1.trials).toEqual(r2.trials);                         // same seed ⇒ identical session (resume / verification)
      }
    });
    it(`${id}: a different seed gives different content; contract fields are present`, () => {
      const a: any = createGame(id, 5, 'A', theme); const b: any = createGame(id, 5, 'B', theme);
      const sigOf = (g: any) => { const v = g.start(0); return JSON.stringify(id === 'reaction_control' ? g.seq : v); };
      expect(sigOf(a)).not.toEqual(sigOf(b));
      expect(a.skill).toBe(GAME_SPECS[id].skill); expect(a.ageRange).toEqual([4, 12]); expect(a.sessionDurationSec).toBeGreaterThan(60); expect(a.sessionDurationSec).toBeLessThanOrEqual(300);
      expect(a.difficulty.level).toBe(5);
    });
    it(`${id}: difficulty actually changes with the level (parameters differ between level 1 and 10)`, () => {
      expect(JSON.stringify(GAME_SPECS[id].paramsFor(1))).not.toEqual(JSON.stringify(GAME_SPECS[id].paramsFor(10)));
    });
  }
  it('a child who plays randomly scores clearly lower than one who plays well (scoring discriminates)', () => {
    const rng = makeRng('rand'); const g: any = new PatternLogicGame(4, 's', theme); g.start(0); let t = 0;
    while (!g.isDone()) g.handleInput({ type: 'choose', index: Math.floor(rng() * 4) }, (t += 1200));
    expect(g.metrics().performance).toBeLessThan(0.8);
  });
  it('memory: a mismatch locks the board until resolved, no crash on spam input', () => {
    const g = new MemoryMatchGame(3, 'x', theme); const v = g.start(0); g.handleInput({ type: 'peekEnd' }, 1);
    const a = v.cards.findIndex((c) => c.id === 0), other = v.cards.find((c) => c.symbol !== v.cards[0].symbol)!;
    g.handleInput({ type: 'flip', index: a }, 2); const after = g.handleInput({ type: 'flip', index: other.id }, 3);
    expect(after.locked).toBe(true); g.handleInput({ type: 'flip', index: 5 }, 4); // ignored while locked
    expect(g.handleInput({ type: 'resolve' }, 5).locked).toBe(false);
    g.handleInput({ type: 'flip', index: -4 }, 6); g.handleInput({ type: 'flip', index: 999 }, 7); g.handleInput({ type: 'bogus' }, 8);
  });
  it('attention: false taps are counted, timeouts end the round', () => {
    const g = new VisualAttentionGame(2, 'q', theme); const v = g.start(0); const wrong = v.cells.findIndex((c) => c !== v.target);
    g.handleInput({ type: 'tap', index: wrong }, 10); g.handleInput({ type: 'timeout' }, 20);
    const raw = g.finish(30); expect(raw.trials[0]).toMatchObject({ correct: false }); expect(raw.trials[0].errors).toBeGreaterThanOrEqual(2);
  });
  it('reaction: no-go taps are errors; withheld no-go is correct; a missed go is an error', () => {
    const g = new ReactionControlGame(3, 'r', theme); g.start(0); let t = 0, wrongSeen = false;
    while (!g.isDone()) { g.handleInput({ type: 'show' }, (t += 500)); if (g.currentStimulus() === 'nogo' && !wrongSeen) { g.handleInput({ type: 'tap' }, (t += 300)); wrongSeen = true; } else g.handleInput({ type: 'timeout' }, (t += 1500)); }
    const raw = g.finish(t); expect(raw.trials.some((x) => x.correct === false && x.errors === 1 && x.rtMs === null)).toBe(true); expect(raw.trials.some((x) => x.correct && x.rtMs === null)).toBe(true);
  });
  it('rule switch: tags switch/repeat trials and measures switch cost', () => {
    const g = new RuleSwitchGame(5, 'z', theme); g.start(0); let t = 0;
    while (!g.isDone()) { const v = g.view(); const wasSwitch = v.ruleJustChanged; g.handleInput({ type: 'choose', side: correctSide(v.card!, v.rule) }, (t += wasSwitch ? 1400 : 800)); }
    const m = g.metrics(); expect(m.switchCostMs).toBeGreaterThan(300);
  });
  it('pattern generator: exactly one correct option, for every kind', () => {
    for (const kind of ['ab', 'aab', 'abc', 'abcd', 'growth', 'twoattr', 'mirror']) for (let s = 0; s < 30; s++) {
      const r = makePattern(kind, 8, 5, makeRng(`${kind}${s}`), THEMES[s % 6].emojis);
      expect(new Set(r.options.map(itemKey)).size).toBe(r.options.length);
      expect(r.options.filter((o) => itemKey(o) === itemKey(r.answer))).toHaveLength(1);
      expect(itemKey(r.options[r.answerIndex])).toBe(itemKey(r.answer));
    }
  });
  it('reaction sequences: right no-go ratio, starts with go, bounded runs', () => {
    for (let s = 0; s < 40; s++) { const q = makeSequence(20, 0.4, makeRng(`seq${s}`)); expect(q.filter((x) => x === 'nogo')).toHaveLength(8); expect(q[0] + q[1]).toBe('gogo'); }
  });
  it('path puzzles are always solvable and the optimum is a true shortest tour', () => {
    for (let l = 1; l <= 10; l++) for (let s = 0; s < 15; s++) {
      const p = GAME_SPECS.path_puzzle.paramsFor(l) as any; const pz = makePuzzle(p.size, p.walls, p.stars, makeRng(`pz${l}-${s}`));
      const d = bfs(pz.start, pz.size, new Set(pz.walls)); expect(d[pz.goal]).toBeGreaterThanOrEqual(0); pz.stars.forEach((st) => expect(d[st]).toBeGreaterThanOrEqual(0)); expect(pz.optimal).toBeGreaterThanOrEqual(d[pz.goal]);
    }
    const g = new PathPuzzleGame(1, 'a', theme); g.start(0); g.handleInput({ type: 'move', index: 9999 }, 1); // out of range ignored
  });
});

describe('rewards & wording', () => {
  it('a child always earns at least one star; XP always grows; no ranking anywhere', () => {
    expect(starsFor(0)).toBe(1); expect(starsFor(0.9)).toBe(3);
    const ctx = { performance: 0.1, level: 3, levelUp: false, previousBest: null, totalSessionsBefore: 0, gamesPlayedBefore: [], gameId: 'memory_match' as GameId, streakDays: 1, journeyJustCompleted: false, recoveryDelta: null, xpBefore: 0, badgesHeld: [] };
    const r = evaluateRewards(ctx); expect(r.stars).toBe(1); expect(r.xp).toBeGreaterThan(0); expect(r.newBadges).toContain('first_game');
    expect(evaluateRewards({ ...ctx, previousBest: 0.5, performance: 0.9, totalSessionsBefore: 4, badgesHeld: ['first_game'] }).personalBest).toBe(true);
    expect(evaluateRewards({ ...ctx, xpBefore: 100, performance: 0.9 }).newWorlds).toContain('sea');
    expect(Object.keys(r)).not.toContain('rank');
  });
  it('child-facing and parent-facing texts never use test / diagnosis wording', () => {
    const strings: string[] = [];
    for (const m of Object.values(GAME_META)) strings.push(m.title, m.story);
    strings.push(...Object.values(REST_TEXT), ...Object.values(SKILL_META).map((s) => s.name));
    const growth: SignalRecord[] = [...sig('memory', [50, 55, 60, 70, 75, 80]), ...sig('attention', [70, 70, 70, 70, 70, 70]), ...sig('logic', [80, 75, 70, 50, 45, 40])];
    const sessions = Array.from({ length: 12 }, (_, i) => ({ gameId: 'memory_match' as GameId, at: `2026-03-${String(1 + i).padStart(2, '0')}T08:00:00Z`, durationMs: 150_000, level: 4, performance: 0.7, completed: true }));
    for (const p of ['week', 'month'] as const) { const r = buildReport(p, growth, sessions); strings.push(r.title, r.summary, r.disclaimer, ...r.recommendations.map((x) => x.text), ...r.lines.flatMap((l) => [l.name, l.trend, l.label])); }
    strings.push(buildReport('week', [], []).summary);
    for (const s of strings) expect(findBanned(s), s).toEqual([]);
  });
  it('report: honest when data is thin; names growing skills when data is enough', () => {
    expect(buildReport('week', sig('memory', [60]), []).enoughData).toBe(false);
    const sessions = Array.from({ length: 5 }, (_, i) => ({ gameId: 'memory_match' as GameId, at: `2026-03-0${1 + i}T08:00:00Z`, durationMs: 120_000, level: 4, performance: 0.7, completed: true }));
    const r = buildReport('week', sig('memory', [50, 52, 55, 70, 74, 78]), sessions);
    expect(r.enoughData).toBe(true); expect(r.summary).toContain('حافظه'); expect(r.mostGrowth).toBe('memory'); expect(r.games).toBe(5); expect(r.playMinutes).toBe(10);
  });
});
