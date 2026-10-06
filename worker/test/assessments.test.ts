import { beforeAll, describe, expect, it } from 'vitest';
import { createEnv, memoryEvents, publishForTest, registerTeacher, type TestEnv } from './helpers';
import { gradeAnswer, normalizeAnswer, type StoredQuestion } from '../src/assessments/grading';
import { coerceModelQuestion, createAiDraft, parseModelAssessment } from '../src/ai/assessment-draft';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60_000);
const tokenOf = (url: string) => url.split('/play/')[1];
const pvTokenOf = (url: string) => url.split('/preview/')[1];
const count = async (sql: string, ...b: unknown[]) => (await t.db.prepare(sql).bind(...b).first<{ n: number }>())!.n;

const MC = { type: 'multiple_choice', text: 'پایتخت ایران کدام است؟', options: ['تهران', 'شیراز', 'تبریز', 'اصفهان'], correct: 0, explanation: 'تهران پایتخت است.' };
const TF = { type: 'true_false', text: 'زمین به دور خورشید می‌چرخد.', correct: true };
const FB = { type: 'fill_blank', text: 'مرکز استان فارس ____ است.', answers: ['شیراز'] };

async function makeAssessment(token: string, over: object = {}) {
  const r = await t.api('POST', '/api/assessments', { title: 'آزمون فصل دوم علوم', subject: 'علوم', gradeCode: 'g6', level: 'intermediate', ...over }, token);
  expect(r.status).toBe(201);
  return r.data.assessment.id as string;
}
async function addQ(token: string, id: string, q: object) { const r = await t.api('POST', `/api/assessments/${id}/questions`, q, token); expect(r.status).toBe(201); return r.data; }
async function full(token: string, over: object = {}) { const id = await makeAssessment(token, over); for (const q of [MC, TF, FB]) await addQ(token, id, q); return id; }

/** The teacher plays the preview like a student, then gives the verdict. */
async function previewAndApprove(token: string, id: string, feedback = 'suitable') {
  const s = await t.api('POST', `/api/assessments/${id}/preview`, undefined, token); expect(s.status).toBe(200);
  const pt = pvTokenOf(s.data.url);
  const p = await t.api('GET', `/api/preview/${pt}`); expect(p.status).toBe(200);
  const answers = p.data.assessment.questions.map((q: any) => ({ questionId: q.id, answer: q.type === 'multiple_choice' ? 0 : q.type === 'true_false' ? true : 'شیراز', responseTimeMs: 900 }));
  const c = await t.api('POST', `/api/preview/${pt}/complete`, { sessionId: p.data.session.id, answers }); expect(c.status).toBe(200);
  const f = await t.api('POST', `/api/assessments/${id}/preview-feedback`, { feedback }, token); expect(f.status).toBe(200);
  return { pt, p: p.data, c: c.data, f: f.data };
}
async function klass(token: string, n = 3, gradeCode = 'g6') {
  const c = (await t.api('POST', '/api/classes', { name: 'ششم الف', gradeCode }, token)).data.class;
  const students: any[] = [];
  for (let i = 0; i < n; i++) students.push((await t.api('POST', '/api/students', { name: `دانش‌آموز ${i + 1}`, classId: c.id }, token)).data.student);
  return { classId: c.id as string, students };
}
async function publishTo(token: string, id: string, classId: string) {
  await previewAndApprove(token, id);
  const r = await t.api('POST', `/api/assessments/${id}/publish`, { classId }, token); expect(r.status).toBe(200);
  return r.data.links as { studentId: string; url: string; token: string }[];
}
async function play(link: { url: string }) {
  const tk = tokenOf(link.url);
  const g = await t.api('GET', `/api/play/${tk}`); expect(g.status).toBe(200);
  return { tk, g: g.data, qs: g.data.assessment.questions as any[] };
}
const perfect = (qs: any[]) => qs.map((q) => ({ questionId: q.id, answer: q.type === 'multiple_choice' ? 0 : q.type === 'true_false' ? true : 'شیراز', responseTimeMs: 1500 }));
const submit = (tk: string, sessionId: string, answers: unknown[], durationMs = 60000) => t.api('POST', `/api/play/${tk}/complete`, { sessionId, answers, durationMs });

