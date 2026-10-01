import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityFit, computeAge, inferGradeOrder } from '../src/education/catalog';
import { createEnv, registerTeacher, type TestEnv } from './helpers';

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60_000);
afterAll(async () => { await t?.dispose(); });

describe('v1.2 education catalog (pure)', () => {
  it('infers grade from legacy free text', () => {
    expect(inferGradeOrder('ششم')).toBe(6);
    expect(inferGradeOrder('پنجم ابتدایی')).toBe(5);
    expect(inferGradeOrder('یازدهم')).toBe(11);
    expect(inferGradeOrder('دوازدهم')).toBe(12);
    expect(inferGradeOrder('دهم')).toBe(10);
    expect(inferGradeOrder('پیش‌دبستانی')).toBe(0);
    expect(inferGradeOrder('۴')).toBe(4);
    expect(inferGradeOrder('کلاس الف')).toBeNull();
    expect(inferGradeOrder(null)).toBeNull();
  });
  it('computes age from the full date, or approximately from the year', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    expect(computeAge({ birth_date: '2015-10-02' }, now)).toEqual({ age: 10, approximate: false });
    expect(computeAge({ birth_date: '2015-10-01' }, now)).toEqual({ age: 11, approximate: false });
    expect(computeAge({ birth_year: 2016 }, now)).toEqual({ age: 10, approximate: true });
    expect(computeAge({}, now)).toEqual({ age: null, approximate: false });
  });
  it('classifies fit: suitable / easier_possible / out_of_range / unrestricted / unknown', () => {
    const r = { gradeMin: 6, gradeMax: 6, ageMin: 11, ageMax: 12 };
    expect(activityFit(r, { age: 11, gradeOrder: 6 }).fit).toBe('suitable');
    expect(activityFit(r, { age: 10, gradeOrder: 5 }).fit).toBe('easier_possible');
    expect(activityFit(r, { age: 6, gradeOrder: 1 }).fit).toBe('out_of_range');
    expect(activityFit(r, { age: 14, gradeOrder: 8 }).fit).toBe('suitable');
    expect(activityFit(r, { age: 16, gradeOrder: 10 }).fit).toBe('out_of_range');
    expect(activityFit({}, { age: 6, gradeOrder: 1 }).fit).toBe('unrestricted');
    expect(activityFit(r, { age: null, gradeOrder: null }).fit).toBe('unknown');
    expect(activityFit(r, { age: null, gradeOrder: 6 }).fit).toBe('suitable');
  });
});

