import type { KvStore } from '../storage/kv';
import type { PlayApi } from '../sync/api';
import { autoRetry, flushPending, submitResult } from '../sync/sync';

/** Student side of a Teacher Assessment (آزمون معلم). Separate from the cognitive games: no scoring, no adaptive engine. */
export interface AQuestion { id: string; type: 'multiple_choice' | 'true_false' | 'fill_blank'; text: string; options?: string[] }
export interface AssessmentInfo { title: string; subject: string | null; description: string | null; questionCount: number; suggestedMinutes: number | null; questions: AQuestion[] }
export interface AssessmentPayload { kind: 'teacher_assessment'; status: string; session: { id: string; startedAt: string }; assessment: AssessmentInfo; summary?: any; preview?: boolean }
export interface GivenAnswer { answer?: unknown; responseTimeMs: number; answeredAt?: number }
export interface AssessmentState {
  kind: 'assessment'; sessionId: string; assessment: AssessmentInfo; index: number; answers: Record<string, GivenAnswer>;
  startedAtMs: number; activeMs: number; finished: boolean; preview?: boolean;
}
export interface PreviewResult { total: number; correct: number; unanswered: number; percent: number; items: { questionId: string; position: number; answered: boolean; isCorrect: boolean; correctAnswer: unknown; explanation: string | null }[] }

export interface AssessmentUi {
  intro(a: AssessmentInfo, preview: boolean): Promise<void>;
  /** Shows one question; resolves with the answer (undefined = left empty) and the direction the child chose. */
  ask(q: AQuestion, info: { index: number; total: number; previous?: unknown; isLast: boolean; canGoBack: boolean }): Promise<{ answer?: unknown; direction: 'next' | 'back' }>;
  end(kind: 'sent' | 'saved' | 'already'): void;
  /** Teacher preview only: simulated result with the key and explanations. */
  previewEnd?(result: PreviewResult | null, questions: AQuestion[]): void;
}
export interface AssessmentDeps { token: string; api: PlayApi; store: KvStore; ui: AssessmentUi; now?: () => number; retryIntervalMs?: number; preview?: boolean }

export const assessmentStateKey = (t: string) => `session:${t}`;
export const isAssessmentState = (s: unknown): s is AssessmentState => !!s && (s as any).kind === 'assessment';

export function freshAssessment(d: AssessmentPayload, now: number): AssessmentState {
  return { kind: 'assessment', sessionId: d.session.id, assessment: d.assessment, index: 0, answers: {}, startedAtMs: now, activeMs: 0, finished: false, ...(d.preview ? { preview: true } : {}) };
}

const hasAnswer = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/** Runs (or resumes) the assessment. Every step is persisted, so refresh / closing the tab / losing the network never loses answers. */
export async function runAssessment(d: AssessmentDeps, s: AssessmentState): Promise<'finished' | 'error'> {
  const { token, api, store, ui } = d;
  const now = d.now ?? Date.now;
  const save = () => store.set(assessmentStateKey(token), s);
  const qs = s.assessment.questions;

  if (s.index === 0 && Object.keys(s.answers).length === 0) await ui.intro(s.assessment, !!s.preview);

  while (s.index < qs.length) {
    const q = qs[s.index];
    const prev = s.answers[q.id];
    const t0 = now();
    const r = await ui.ask(q, { index: s.index, total: qs.length, previous: prev?.answer, isLast: s.index === qs.length - 1, canGoBack: s.index > 0 });
    const spent = now() - t0;
    s.activeMs += spent;
    if (hasAnswer(r.answer)) s.answers[q.id] = { answer: r.answer, responseTimeMs: (prev?.responseTimeMs ?? 0) + spent, answeredAt: now() };
    else delete s.answers[q.id]; // left empty → counted as unanswered by the server
    s.index = r.direction === 'back' ? Math.max(0, s.index - 1) : s.index + 1;
    await save(); // resume point after every step
  }

  s.finished = true; await save();
  const payload = {
    sessionId: s.sessionId, durationMs: Math.min(Math.round(s.activeMs), 4 * 3600_000),
    answers: qs.filter((q) => hasAnswer(s.answers[q.id]?.answer)).map((q) => ({ questionId: q.id, answer: s.answers[q.id].answer, responseTimeMs: Math.round(s.answers[q.id].responseTimeMs), answeredAt: s.answers[q.id].answeredAt })),
  };

  if (d.preview || s.preview) { // teacher preview: nothing is stored on the device queue; show the simulated result
    const res = await api.complete(token, payload);
    ui.previewEnd?.(res.kind === 'ok' ? (res.data?.result ?? null) : null, qs);
    if (!ui.previewEnd) ui.end('sent');
    await store.del(assessmentStateKey(token));
    return 'finished';
  }
  const outcome = await submitResult(token, payload, api, store); // written to the device BEFORE the network call; the server is idempotent
  if (outcome === 'saved_locally') { ui.end('saved'); autoRetry(token, api, store, () => ui.end('sent'), d.retryIntervalMs); }
  else ui.end(outcome === 'sent' ? 'sent' : 'already');
  return 'finished';
}

export { flushPending };