describe('Test 1-3: create, three question types, invalid questions', () => {
  it('creates a draft assessment of its own content type', async () => {
    const { token } = await registerTeacher(t);
    const r = await t.api('POST', '/api/assessments', { title: 'آزمون فصل دوم علوم', subject: 'علوم', gradeCode: 'g6', level: 'intermediate', suggestedMinutes: 15 }, token);
    expect(r.status).toBe(201);
    expect(r.data.assessment).toMatchObject({ contentType: 'teacher_assessment', status: 'draft', statusLabel: 'پیش‌نویس', version: 1, subject: 'علوم', gradeLabel: 'ششم ابتدایی', levelLabel: 'متوسط', questionCount: 0 });
    expect((await t.api('POST', '/api/assessments', { title: '   ' }, token)).status).toBe(400);
    const a = (await t.api('POST', '/api/activities', { classId: (await klass(token, 1)).classId, gameType: 'memory' }, token)).data.activity;
    expect(a.contentType).toBe('cognitive_activity'); // the two kinds are distinguishable everywhere
  });
  it('accepts multiple-choice, true/false and fill-in-the-blank in a changeable order', async () => {
    const { token } = await registerTeacher(t);
    const id = await full(token);
    const d = (await t.api('GET', `/api/assessments/${id}`, undefined, token)).data;
    expect(d.questions.map((q: any) => q.type)).toEqual(['multiple_choice', 'true_false', 'fill_blank']);
    expect(d.questions.map((q: any) => q.position)).toEqual([1, 2, 3]);
    expect(d.questions[0]).toMatchObject({ correct: 0, typeLabel: 'چهارگزینه‌ای' });
    const ids = d.questions.map((q: any) => q.id);
    const re = await t.api('POST', `/api/assessments/${id}/reorder`, { order: [ids[2], ids[0], ids[1]] }, token);
    expect(re.data.questions.map((q: any) => q.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect((await t.api('POST', `/api/assessments/${id}/reorder`, { order: [ids[0]] }, token)).status).toBe(400); // must be a full permutation
    const cp = await t.api('POST', `/api/assessments/${id}/questions/${ids[0]}/duplicate`, undefined, token);
    expect(cp.data.questions).toHaveLength(4);
    expect(cp.data.questions[2].text).toBe(MC.text); // placed right after the original
    expect(new Set(cp.data.questions.map((q: any) => q.id)).size).toBe(4);
    const del = await t.api('DELETE', `/api/assessments/${id}/questions/${ids[1]}`, undefined, token);
    expect(del.data.questions).toHaveLength(3);
    expect(del.data.questions.map((q: any) => q.position)).toEqual([1, 2, 3]);
    const up = await t.api('PUT', `/api/assessments/${id}/questions/${ids[2]}`, { ...FB, answers: ['شیراز', 'شيراز '] }, token);
    expect(up.status).toBe(200);
  });
  it('rejects invalid questions with a plain Persian message', async () => {
    const { token } = await registerTeacher(t);
    const id = await makeAssessment(token);
    const bad: [object, string][] = [
      [{ ...MC, text: '  ' }, 'متن سؤال'],
      [{ ...MC, options: ['الف', 'ب', 'ج'] }, '۴ گزینه'],
      [{ ...MC, options: ['الف', 'ب', 'ج', ''] }, 'گزینه'],
      [{ ...MC, options: ['الف', 'ب', 'ج', 'ج'] }, 'تکراری'],
      [{ ...MC, correct: 4 }, 'پاسخ صحیح'],
      [{ ...MC, correct: [0, 1] }, 'پاسخ صحیح'],
      [{ type: 'true_false', text: 'x' }, 'پاسخ صحیح'],
      [{ type: 'fill_blank', text: 'x ____', answers: [] }, 'پاسخ صحیح'],
      [{ type: 'essay', text: 'x' }, 'نوع سؤال'],
    ];
    for (const [q, word] of bad) {
      const r = await t.api('POST', `/api/assessments/${id}/questions`, q, token);
      expect(r.status, JSON.stringify(q)).toBe(400);
      expect(r.data.message).toContain(word);
    }
    expect(await count('SELECT COUNT(*) AS n FROM assessment_questions WHERE assessment_id = ?', id)).toBe(0);
    // an assessment without questions cannot be previewed
    const p = await t.api('POST', `/api/assessments/${id}/preview`, undefined, token);
    expect(p.status).toBe(422);
    expect(p.data.message).toContain('حداقل یک سؤال');
  });
});

describe('Test 4-8: preview, approval, publication', () => {
  it('previews like a student, writes no student data, and the verdict drives the state', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 2);
    const id = await full(token);
    const tables = ['students', 'assessment_students', 'assessment_attempts', 'assessment_answers', 'assessment_results', 'activity_students', 'game_sessions', 'game_results', 'student_metrics'];
    const snap = async () => Promise.all(tables.map((tb) => count(`SELECT COUNT(*) AS n FROM ${tb}`)));
    const before = await snap();

    const s = await t.api('POST', `/api/assessments/${id}/preview`, undefined, token);
    expect(s.data.url).toContain('/preview/');
    expect((await t.api('GET', `/api/assessments/${id}`, undefined, token)).data.assessment.status).toBe('teacher_preview');
    const pt = pvTokenOf(s.data.url);
    const p = await t.api('GET', `/api/preview/${pt}`);
    expect(p.data).toMatchObject({ kind: 'teacher_assessment', preview: true });
    expect(p.data.assessment.questions.map((q: any) => q.type)).toEqual(['multiple_choice', 'true_false', 'fill_blank']); // real order
    expect(JSON.stringify(p.data)).not.toContain('explanation');   // a preview shows what a student sees, not the key
    expect(JSON.stringify(p.data.assessment.questions)).not.toContain('"correct"');
    // not approvable before the run is completed
    expect((await t.api('POST', `/api/assessments/${id}/preview-feedback`, { feedback: 'suitable' }, token)).status).toBe(409);
    const answers = p.data.assessment.questions.map((q: any, i: number) => ({ questionId: q.id, answer: i === 0 ? 1 : i === 1 ? true : 'شیراز' }));
    const c = await t.api('POST', `/api/preview/${pt}/complete`, { sessionId: p.data.session.id, answers });
    expect(c.data.result).toMatchObject({ total: 3, correct: 2, unanswered: 0, percent: 66.7 });
    expect(c.data.result.items[0]).toMatchObject({ isCorrect: false, correctAnswer: 0, explanation: 'تهران پایتخت است.' });
    expect(await snap()).toEqual(before);                           // Test 5: nothing for any student

    const ok = await t.api('POST', `/api/assessments/${id}/preview-feedback`, { feedback: 'too_easy' }, token);
    expect(ok.data.assessment).toMatchObject({ status: 'ready_to_publish', previewFeedback: 'too_easy' }); // Test 6-7
    // cannot publish an unapproved one (a second assessment)
    const other = await full(token);
    const np = await t.api('POST', `/api/assessments/${other}/publish`, {}, token);
    expect(np.status).toBe(409); expect(np.data.error).toBe('teacher_approval_required');
    const pub = await t.api('POST', `/api/assessments/${id}/publish`, { classId }, token); // Test 8
    expect(pub.data.assessment).toMatchObject({ status: 'published', assigned: 2 });
    expect(pub.data.links).toHaveLength(2);
    expect(pub.data.links[0].url).toMatch(/^https:\/\/play\.example\/play\/[A-Z2-9]{16}$/);
  });
  it('"too hard" / "needs edit" send it back to draft', async () => {
    const { token } = await registerTeacher(t);
    for (const fb of ['too_hard', 'needs_edit']) {
      const id = await full(token);
      const r = await previewAndApprove(token, id, fb);
      expect(r.f.assessment.status).toBe('draft');
      expect((await t.api('POST', `/api/assessments/${id}/publish`, {}, token)).status).toBe(409);
      expect((await t.api('POST', `/api/assessments/${id}/preview-feedback`, { feedback: 'suitable' }, token)).status).toBe(409); // the verdict used up that run
    }
  });
  it('any content edit invalidates the preview and returns ready_to_publish to draft', async () => {
    const { token } = await registerTeacher(t);
    const id = await full(token);
    const edits: [string, () => Promise<{ status: number }>][] = [];
    const qid = async () => (await t.api('GET', `/api/assessments/${id}`, undefined, token)).data.questions as any[];
    edits.push(['question text', async () => t.api('PUT', `/api/assessments/${id}/questions/${(await qid())[0].id}`, { ...MC, text: 'تغییر' }, token)]);
    edits.push(['option', async () => t.api('PUT', `/api/assessments/${id}/questions/${(await qid())[0].id}`, { ...MC, options: ['تهران', 'مشهد', 'تبریز', 'اصفهان'] }, token)]);
    edits.push(['correct answer', async () => t.api('PUT', `/api/assessments/${id}/questions/${(await qid())[1].id}`, { ...TF, correct: false }, token)]);
    edits.push(['delete', async () => t.api('DELETE', `/api/assessments/${id}/questions/${(await qid())[2].id}`, undefined, token)]);
    edits.push(['add', async () => t.api('POST', `/api/assessments/${id}/questions`, FB, token)]);
    edits.push(['reorder', async () => { const q = await qid(); return t.api('POST', `/api/assessments/${id}/reorder`, { order: [q[1].id, q[0].id, q[2].id] }, token); }]);
    edits.push(['grade', async () => t.api('PUT', `/api/assessments/${id}`, { gradeCode: 'g5' }, token)]);
    edits.push(['level', async () => t.api('PUT', `/api/assessments/${id}`, { level: 'advanced' }, token)]);
    for (const [name, edit] of edits) {
      const { pt } = await previewAndApprove(token, id);
      expect((await t.api('GET', `/api/assessments/${id}`, undefined, token)).data.assessment.status, name).toBe('ready_to_publish');
      expect([200, 201]).toContain((await edit()).status);
      const d = (await t.api('GET', `/api/assessments/${id}`, undefined, token)).data.assessment;
      expect(d.status, name).toBe('draft'); expect(d.teacherApprovedAt).toBeNull(); expect(d.previewedAt).toBeNull();
      expect((await t.api('GET', `/api/preview/${pt}`)).status, name).toBe(404);                        // the old preview link is dead
      expect((await t.api('POST', `/api/assessments/${id}/publish`, {}, token)).status, name).toBe(409); // a new preview is required
    }
    // a harmless change (title) keeps the approval
    await previewAndApprove(token, id);
    await t.api('PUT', `/api/assessments/${id}`, { title: 'عنوان جدید' }, token);
    expect((await t.api('GET', `/api/assessments/${id}`, undefined, token)).data.assessment.status).toBe('ready_to_publish');
  });
});

