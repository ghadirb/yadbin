import { describe, expect, it } from 'vitest';
import { afterItem, itemScore, pickNext } from '../src/question-engine/selector';
import { buildAttentionEvent, buildMemoryEvent, buildProblemEvent } from '../src/question-engine/events';
import { isValidQuestion } from '../src/question-engine/validate';
import { MemoryKv } from '../src/storage/kv';
import { flushPending, submitResult } from '../src/sync/sync';
import { tokenFromPath } from '../src/play/router';

const memQ = (id: string, d = 1): any => ({ id, game: 'memory', difficulty: d, sequence: ['red', 'star', 'blue'], displayDuration: 1500, isReverse: false });
const st = (over: any = {}): any => ({ game: 'memory', difficultyMode: 'adaptive', difficulty: 1, used: [], blockScores: [], pools: { '1': [memQ('a'), memQ('b'), memQ('c')], '2': [memQ('d', 2)], '3': [] }, ...over });

describe('question engine', () => {
  it('skips invalid questions and replaces them', () => {
    const s = st({ pools: { '1': [{ id: 'bad' }, memQ('good')], '2': [], '3': [] } });
    expect(pickNext(s)?.id).toBe('good');
    expect(pickNext(st({ pools: { '1': [{ id: 'x' }], '2': [], '3': [] } }))).toBeNull(); // no crash
  });
  it('falls back to nearest level when pool is exhausted', () => {
    const s = st({ used: ['a', 'b', 'c'] });
    expect(pickNext(s)?.id).toBe('d');
  });
  it('adaptive: after block of 3 — up / same / down, clamped; single mistake does not drop', () => {
    let s = st(); [1, 1, 1].forEach((x) => afterItem(s, x)); expect(s.difficulty).toBe(2);
    s = st({ difficulty: 2 }); [1, 1, 0].forEach((x) => afterItem(s, x)); expect(s.difficulty).toBe(2);
    s = st({ difficulty: 2 }); [0, 0, 1].forEach((x) => afterItem(s, x)); expect(s.difficulty).toBe(1);
    s = st({ difficulty: 1 }); [0, 0, 0].forEach((x) => afterItem(s, x)); expect(s.difficulty).toBe(1);
    s = st({ difficulty: 3 }); [1, 1, 1].forEach((x) => afterItem(s, x)); expect(s.difficulty).toBe(3);
  });
  it('fixed mode never changes level', () => {
    const s = st({ difficultyMode: 'easy' }); [1, 1, 1].forEach((x) => afterItem(s, x)); expect(s.difficulty).toBe(1);
  });
  it('validation per game', () => {
    expect(isValidQuestion('memory', memQ('a'))).toBe(true);
    expect(isValidQuestion('memory', { ...memQ('a'), sequence: [] })).toBe(false);
    expect(isValidQuestion('attention', { id: 'a', difficulty: 1, gridSize: 3, cells: ['red'], rule: { select: 'red' }, targetCount: 1 })).toBe(false);
    expect(isValidQuestion('problem_solving', { id: 'p', difficulty: 1 })).toBe(false);
  });
});

describe('event builders', () => {
  it('memory forward/reverse', () => {
    expect(buildMemoryEvent(memQ('a'), ['red', 'star', 'blue'], 1200).correct).toBe(true);
    expect(buildMemoryEvent({ ...memQ('a'), isReverse: true }, ['blue', 'star', 'red'], 1200).correct).toBe(true);
    const bad = buildMemoryEvent(memQ('a'), ['star', 'red', 'blue'], 1200);
    expect(bad.correct).toBe(false); expect(bad.event.mistakes).toBe(2);
  });
  it('attention counts correct / wrong (avoid colour) / false clicks / missed', () => {
    const q = { gridSize: 3, cells: ['blue', 'blue', 'red', 'green', 'yellow', 'green', 'red', 'green', 'green'], rule: { select: 'blue', avoid: 'red' }, targetCount: 2, difficulty: 3, ruleChanged: false, phase: 'before' };
    const e = buildAttentionEvent(q, [0, 2, 3], 500, 3000);
    expect(e).toMatchObject({ correctTargets: 1, wrongTargets: 1, falseClicks: 1, missedTargets: 1, reactionTime: 500 });
    expect(itemScore('attention', e)).toBeCloseTo(1 / 4, 3);
  });
  it('problem event clamps hints/attempts', () => {
    const r = buildProblemEvent({ id: 'p', difficulty: 2, correctOption: 1 }, 99, 9, 1, 2000);
    expect(r.correct).toBe(true); expect(r.event.hintsUsed).toBe(3); expect(r.event.attempts).toBe(20);
  });
});

describe('local persistence & sync', () => {
  it('offline: result saved locally, then retried; server duplicate is safe', async () => {
    const store = new MemoryKv();
    let online = false, posts = 0;
    const api: any = { complete: async () => { if (!online) return { kind: 'network' }; posts++; return { kind: 'ok', data: {} }; } };
    expect(await submitResult('T', { a: 1 }, api, store)).toBe('saved_locally');
    expect(await store.get('pending:T')).toEqual({ a: 1 });
    online = true;
    expect(await flushPending('T', api, store)).toBe('sent');
    expect(await store.get('pending:T')).toBeUndefined();
    expect(await flushPending('T', api, store)).toBe('sent'); // nothing pending: no extra POST
    expect(posts).toBe(1);
  });
  it('5xx keeps pending; 4xx (canceled) drops it', async () => {
    const store = new MemoryKv();
    const api5: any = { complete: async () => ({ kind: 'http', status: 503, error: 'x', message: '' }) };
    expect(await submitResult('T', { a: 1 }, api5, store)).toBe('saved_locally');
    const api4: any = { complete: async () => ({ kind: 'http', status: 410, error: 'canceled', message: '' }) };
    expect(await flushPending('T', api4, store)).toBe('rejected');
    expect(await store.get('pending:T')).toBeUndefined();
  });
  it('router extracts token', () => {
    expect(tokenFromPath('/play/abcd2345efgh6789')).toBe('ABCD2345EFGH6789');
    expect(tokenFromPath('/x')).toBeNull();
  });
});