describe('v1.2 step 1 — age & grade API', () => {
  it('serves the education catalog', async () => {
    const r = await t.api('GET', '/api/v1/meta/education');
    expect(r.status).toBe(200);
    expect(r.data.grades).toHaveLength(13);
    expect(r.data.skills.map((s: any) => s.code)).toContain('response_control');
    expect(r.data.levels.map((l: any) => l.code)).toEqual(['introductory', 'basic', 'intermediate', 'advanced']);
  });

  it('old clients: class with only free-text grade still works, v1.2 fields are null', async () => {
    const { token } = await registerTeacher(t);
    const c = await t.api('POST', '/api/classes', { name: 'قدیمی', grade: 'سوم' }, token);
    expect(c.status).toBe(201);
    expect(c.data.class).toMatchObject({ grade: 'سوم', gradeCode: null, ageMin: null, gradeOrder: 3 });
    // an old client editing the class (no v1.2 fields) must not break it
    const u = await t.api('PUT', `/api/classes/${c.data.class.id}`, { name: 'قدیمی ۲', grade: 'سوم' }, token);
    expect(u.status).toBe(200);
  });

  it('creates and edits a class with grade, age range and stage; rejects bad input', async () => {
    const { token } = await registerTeacher(t);
    const c = await t.api('POST', '/api/classes', { name: 'ششم الف', gradeCode: 'g6', ageMin: 11, ageMax: 12 }, token);
    expect(c.status).toBe(201);
    expect(c.data.class).toMatchObject({ grade: 'ششم ابتدایی', gradeCode: 'g6', gradeOrder: 6, ageMin: 11, ageMax: 12, educationStage: 'primary' });
    const e = await t.api('PUT', `/api/classes/${c.data.class.id}`, { name: 'ششم الف', gradeCode: 'g5' }, token);
    expect(e.data.class).toMatchObject({ gradeCode: 'g5', gradeLabel: 'پنجم ابتدایی', ageMin: 11 });
    expect((await t.api('POST', '/api/classes', { name: 'x کلاس', gradeCode: 'g99' }, token)).status).toBe(400);
    expect((await t.api('POST', '/api/classes', { name: 'کلاس بد', gradeCode: 'g1', ageMin: 12, ageMax: 8 }, token)).status).toBe(400);
    expect((await t.api('POST', '/api/classes', { name: 'بدون پایه' }, token)).status).toBe(400);
  });

  it('students inherit the class grade; age comes from birth date / year / entered age and is never stored', async () => {
    const { token } = await registerTeacher(t);
    const c = (await t.api('POST', '/api/classes', { name: 'پنجم', gradeCode: 'g5' }, token)).data.class;
    const year = new Date().getUTCFullYear();
    const s1 = (await t.api('POST', '/api/students', { name: 'علی رضایی', classId: c.id, age: 10 }, token)).data.student;
    expect(s1).toMatchObject({ age: 10, ageApproximate: true, gradeCode: 'g5', gradeOrder: 5, birthYear: year - 10, birthDate: null });
    const s2 = (await t.api('PUT', `/api/students/${s1.id}`, { birthDate: `${year - 9}-01-01`, gender: 'female', note: 'یادداشت' }, token)).data.student;
    expect(s2).toMatchObject({ birthDate: `${year - 9}-01-01`, birthYear: null, gender: 'female', note: 'یادداشت', gradeCode: 'g5' });
    expect([9, 10]).toContain(s2.age);
    const s3 = (await t.api('PUT', `/api/students/${s1.id}`, { birthYear: 1393 }, token)).data.student; // Jalali year accepted
    expect(s3.birthYear).toBe(1393 + 621);
    const cleared = (await t.api('PUT', `/api/students/${s1.id}`, { age: null, gender: null, note: null }, token)).data.student;
    expect(cleared).toMatchObject({ age: null, birthYear: null, gender: null, note: null });
    expect((await t.api('PUT', `/api/students/${s1.id}`, { birthDate: '2999-01-01' }, token)).status).toBe(400);
    expect((await t.api('PUT', `/api/students/${s1.id}`, { age: 2 }, token)).status).toBe(400);
    const prof = await t.api('GET', `/api/students/${s1.id}/profile`, undefined, token);
    expect(prof.data.student.id).toBe(s1.id);
    const list = (await t.api('GET', `/api/classes/${c.id}`, undefined, token)).data.students;
    expect(list[0]).toMatchObject({ gradeCode: 'g5' });
  });

  it('activity carries age/grade/level/skills; fit is advisory and never blocks', async () => {
    const { token } = await registerTeacher(t);
    const c = (await t.api('POST', '/api/classes', { name: 'ترکیبی', gradeCode: 'g1' }, token)).data.class;
    const kid = (await t.api('POST', '/api/students', { name: 'کوچولو', classId: c.id, age: 6 }, token)).data.student;
    const big = (await t.api('POST', '/api/students', { name: 'بزرگ', classId: c.id, gradeCode: 'g6', age: 12 }, token)).data.student;
    const old = (await t.api('POST', `/api/classes/${c.id}/students`, { name: 'قدیمی بی‌اطلاعات' }, token)).data.added[0];
    const r = await t.api('POST', '/api/activities', {
      classId: c.id, gameType: 'attention', difficultyMode: 'medium', questionCount: 6, studentIds: [kid.id, big.id],
      gradeMin: 'g5', gradeMax: 'g6', ageMin: 10, ageMax: 12, level: 'intermediate', skills: ['attention', 'focus'],
    }, token);
    expect(r.status).toBe(201);
    expect(r.data.activity).toMatchObject({ gradeMin: 'g5', gradeMax: 'g6', ageMin: 10, ageMax: 12, level: 'intermediate', levelLabel: 'متوسط', skills: ['attention', 'focus'], hasSuitabilityRange: true });
    expect(r.data.suitability.summary).toMatchObject({ suitable: 1, out_of_range: 1 });
    expect(r.data.suitability.students[0]).toMatchObject({ studentId: kid.id, fit: 'out_of_range' });
    const g = (await t.api('GET', `/api/activities/${r.data.activity.id}`, undefined, token)).data;
    expect(g.students.find((s: any) => s.studentId === kid.id)).toMatchObject({ fit: 'out_of_range', fitLabel: 'خارج از محدوده پیشنهادی' });
    expect(g.students.find((s: any) => s.studentId === big.id).fit).toBe('suitable');
    // old-style activity (no range) → unrestricted, still fully usable
    const plain = await t.api('POST', '/api/activities', { classId: c.id, gameType: 'memory', studentIds: [old.id] }, token);
    expect(plain.status).toBe(201);
    expect(plain.data.activity).toMatchObject({ gradeMin: null, level: null, hasSuitabilityRange: false, effectiveSkills: ['memory'] });
    expect(plain.data.suitability.summary).toMatchObject({ unrestricted: 1 });
    // bad values
    expect((await t.api('POST', '/api/activities', { classId: c.id, gameType: 'memory', skills: ['x'] }, token)).status).toBe(400);
    expect((await t.api('POST', '/api/activities', { classId: c.id, gameType: 'memory', gradeMin: 'g6', gradeMax: 'g2' }, token)).status).toBe(400);
    // edit range, duplicate keeps it
    const up = await t.api('PUT', `/api/activities/${r.data.activity.id}`, { level: 'basic', gradeMin: null, skills: ['focus'] }, token);
    expect(up.data.activity).toMatchObject({ level: 'basic', gradeMin: null, skills: ['focus'], gradeMax: 'g6' });
    const dup = await t.api('POST', `/api/activities/${r.data.activity.id}/duplicate`, { studentIds: [big.id] }, token);
    expect(dup.data.activity).toMatchObject({ level: 'basic', gradeMax: 'g6', skills: ['focus'] });
  });

  it('filters activities by grade, skill, level, game and completion', async () => {
    const { token } = await registerTeacher(t);
    const c = (await t.api('POST', '/api/classes', { name: 'فیلتر', gradeCode: 'g3' }, token)).data.class;
    await t.api('POST', `/api/classes/${c.id}/students`, { text: 'الف الف\nب ب' }, token);
    const mk = (b: object) => t.api('POST', '/api/activities', { classId: c.id, ...b }, token);
    await mk({ gameType: 'memory', title: 'A', gradeMin: 'g1', gradeMax: 'g2', level: 'basic', skills: ['memory'] });
    await mk({ gameType: 'attention', title: 'B', gradeMin: 'g3', gradeMax: 'g4', level: 'intermediate', skills: ['focus'] });
    await mk({ gameType: 'problem_solving', title: 'C' });
    const titles = async (q: string) => (await t.api('GET', `/api/activities?classId=${c.id}${q}`, undefined, token)).data.activities.map((a: any) => a.title).sort();
    expect(await titles('&grade=g3')).toEqual(['B', 'C']);      // C has no range → always shown
    expect(await titles('&grade=g1')).toEqual(['A', 'C']);
    expect(await titles('&skill=focus')).toEqual(['B']);
    expect(await titles('&skill=problem_solving')).toEqual(['C']); // default skill from game type
    expect(await titles('&level=basic')).toEqual(['A']);
    expect(await titles('&gameType=attention')).toEqual(['B']);
    expect(await titles('&completion=open')).toEqual(['A', 'B', 'C']);
    expect(await titles('&completion=done')).toEqual([]);
  });

  it('security: another teacher cannot read or change profiles, and cannot attach foreign data', async () => {
    const a = await registerTeacher(t), b = await registerTeacher(t);
    const c = (await t.api('POST', '/api/classes', { name: 'کلاس A', gradeCode: 'g4' }, a.token)).data.class;
    const s = (await t.api('POST', '/api/students', { name: 'دانش‌آموز A', classId: c.id, age: 9 }, a.token)).data.student;
    expect((await t.api('GET', `/api/students/${s.id}/profile`, undefined, b.token)).status).toBe(404);
    expect((await t.api('PUT', `/api/students/${s.id}`, { age: 7 }, b.token)).status).toBe(404);
    expect((await t.api('POST', '/api/students', { name: 'نفوذ', classId: c.id }, b.token)).status).toBe(404);
    expect((await t.api('PUT', `/api/students/${s.id}`, { age: 7 })).status).toBe(401);
    expect((await t.api('GET', `/api/students/${s.id}/profile`, undefined, a.token)).data.student.age).toBe(9);
  });
});