describe('Test 9-13: student play, auto grading, teacher report', () => {
  it('opens the shared /play link, hides the key, grades every type server-side and reports to the teacher', async () => {
    const { token } = await registerTeacher(t);
    const { classId, students } = await klass(token, 3);
    const id = await full(token);
    const links = await publishTo(token, id, classId);
    const L = (i: number) => links.find((l) => l.studentId === students[i].id)!;

    const a = await play(L(0));
    expect(a.g).toMatchObject({ kind: 'teacher_assessment', status: 'ready' });
    expect(JSON.stringify(a.g)).not.toMatch(/"correct"|explanation|answers"/);   // never the key
    expect(a.g.assessment.questions.map((q: any) => q.type)).toEqual(['multiple_choice', 'true_false', 'fill_blank']);
    expect(a.g.assessment.questions[0].options).toHaveLength(4);
    const ra = await submit(a.tk, a.g.session.id, perfect(a.qs));
    expect(ra.data).toMatchObject({ ok: true, duplicate: false });
    expect(JSON.stringify(ra.data)).not.toMatch(/percent|score|correct/);       // the child gets no score

    const b = await play(L(1));     // 1 correct (true/false), 1 wrong, 1 wrong
    await submit(b.tk, b.g.session.id, [{ questionId: b.qs[0].id, answer: 2 }, { questionId: b.qs[1].id, answer: true }, { questionId: b.qs[2].id, answer: 'تهران' }]);
    const c = await play(L(2));     // answers only the first, skips two
    await submit(c.tk, c.g.session.id, [{ questionId: c.qs[0].id, answer: 0 }, { questionId: c.qs[1].id, answer: null }]);

    const rep = (await t.api('GET', `/api/assessments/${id}/report`, undefined, token)).data;
    expect(rep).toMatchObject({ participants: 3, assigned: 3, notFinished: 0, highestPercent: 100, lowestPercent: 33.3 });
    expect(rep.averagePercent).toBeCloseTo((100 + 33.3 + 33.3) / 3, 0);
    expect(rep.questions.map((q: any) => [q.correct, q.incorrect, q.unanswered, q.percentCorrect])).toEqual([[2, 1, 0, 66.7], [2, 0, 1, 66.7], [1, 1, 1, 33.3]]);
    expect(JSON.stringify(rep)).not.toMatch(/دانش‌آموز \d/);                    // no names / no ranking in the report
    expect(rep.notice).toContain('رتبه‌بندی');
    const row = await t.db.prepare('SELECT * FROM assessment_answers WHERE question_id = ? AND is_correct = 1').bind(a.qs[0].id).first<any>();
    expect(row).toMatchObject({ assessment_id: id, assessment_version: 1, selected_answer: 0 });
    expect(row.answered_at).toBeTruthy(); expect(row.response_time_ms).toBe(1500);
  });
  it('fill-in-the-blank is tolerant about typing habits, never about wrong answers', () => {
    const q: StoredQuestion = { id: 'q', position: 1, type: 'fill_blank', text: '', options: null, correct: ['شیراز', 'می‌خواهم', 'آب'], explanation: null };
    const ok = (s: string) => gradeAnswer(q, s).correct;
    for (const s of ['شیراز', '  شیراز  ', 'شيراز', 'شـیـراز', 'می خواهم', 'می‌خواهم', 'می\u200cخواهم  ', 'آب']) expect(ok(s), s).toBe(true);
    for (const s of ['شیرازی', 'تهران', 'اب', 'شیر از', '']) expect(ok(s), s).toBe(false);
    expect(gradeAnswer(q, '   ').answered).toBe(false);
    expect(normalizeAnswer('۱۲ ')).toBe('12');
    const mc: StoredQuestion = { id: 'm', position: 1, type: 'multiple_choice', text: '', options: ['a', 'b', 'c', 'd'], correct: 1, explanation: null };
    expect(gradeAnswer(mc, 1).correct).toBe(true); expect(gradeAnswer(mc, '1').answered).toBe(false); expect(gradeAnswer(mc, 7).answered).toBe(false);
    const tf: StoredQuestion = { id: 't', position: 1, type: 'true_false', text: '', options: null, correct: false, explanation: null };
    expect(gradeAnswer(tf, false).correct).toBe(true); expect(gradeAnswer(tf, 'false').answered).toBe(false);
  });
  it('archived assessments cannot be started; a child already inside may still finish', async () => {
    const { token } = await registerTeacher(t);
    const { classId, students } = await klass(token, 2);
    const id = await full(token);
    const links = await publishTo(token, id, classId);
    const started = await play(links[0]);
    await t.api('POST', `/api/assessments/${id}/archive`, undefined, token);
    expect((await t.api('GET', `/api/play/${tokenOf(links[1].url)}`)).status).toBe(410);
    expect((await submit(started.tk, started.g.session.id, perfect(started.qs))).data.duplicate).toBe(false);
    void students;
  });
});

describe('Test 14-15: student report is separate and never touches the cognitive profile', () => {
  it('shows «آزمون‌های معلم» on its own and leaves metrics/profile untouched', async () => {
    const { token } = await registerTeacher(t);
    const { classId, students } = await klass(token, 1);
    const act = (await t.api('POST', '/api/activities', { classId, gameType: 'memory', difficultyMode: 'medium', questionCount: 5 }, token)).data;
    await publishForTest(t, token, act.activity.id);
    const tkA = tokenOf(act.links[0].url);
    const pa = (await t.api('GET', `/api/play/${tkA}`)).data;
    expect((await t.api('POST', `/api/play/${tkA}/complete`, { sessionId: pa.session.id, events: memoryEvents(5, 4, 2) })).status).toBe(200);
    const sid = students[0].id;
    const profileBefore = (await t.api('GET', `/api/students/${sid}/profile`, undefined, token)).data;
    const reportBefore = (await t.api('GET', `/api/reports/student/${sid}`, undefined, token)).data;
    const metricsBefore = await t.db.prepare('SELECT * FROM student_metrics WHERE student_id = ? ORDER BY game_type').bind(sid).all();
    const resultsBefore = await count('SELECT COUNT(*) AS n FROM game_results');

    const id = await full(token, { title: 'علوم – فصل دوم' });
    const [link] = await publishTo(token, id, classId);
    const p = await play(link);
    await submit(p.tk, p.g.session.id, perfect(p.qs), 14 * 60000);

    const sa = (await t.api('GET', `/api/students/${sid}/assessments`, undefined, token)).data;
    expect(sa.title).toBe('آزمون‌های معلم');
    expect(sa.assessments).toHaveLength(1);
    expect(sa.assessments[0]).toMatchObject({ title: 'علوم – فصل دوم', subject: 'علوم', status: 'completed', questionCount: 3, correct: 3, percent: 100, minutes: 14 });
    // The profile now also carries the teacher-exam summary (shown under the student's name), but the cognitive part never changes.
    const profileAfter = (await t.api('GET', `/api/students/${sid}/profile`, undefined, token)).data;
    const { assessments: asBefore, summary: sumBefore, ...restBefore } = profileBefore;
    const { assessments: asAfter, summary: sumAfter, ...restAfter } = profileAfter;
    expect(restAfter).toEqual(restBefore);
    expect(asBefore.count).toBe(0);
    expect(asAfter).toMatchObject({ count: 1, average: 100, last: 100 });
    expect(sumAfter.assessmentsBasedOn).toBe(1);
    expect((await t.api('GET', `/api/reports/student/${sid}`, undefined, token)).data).toEqual(reportBefore);
    expect((await t.db.prepare('SELECT * FROM student_metrics WHERE student_id = ? ORDER BY game_type').bind(sid).all()).results).toEqual(metricsBefore.results);
    expect(await count('SELECT COUNT(*) AS n FROM game_results')).toBe(resultsBefore);
    expect(JSON.stringify(reportBefore)).not.toContain('علوم – فصل دوم');
  });
});

describe('Test 16-19: versions, duplicate, archive', () => {
  it('editing a published assessment is refused; «new version» is an independent draft, the old one stays immutable', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 2);
    const id = await full(token);
    const [l1] = await publishTo(token, id, classId);
    const first = await play(l1);
    for (const r of [
      await t.api('POST', `/api/assessments/${id}/questions`, FB, token),
      await t.api('PUT', `/api/assessments/${id}/questions/${first.qs[0].id}`, { ...MC, text: 'x' }, token),
      await t.api('DELETE', `/api/assessments/${id}/questions/${first.qs[0].id}`, undefined, token),
      await t.api('PUT', `/api/assessments/${id}`, { gradeCode: 'g3' }, token),
    ]) { expect(r.status).toBe(409); expect(r.data.error).toBe('assessment_locked'); expect(r.data.message).toContain('نسخه جدید'); }
    expect((await t.api('PUT', `/api/assessments/${id}`, { title: 'عنوان بهتر' }, token)).status).toBe(200); // cosmetic change is fine

    const v2 = await t.api('POST', `/api/assessments/${id}/new-version`, undefined, token);
    expect(v2.status).toBe(201);
    expect(v2.data.assessment).toMatchObject({ version: 2, status: 'draft', rootId: id, assigned: 0 });
    expect(v2.data.versions.map((v: any) => v.version)).toEqual([1, 2]);
    const again = await t.api('POST', `/api/assessments/${id}/new-version`, undefined, token);
    expect(again.data.assessment.id).toBe(v2.data.assessment.id);                                         // no second draft
    const v2id = v2.data.assessment.id;
    await t.api('PUT', `/api/assessments/${v2id}/questions/${v2.data.questions[0].id}`, { ...MC, text: 'متن نسخه دوم' }, token);
    // the student of v1 still sees v1 and v1's result is unaffected
    const still = (await t.api('GET', `/api/play/${first.tk}`)).data;
    expect(still.assessment.questions[0].text).toBe(MC.text);
    const done = await submit(first.tk, first.g.session.id, perfect(first.qs));
    expect(done.status).toBe(200);
    expect((await t.api('GET', `/api/assessments/${id}/report`, undefined, token)).data.participants).toBe(1);
    // v2 needs its own preview before it can go out
    expect((await t.api('POST', `/api/assessments/${v2id}/publish`, {}, token)).status).toBe(409);
    expect((await previewAndApprove(token, v2id)).f.assessment.status).toBe('ready_to_publish');
    const pub = await t.api('POST', `/api/assessments/${v2id}/publish`, { classId }, token);
    expect(pub.data.assessment).toMatchObject({ status: 'published', version: 2 });
    expect((await t.api('GET', `/api/assessments/${v2id}/report`, undefined, token)).data.participants).toBe(0);
  });
  it('duplicate = independent draft with no results; archive instead of destructive delete', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 1);
    const id = await full(token, { title: 'آزمون علوم ششم - فصل ۲' });
    const [l] = await publishTo(token, id, classId);
    const p = await play(l); await submit(p.tk, p.g.session.id, perfect(p.qs));
    const d = await t.api('POST', `/api/assessments/${id}/duplicate`, undefined, token);
    expect(d.status).toBe(201);
    expect(d.data.assessment).toMatchObject({ title: 'کپی آزمون علوم ششم - فصل ۲', status: 'draft', version: 1, assigned: 0, completed: 0, questionCount: 3 });
    expect(d.data.assessment.rootId).toBe(d.data.assessment.id);
    expect(d.data.assessment.id).not.toBe(id);
    expect(new Set([...d.data.questions.map((q: any) => q.id), ...(await t.api('GET', `/api/assessments/${id}`, undefined, token)).data.questions.map((q: any) => q.id)]).size).toBe(6);
    expect((await t.api('GET', `/api/assessments/${d.data.assessment.id}/report`, undefined, token)).data.participants).toBe(0);
    // the copy is freely editable; deleting a never-published draft is allowed, a published one is not
    expect((await t.api('POST', `/api/assessments/${d.data.assessment.id}/questions`, FB, token)).status).toBe(201);
    expect((await t.api('DELETE', `/api/assessments/${d.data.assessment.id}`, undefined, token)).status).toBe(200);
    const del = await t.api('DELETE', `/api/assessments/${id}`, undefined, token);
    expect(del.status).toBe(409); expect(del.data.error).toBe('assessment_has_results');
    const arch = await t.api('POST', `/api/assessments/${id}/archive`, undefined, token);
    expect(arch.data.assessment).toMatchObject({ status: 'archived', statusLabel: 'آرشیوشده' });
    expect((await t.api('GET', `/api/assessments/${id}/report`, undefined, token)).data.participants).toBe(1); // results kept
    expect((await t.api('POST', `/api/assessments/${id}/unarchive`, undefined, token)).data.assessment.status).toBe('published');
  });
  it('filters: all / draft / ready_to_publish / published / archived', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 1);
    const d = await full(token, { title: 'پیش‌نویس' });
    const r = await full(token, { title: 'آماده' }); await previewAndApprove(token, r);
    const p = await full(token, { title: 'منتشر' }); await publishTo(token, p, classId);
    const a = await full(token, { title: 'آرشیو' }); await t.api('POST', `/api/assessments/${a}/archive`, undefined, token);
    const titles = async (f: string) => ((await t.api('GET', `/api/assessments?status=${f}`, undefined, token)).data.assessments as any[]).map((x) => x.title).sort();
    expect(await titles('all')).toEqual(['آرشیو', 'آماده', 'منتشر', 'پیش‌نویس']);
    expect(await titles('draft')).toEqual(['پیش‌نویس']);
    expect(await titles('ready_to_publish')).toEqual(['آماده']);
    expect(await titles('published')).toEqual(['منتشر']);
    expect(await titles('archived')).toEqual(['آرشیو']);
    expect((await t.api('GET', '/api/assessments?status=zzz', undefined, token)).status).toBe(400);
    void d;
  });
});

