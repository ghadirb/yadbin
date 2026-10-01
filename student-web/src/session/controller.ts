import { scoreAttention, scoreMemory, scoreProblemSolving, type GameType } from '../scoring';
import { afterItem, itemScore, pickNext } from '../question-engine/selector';
import type { PlayPayload, SessionState } from '../question-engine/types';
import type { KvStore } from '../storage/kv';
import type { PlayApi } from '../sync/api';
import { autoRetry, flushPending, submitResult } from '../sync/sync';

export interface QuestionInfo { index: number; total: number; ruleJustChanged: boolean }
export interface GameUi {
  welcome(): Promise<void>;
  tutorial(game: GameType): Promise<void>;
  /** Renders one question; resolves with the raw event (and, for scoring the adaptive block, whether it was correct). */
  playQuestion(game: GameType, q: any, info: QuestionInfo): Promise<{ event: any; correct?: boolean }>;
  end(kind: 'sent' | 'saved' | 'already', accuracy?: number | null): void;
  error(kind: 'invalid' | 'expired' | 'canceled' | 'network' | 'generic', message: string, retry?: () => void): void;
}
export interface SessionDeps { token: string; api: PlayApi; store: KvStore; ui: GameUi; now?: () => number; retryIntervalMs?: number; firstLoadRetryDelayMs?: number }
export type SessionOutcome = 'finished' | 'already_done' | 'error';

const stateKey = (t: string) => `session:${t}`;
const fresh = (d: PlayPayload, now: number): SessionState => ({
  sessionId: d.session.id, game: d.game, difficultyMode: d.difficultyMode, questionCount: d.questionCount, pools: d.pools,
  difficulty: d.startDifficulty, used: [], events: [], blockScores: [], tutorialDone: false, startedAtMs: now, activeMs: 0, finished: false,
});

/** The very first request on a flaky/filtered network often fails once and then works: retry quietly before bothering the child. */
async function getPlayWithRetry(api: PlayApi, token: string, delayMs: number, tries = 3) {
  let r = await api.getPlay(token);
  for (let i = 1; i < tries && r.kind === 'network'; i++) {
    await new Promise((res) => setTimeout(res, delayMs * i));
    r = await api.getPlay(token);
  }
  return r;
}

export async function runSession(d: SessionDeps): Promise<SessionOutcome> {
  const { token, api, store, ui } = d;
  const now = d.now ?? Date.now;
  let local = await store.get<SessionState>(stateKey(token));

  // Finished earlier on this device: only the delivery of the result may still be pending.
  if (local?.finished) {
    const out = await flushPending(token, api, store);
    if (out === 'saved_locally') { ui.end('saved'); autoRetry(token, api, store, () => ui.end('sent'), d.retryIntervalMs); }
    else ui.end(out === 'sent' ? 'already' : 'already');
    return 'finished';
  }

  const r = local ? await api.getPlay(token) : await getPlayWithRetry(api, token, d.firstLoadRetryDelayMs ?? 800);
  if (r.kind === 'network') {
    if (!local) {
      ui.error('network', 'اتصال اینترنت قطع شد. لطفاً دوباره تلاش کنید.', () => void runSession(d));
      return 'error';
    }
    // Local session exists (started earlier): keep playing offline.
  } else if (r.kind === 'http') {
    const kind = r.status === 404 ? 'invalid' : r.error === 'canceled' ? 'canceled' : r.error === 'expired' ? 'expired' : 'generic';
    ui.error(kind, r.message);
    return 'error';
  } else if (r.data?.status === 'completed') {
    await store.del(stateKey(token));
    ui.end('already');
    return 'already_done';
  } else if (!r.data?.session) {
    ui.error('generic', 'مشکلی پیش آمد. صفحه را دوباره باز کنید.'); // e.g. API base misconfigured → HTML instead of JSON
    return 'error';
  } else {
    const data = r.data as PlayPayload;
    if (!local || local.sessionId !== data.session.id) { local = fresh(data, now()); await store.set(stateKey(token), local); }
  }
  const s = local!;
  const save = () => store.set(stateKey(token), s);

  if (!s.tutorialDone) {
    if (s.events.length === 0) await ui.welcome();
    await ui.tutorial(s.game); // never recorded
    s.tutorialDone = true; await save();
  }

  let prevChanged = s.events.length ? false : false;
  while (s.events.length < s.questionCount) {
    const q = pickNext(s);
    if (!q) break; // pools exhausted (only possible with many invalid questions)
    const t0 = now();
    const { event, correct } = await ui.playQuestion(s.game, q, { index: s.events.length, total: s.questionCount, ruleJustChanged: !!q.ruleChanged && !prevChanged });
    prevChanged = !!q.ruleChanged;
    if (s.game === 'problem_solving') event.correct = !!correct; // local scoring only; the server re-derives correctness
    s.events.push(event);
    s.used.push(q.id);
    afterItem(s, s.game === 'attention' ? itemScore('attention', event) : correct ? 1 : 0);
    s.activeMs += now() - t0;
    await save(); // resume point after every item
  }

  const local_result =
    s.game === 'memory' ? scoreMemory(s.events) : s.game === 'attention' ? scoreAttention(s.events) : scoreProblemSolving(s.events);
  s.finished = true; await save();
  const outcome = await submitResult(token, { sessionId: s.sessionId, events: s.events, durationMs: Math.round(s.activeMs), localResult: local_result }, api, store);
  const acc = local_result.accuracy ?? null; // used only to pick an encouraging sentence; never shown as a number
  if (outcome === 'saved_locally') { ui.end('saved', acc); autoRetry(token, api, store, () => ui.end('sent', acc), d.retryIntervalMs); }
  else ui.end(outcome === 'sent' ? 'sent' : 'already', acc);
  return 'finished';
}