// ───────────────────────── steps 2 & 3 ─────────────────────────
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildPools } from '../src/questions/generate';
import { tuningFor } from '../src/education/tuning';
import { TEMPLATES } from '../src/education/templates';
import { memoryEvents } from './helpers';

describe('v1.2 step 3 — age/grade based game tuning', () => {
  it('tuning 0 reproduces the v1.1 question pools byte for byte (existing games cannot break)', () => {
    const golden = JSON.parse(readFileSync(new URL('./fixtures/pools-v1.1.json', import.meta.url), 'utf8')) as Record<string, string>;
    let n = 0;
    for (const [key, hash] of Object.entries(golden)) {
      const [seed, game, lv, count] = key.split('|');
      const levels = lv.split('').map(Number) as (1 | 2 | 3)[];
      const h = (tuning?: 0) => createHash('sha256').update(JSON.stringify(buildPools(game as any, seed, levels, Number(count), tuning))).digest('hex').slice(0, 16);
      expect(h()).toBe(hash); expect(h(0)).toBe(hash); n++;
    }
    expect(n).toBe(108);
  });

  it('maps grade/age/level to a band; unknown data stays at default', () => {
    expect(tuningFor({})).toBe(0);
    expect(tuningFor({ gradeOrder: 1 })).toBe(-1);
    expect(tuningFor({ gradeOrder: 4 })).toBe(0);
    expect(tuningFor({ gradeOrder: 6 })).toBe(1);
    expect(tuningFor({ age: 6 })).toBe(-1);
    expect(tuningFor({ age: 13 })).toBe(1);
    expect(tuningFor({ gradeOrder: 4, level: 'introductory' })).toBe(-1);
    expect(tuningFor({ gradeOrder: 4, level: 'advanced' })).toBe(1);
    expect(tuningFor({ gradeOrder: 1, level: 'introductory' })).toBe(-1); // clamped
    expect(tuningFor({ gradeMin: 5, gradeMax: 7 })).toBe(1);               // falls back to the activity's own range
    expect(tuningFor({ gradeOrder: 2, age: 14 })).toBe(-1);                // grade wins over age
  });

  it('younger = easier parameters, older = harder, for every game', () => {
    const mem = (t: -1 | 0 | 1) => (buildPools('memory', 's1', [2], 10, t)[2] as any[]);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(mem(-1).map((q) => q.sequence.length))).toBeLessThan(avg(mem(0).map((q) => q.sequence.length)));
    expect(avg(mem(1).map((q) => q.sequence.length))).toBeGreaterThan(avg(mem(0).map((q) => q.sequence.length)));
    expect(mem(-1)[0].displayDuration).toBeGreaterThan(mem(0)[0].displayDuration);
    expect(mem(1)[0].displayDuration).toBeLessThan(mem(0)[0].displayDuration);
    const att = (t: -1 | 0 | 1) => (buildPools('attention', 's1', [2], 10, t)[2] as any[]);
    expect(att(-1)[0].gridSize).toBeLessThan(att(1)[0].gridSize);
    expect(att(-1)[0].timeLimit).toBeGreaterThan(att(1)[0].timeLimit);
    for (const t of [-1, 0, 1] as const) for (const q of att(t)) { expect(q.cells).toHaveLength(q.gridSize ** 2); expect(q.gridSize).toBeLessThanOrEqual(6); }
    for (const t of [-1, 0, 1] as const) for (const q of mem(t)) { expect(q.sequence.length).toBeLessThanOrEqual(9); expect(new Set(q.sequence).size).toBe(q.sequence.length); }
    const prob = (t: -1 | 0 | 1) => (buildPools('problem_solving', 's1', [3], 4, t)[3] as any[]).map((q) => q.type);
    expect(prob(1).filter((x) => x === 'multi_step').length).toBeGreaterThanOrEqual(prob(-1).filter((x) => x === 'multi_step').length);
    // deterministic
    expect(JSON.stringify(buildPools('memory', 'x', [1, 2, 3], 8, -1))).toBe(JSON.stringify(buildPools('memory', 'x', [1, 2, 3], 8, -1)));
  });

  it('a grade-1 student gets the gentler pool; it is fixed at session start and survives a grade edit; old data is unchanged', async () => {
    const { token } = await registerTeacher(t);
    const c = (await t.api('POST', '/api/classes', { name: 'اول', gradeCode: 'g1' }, token)).data.class;
    const kid = (await t.api('POST', '/api/students', { name: 'کودک اولی', classId: c.id }, token)).data.student;
    const legacyClass = (await t.api('POST', '/api/classes', { name: 'قدیمی', grade: 'کلاس الف' }, token)).data.class; // no grade info at all
    const old = (await t.api('POST', `/api/classes/${legacyClass.id}/students`, { name: 'بدون اطلاعات' }, token)).data.added[0];
    const a1 = (await t.api('POST', '/api/activities', { classId: c.id, gameType: 'memory', difficultyMode: 'medium', questionCount: 5 }, token)).data;
    const a2 = (await t.api('POST', '/api/activities', { classId: legacyClass.id, gameType: 'memory', difficultyMode: 'medium', questionCount: 5 }, token)).data;
    const play = async (url: string) => (await t.api('GET', `/api/play/${url.split('/play/')[1]}`)).data;
    const young = await play(a1.links[0].url);
    const plain = await play(a2.links[0].url);
    expect(young.pools['2'][0].displayDuration).toBe(1560);
    expect(plain.pools['2'][0].displayDuration).toBe(1200); // v1.1 value
    // teacher changes the student's grade mid-activity → resume returns the very same questions
    await t.api('PUT', `/api/students/${kid.id}`, { gradeCode: 'g9' }, token);
    const again = await play(a1.links[0].url);
    expect(again.status).toBe('resume');
    expect(JSON.stringify(again.pools)).toBe(JSON.stringify(young.pools));
    // results still record normally
    const done = await t.api('POST', `/api/play/${a1.links[0].url.split('/play/')[1]}/complete`, { sessionId: young.session.id, events: memoryEvents(5, 4, 2) });
    expect(done.status).toBe(200);
    void old;
  });

  it('problem-solving results are scored against the tuned pool of that session', async () => {
    const { token } = await registerTeacher(t);
    const c = (await t.api('POST', '/api/classes', { name: 'نهم', gradeCode: 'g9' }, token)).data.class;
    await t.api('POST', `/api/classes/${c.id}/students`, { name: 'نهمی' }, token);
    const a = (await t.api('POST', '/api/activities', { classId: c.id, gameType: 'problem_solving', difficultyMode: 'hard', questionCount: 5 }, token)).data;
    const tk = a.links[0].url.split('/play/')[1];
    const p = (await t.api('GET', `/api/play/${tk}`)).data;
    const qs = p.pools['3'] as any[];
    const events = qs.map((q) => ({ questionId: q.id, difficulty: 3, attempts: 1, hintsUsed: 0, responseTime: 3000, finalAnswer: q.correctOption }));
    const done = await t.api('POST', `/api/play/${tk}/complete`, { sessionId: p.session.id, events });
    expect(done.status).toBe(200);
    const rep = (await t.api('GET', `/api/reports/student/${a.links[0].studentId}`, undefined, token)).data;
    expect(JSON.stringify(rep)).toContain('problem_solving');
  });
});

