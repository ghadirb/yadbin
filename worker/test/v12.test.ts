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