describe('Test 20: isolation between teachers', () => {
  it('a second teacher gets 404 for everything of the first, and cannot assign foreign classes', async () => {
    const t1 = await registerTeacher(t), t2 = await registerTeacher(t);
    const { classId, students } = await klass(t1.token, 1);
    const id = await full(t1.token);
    const [link] = await publishTo(t1.token, id, classId);
    const p = await play(link); await submit(p.tk, p.g.session.id, perfect(p.qs));
    const q0 = (await t.api('GET', `/api/assessments/${id}`, undefined, t1.token)).data.questions[0].id;
    const calls: [string, string, unknown?][] = [
      ['GET', `/api/assessments/${id}`], ['PUT', `/api/assessments/${id}`, { title: 'x' }], ['DELETE', `/api/assessments/${id}`],
      ['POST', `/api/assessments/${id}/questions`, FB], ['PUT', `/api/assessments/${id}/questions/${q0}`, MC], ['DELETE', `/api/assessments/${id}/questions/${q0}`],
      ['POST', `/api/assessments/${id}/duplicate`], ['POST', `/api/assessments/${id}/new-version`], ['POST', `/api/assessments/${id}/preview`],
      ['POST', `/api/assessments/${id}/publish`, {}], ['POST', `/api/assessments/${id}/archive`], ['GET', `/api/assessments/${id}/report`],
      ['POST', `/api/assessments/${id}/assign`, { classId }], ['GET', `/api/students/${students[0].id}/assessments`],
    ];
    for (const [m, path, body] of calls) expect((await t.api(m, path, body, t2.token)).status, `${m} ${path}`).toBe(404);
    expect(((await t.api('GET', '/api/assessments', undefined, t2.token)).data.assessments)).toHaveLength(0);
    // t2 cannot hand its own assessment to t1's class
    const mine = await full(t2.token); await previewAndApprove(t2.token, mine);
    expect((await t.api('POST', `/api/assessments/${mine}/publish`, { classId }, t2.token)).status).toBe(404);
    expect((await t.api('GET', '/api/assessments', undefined)).status).toBe(401);
  });
});