describe('v1.2 step 2 — templates', () => {
  it('ships the 9 templates from the spec, each valid and consistent', () => {
    expect(TEMPLATES).toHaveLength(9);
    expect(new Set(TEMPLATES.map((x) => x.id)).size).toBe(9);
    for (const x of TEMPLATES) { expect(x.skills.length).toBeGreaterThan(0); expect(x.ageMin).toBeLessThanOrEqual(x.ageMax); expect(x.questionCount).toBeGreaterThanOrEqual(5); expect(x.questionCount).toBeLessThanOrEqual(12); }
  });

  it('lists/filters templates and creates an activity from one, with teacher overrides', async () => {
    const { token } = await registerTeacher(t);
    expect((await t.api('GET', '/api/templates')).status).toBe(401);
    const all = (await t.api('GET', '/api/v1/templates', undefined, token)).data.templates;
    expect(all).toHaveLength(9);
    const g1 = (await t.api('GET', '/api/templates?grade=g1', undefined, token)).data.templates.map((x: any) => x.id);
    expect(g1).toContain('memory-visual-intro'); expect(g1).not.toContain('memory-sequential');
    expect((await t.api('GET', '/api/templates?skill=response_control', undefined, token)).data.templates.map((x: any) => x.id)).toEqual(['attention-selective']);
    expect((await t.api('GET', '/api/templates/attention-selective', undefined, token)).data.template.gameType).toBe('attention');
    expect((await t.api('GET', '/api/templates/nope', undefined, token)).status).toBe(404);

    const c = (await t.api('POST', '/api/classes', { name: 'سوم', gradeCode: 'g3' }, token)).data.class;
    await t.api('POST', `/api/classes/${c.id}/students`, { text: 'الف الف\nب ب' }, token);
    const r = await t.api('POST', '/api/activities/from-template', { templateId: 'attention-selective', classId: c.id, questionCount: 7, title: 'عنوان من' }, token);
    expect(r.status).toBe(201);
    expect(r.data.activity).toMatchObject({ gameType: 'attention', difficultyMode: 'hard', questionCount: 7, title: 'عنوان من', level: 'advanced', templateId: 'attention-selective', gradeMin: 'g4' });
    expect(r.data.activity.skills).toContain('response_control');
    expect(r.data.suitability.summary.easier_possible).toBe(2); // grade 3 is one below g4 → "usable with an easier level"
    expect((await t.api('POST', '/api/activities/from-template', { templateId: 'x', classId: c.id }, token)).status).toBe(404);
    expect((await t.api('POST', '/api/activities', { classId: c.id, gameType: 'memory', templateId: 'bogus' }, token)).status).toBe(400);
  });

  it("a template cannot be used on another teacher's class", async () => {
    const a = await registerTeacher(t), b = await registerTeacher(t);
    const c = (await t.api('POST', '/api/classes', { name: 'کلاس A', gradeCode: 'g2' }, a.token)).data.class;
    await t.api('POST', `/api/classes/${c.id}/students`, { name: 'دانش‌آموز' }, a.token);
    expect((await t.api('POST', '/api/activities/from-template', { templateId: 'memory-visual-intro', classId: c.id }, b.token)).status).toBe(404);
  });
});