describe('Test 21-22: AI produces drafts only and fails gracefully', () => {
  const good = JSON.stringify({ title: 'علوم ششم', subject: 'علوم', gradeCode: 'g6', level: 'intermediate', questions: [
    { type: 'multiple_choice', text: 'کدام سیاره به خورشید نزدیک‌تر است؟', options: ['عطارد', 'زمین', 'مریخ', 'زحل'], correct: 'A' },
    { type: 'true_false', text: 'ماه یک ستاره است.', correct: 'نادرست' },
    { type: 'fill_blank', text: 'آب در ____ درجه می‌جوشد.', answer: '۱۰۰' },
    { type: 'multiple_choice', text: 'خراب', options: ['x', 'x'], correct: 0 },
    { type: 'essay', text: 'تشریحی' },
  ] });
  it('validates the model output question by question and saves a draft (never published)', async () => {
    const { token, id: tid } = await registerTeacher(t);
    const { students } = await klass(token, 1);
    let seen = '';
    const r = await createAiDraft({ DB: t.db } as any, tid, { prompt: 'یک آزمون ۵ سؤالی علوم ششم بساز', questionCount: 5 }, async (_s, facts) => { seen = facts; return `روی پیام:\n\`\`\`json\n${good}\n\`\`\``; });
    expect(r.status).toBe(201);
    const body: any = await r.json();
    expect(body).toMatchObject({ source: 'ai', status: 'draft', droppedQuestions: 2, requiresTeacherApproval: true });
    expect(body.assessment).toMatchObject({ status: 'draft', questionCount: 3, version: 1 });
    expect(body.questions.map((q: any) => q.type)).toEqual(['multiple_choice', 'true_false', 'fill_blank']);
    expect(body.questions[0].correct).toBe(0); expect(body.questions[1].correct).toBe(false); expect(body.questions[2].answers).toEqual(['۱۰۰']);
    expect(seen).not.toContain(students[0].name);                       // no student data reaches the model
    expect(seen).not.toMatch(/phone|09\d{9}|token|classId/i);
    // it is an ordinary draft: it cannot be published without preview + approval
    expect((await t.api('POST', `/api/assessments/${body.assessment.id}/publish`, {}, token)).status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM assessments WHERE id = ? AND status = 'draft' AND published_at IS NULL", body.assessment.id)).toBe(1);
  });
  it('falls back gracefully when the AI is missing, broken or returns junk — manual creation keeps working', async () => {
    const { token, id: tid } = await registerTeacher(t);
    const env = { DB: t.db } as any, b = { prompt: 'آزمون ریاضی پنجم', questionCount: 5 };
    for (const [prov, status, code] of [[async () => null, 503, 'ai_unavailable'], [async () => { throw new Error('boom'); }, 503, 'ai_unavailable'], [async () => 'متن بی‌ربط', 502, 'ai_invalid'], [async () => '{"questions":[{"type":"essay"}]}', 502, 'ai_invalid']] as const) {
      await expect(createAiDraft(env, tid, b, prov as any)).rejects.toMatchObject({ status, code });
    }
    expect(await count('SELECT COUNT(*) AS n FROM assessments WHERE teacher_id = ?', tid)).toBe(0); // nothing half-saved
    const http = await t.api('POST', '/api/ai/assessment-draft', b, token);            // no provider configured in tests
    expect(http.status).toBe(503); expect(http.data.message).toContain('دستی');
    expect((await t.api('POST', '/api/ai/assessment-draft', { prompt: 'x' }, token)).status).toBe(400);
    const id = await full(token);                                                      // manual path is unaffected
    expect((await previewAndApprove(token, id)).f.assessment.status).toBe('ready_to_publish');
  });
  it('coerces typical model formats but never accepts a question the editor would refuse', () => {
    expect(coerceModelQuestion({ type: 'multiple_choice', text: 'x', options: ['1', '2', '3', '4'], correct: '2' })).toMatchObject({ correct: 2 });
    expect(coerceModelQuestion({ type: 'multiple_choice', text: 'x', options: ['1', '2', '3', '4'], correct: 9 })).toBeNull();
    expect(coerceModelQuestion({ type: 'true_false', text: 'x', correct: 'درست' })).toMatchObject({ correct: true });
    expect(coerceModelQuestion({ type: 'fill_blank', text: 'x', answers: [] })).toBeNull();
    expect(parseModelAssessment('no json', 5)).toBeNull();
  });
});

describe('Test 23-24: refresh and network interruption', () => {
  it('reopening the link resumes the SAME attempt and questions; double / retried submissions create one result', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 1);
    const id = await full(token);
    const [link] = await publishTo(token, id, classId);
    const first = await play(link);
    const again = await play(link);                                                      // refresh
    expect(again.g.status).toBe('resume');
    expect(again.g.session.id).toBe(first.g.session.id);
    expect(again.qs.map((q: any) => q.id)).toEqual(first.qs.map((q: any) => q.id));
    expect(await count('SELECT COUNT(*) AS n FROM assessment_attempts WHERE assessment_id = ?', id)).toBe(1);
    const results = await Promise.all([submit(first.tk, first.g.session.id, perfect(first.qs)), submit(first.tk, first.g.session.id, perfect(first.qs)), submit(first.tk, first.g.session.id, perfect(first.qs))]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.data.duplicate === false)).toHaveLength(1);
    // a late retry with DIFFERENT answers cannot change the stored result
    const late = await submit(first.tk, first.g.session.id, first.qs.map((q: any) => ({ questionId: q.id, answer: q.type === 'fill_blank' ? 'غلط' : q.type === 'true_false' ? false : 3 })));
    expect(late.data.duplicate).toBe(true);
    expect(await count('SELECT COUNT(*) AS n FROM assessment_results WHERE attempt_id = ?', first.g.session.id)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM assessment_answers WHERE attempt_id = ?', first.g.session.id)).toBe(3);
    expect((await t.api('GET', `/api/assessments/${id}/report`, undefined, token)).data).toMatchObject({ participants: 1, averagePercent: 100 });
    const reopened = (await t.api('GET', `/api/play/${first.tk}`)).data;
    expect(reopened).toMatchObject({ kind: 'teacher_assessment', status: 'completed' });
  });
  it('rejects foreign sessions, unknown questions, junk and invalid tokens', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 2);
    const id = await full(token);
    const [l1, l2] = await publishTo(token, id, classId);
    const a = await play(l1), b = await play(l2);
    expect((await submit(a.tk, b.g.session.id, perfect(a.qs))).status).toBe(404);            // someone else's attempt
    expect((await t.api('POST', `/api/play/${a.tk}/complete`, { sessionId: a.g.session.id, answers: [] })).status).toBe(422);
    expect((await t.api('POST', `/api/play/${a.tk}/complete`, { sessionId: 'nope', answers: [] })).status).toBe(400);
    const odd = await submit(a.tk, a.g.session.id, [{ questionId: 'not-a-question', answer: 0 }, { questionId: a.qs[0].id, answer: 'tamper' }]);
    expect(odd.status).toBe(200);
    expect((await t.db.prepare('SELECT correct, unanswered FROM assessment_results WHERE attempt_id = ?').bind(a.g.session.id).first<any>())).toEqual({ correct: 0, unanswered: 3 });
    expect((await t.api('GET', '/api/play/AAAAAAAAAAAAAAAA')).status).toBe(404);
  });
});

describe('Test 25 + privacy: activities untouched, erase flows cover assessments', () => {
  it('activity links still resolve exactly as before next to assessment links', async () => {
    const { token } = await registerTeacher(t);
    const { classId } = await klass(token, 1);
    const act = (await t.api('POST', '/api/activities', { classId, gameType: 'memory', difficultyMode: 'easy', questionCount: 5 }, token)).data;
    await publishForTest(t, token, act.activity.id);
    const g = await t.api('GET', `/api/play/${tokenOf(act.links[0].url)}`);
    expect(g.status).toBe(200); expect(g.data.game).toBe('memory'); expect(g.data.kind).toBeUndefined();
    const ev = await t.api('POST', `/api/play/${tokenOf(act.links[0].url)}/complete`, { sessionId: g.data.session.id, events: memoryEvents(5, 5, 1) });
    expect(ev.data.ok).toBe(true);
    expect((await t.api('GET', '/api/play/BBBBBBBBBBBBBBBB')).status).toBe(404);
  });
  it('«delete student data», «delete student» and «delete class» also erase assessment answers and results', async () => {
    const { token } = await registerTeacher(t);
    const { classId, students } = await klass(token, 2);
    const id = await full(token);
    const links = await publishTo(token, id, classId);
    for (const l of links) { const p = await play(l); await submit(p.tk, p.g.session.id, perfect(p.qs)); }
    expect(await count('SELECT COUNT(*) AS n FROM assessment_results')).toBeGreaterThan(0);
    const mine = () => count('SELECT COUNT(*) AS n FROM assessment_results r JOIN assessment_attempts t ON t.id = r.attempt_id WHERE t.assessment_id = ?', id);
    expect(await mine()).toBe(2);
    expect((await t.api('DELETE', `/api/students/${students[0].id}/data`, undefined, token)).status).toBe(200);
    expect(await mine()).toBe(1);
    expect((await t.api('DELETE', `/api/students/${students[1].id}`, undefined, token)).status).toBe(200);
    expect(await mine()).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM assessment_answers WHERE assessment_id = ?', id)).toBe(0);
    const c2 = await klass(token, 1);
    const id2 = await full(token);
    const [l] = await publishTo(token, id2, c2.classId);
    const p = await play(l); await submit(p.tk, p.g.session.id, perfect(p.qs));
    expect((await t.api('DELETE', `/api/classes/${c2.classId}`, undefined, token)).status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM assessment_answers WHERE assessment_id = ?', id2)).toBe(0);
    expect((await t.api('GET', `/api/assessments/${id2}`, undefined, token)).status).toBe(200); // the assessment itself stays in the teacher's library
  });
  it('assign: selected students only, idempotent, archived class refused', async () => {
    const { token } = await registerTeacher(t);
    const { classId, students } = await klass(token, 3);
    const id = await full(token);
    await previewAndApprove(token, id);
    expect((await t.api('POST', `/api/assessments/${id}/assign`, { classId }, token)).status).toBe(409); // not published yet
    await t.api('POST', `/api/assessments/${id}/publish`, {}, token);
    const sel = await t.api('POST', `/api/assessments/${id}/assign`, { classId, studentIds: [students[0].id] }, token);
    expect(sel.data.links).toHaveLength(1); expect(sel.data.assessment.assigned).toBe(1);
    const all = await t.api('POST', `/api/assessments/${id}/assign`, { classId }, token);
    expect(all.data.links).toHaveLength(3); expect(all.data.assessment.assigned).toBe(3);
    expect(all.data.links.find((l: any) => l.studentId === students[0].id).token).toBe(sel.data.links[0].token); // same link, no duplicate
    expect((await t.api('POST', `/api/assessments/${id}/assign`, { classId, studentIds: ['3f2b8a52-6f4e-4a6e-9a39-0b1d6a0c7e11'] }, token)).status).toBe(400);
    await t.api('POST', `/api/classes/${classId}/archive`, undefined, token);
    expect((await t.api('POST', `/api/assessments/${id}/assign`, { classId }, token)).status).toBe(409);
  });
});
