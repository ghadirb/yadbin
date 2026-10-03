import type { Env } from '../env';
import { activityDto, effectiveGradeOrder, GAME_NAMES_FA, getOwnedActivity, getOwnedClass } from '../db/queries';
import { activityFit, computeAge, GRADES, gradeByCode, inferGradeOrder, type Fit } from '../education/catalog';
import { GEN_VERSION } from '../questions/generate-v2';
import { previewSummary, previewTuning } from '../services/preview';
import { playBaseUrl } from '../config/urls';
import { HttpError, json, readJson } from '../utils/http';
import { newId, newPlayToken, nowIso } from '../utils/ids';
import { filterTemplates, templateById, templateDto } from '../education/templates';
import { activitySchema, activityUpdateSchema, duplicateSchema, parse, previewFeedbackSchema, previewStartSchema, publishSchema, regenerateSchema } from '../validation/schemas';

const playUrl = (env: Env, token: string) => `${playBaseUrl(env)}/play/${token}`;
const DEFAULT_EXPIRY_DAYS = 30;
const gradeByOrderCode = (o: number | null) => (o == null ? null : GRADES.find((g) => g.order === o)?.code ?? null);
const ORDINALS_FA = ['', 'اول', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم', 'هفتم', 'هشتم', 'نهم', 'دهم'];

interface NewActivity {
  classId: string; gameType: string; difficultyMode: string; questionCount: number;
  title: string | null; description: string | null; suggestedMinutes: number | null; expiresInDays?: number;
  ageMin?: number | null; ageMax?: number | null; gradeMin?: string | null; gradeMax?: string | null; level?: string | null; skills?: string[] | null; templateId?: string | null; requiresPreview?: boolean;
}

/** Fit of each student to an activity's age/grade range. Advisory only: it never blocks creation or assignment. */
async function fitFor(env: Env, teacherId: string, a: any, studentIds: string[]) {
  if (!studentIds.length) return [];
  const rows = await env.DB.prepare(
    `SELECT s.*, (SELECT c.grade_order FROM class_students cs JOIN classes c ON c.id = cs.class_id WHERE cs.student_id = s.id AND cs.removed_at IS NULL ORDER BY cs.added_at DESC LIMIT 1) AS class_order
       FROM students s WHERE s.teacher_id = ? AND s.id IN (${studentIds.map(() => '?').join(',')})`,
  ).bind(teacherId, ...studentIds).all<any>();
  return rows.results.map((s) => {
    const gradeOrder = s.grade_order ?? inferGradeOrder(s.grade) ?? s.class_order ?? null;
    return { studentId: s.id, ...activityFit({ ageMin: a.age_min, ageMax: a.age_max, gradeMin: a.grade_min, gradeMax: a.grade_max }, { age: computeAge(s).age, gradeOrder }) };
  });
}
const fitSummary = (fits: { fit: Fit }[]) => fits.reduce<Record<string, number>>((m, f) => ({ ...m, [f.fit]: (m[f.fit] ?? 0) + 1 }), {});

async function assertClassOpen(env: Env, teacherId: string, classId: string) {
  const c = await getOwnedClass(env.DB, teacherId, classId);
  if (c.archived_at) throw new HttpError(409, 'class_archived', 'این کلاس آرشیو شده است. ابتدا آن را از آرشیو خارج کنید.');
  return c;
}

export async function chooseStudents(env: Env, teacherId: string, classId: string, studentIds: 'all' | string[]) {
  const active = await env.DB.prepare(
    `SELECT s.id, s.display_name FROM class_students cs JOIN students s ON s.id = cs.student_id
      WHERE cs.class_id = ? AND cs.removed_at IS NULL AND s.teacher_id = ? ORDER BY cs.added_at`,
  ).bind(classId, teacherId).all<{ id: string; display_name: string }>();
  const byId = new Map(active.results.map((s) => [s.id, s]));
  let chosen = active.results;
  if (studentIds !== 'all') {
    chosen = [];
    for (const id of studentIds) {
      const s = byId.get(id);
      if (!s) throw new HttpError(400, 'invalid_student', 'یکی از دانش‌آموزان انتخاب‌شده عضو این کلاس نیست.');
      if (!chosen.includes(s)) chosen.push(s);
    }
  }
  if (!chosen.length) throw new HttpError(400, 'no_students', 'این کلاس دانش‌آموزی ندارد.');
  return chosen;
}

async function insertActivity(env: Env, teacherId: string, a: NewActivity, chosen: { id: string; display_name: string }[]) {
  const id = newId(), now = nowIso();
  const expires = new Date(Date.now() + (a.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * 86400_000).toISOString();
  const links = chosen.map((s) => ({ rowId: newId(), studentId: s.id, name: s.display_name, token: newPlayToken() }));
  await env.DB.batch([
    env.DB.prepare('INSERT INTO activities (id,teacher_id,class_id,game_type,difficulty_mode,question_count,status,created_at,expires_at,title,description,suggested_minutes,age_min,age_max,grade_min,grade_max,activity_level,skills_json,template_id,publish_state,requires_preview,teacher_approved_at,preview_feedback) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, teacherId, a.classId, a.gameType, a.difficultyMode, a.questionCount, 'active', now, expires, a.title, a.description, a.suggestedMinutes,
        a.ageMin ?? null, a.ageMax ?? null, gradeByCode(a.gradeMin)?.order ?? null, gradeByCode(a.gradeMax)?.order ?? null, a.level ?? null, a.skills?.length ? JSON.stringify(a.skills) : null, a.templateId ?? null,
        a.requiresPreview === false ? 'published' : 'draft', a.requiresPreview === false ? 0 : 1, a.requiresPreview === false ? now : null, a.requiresPreview === false ? 'skipped' : null),
    ...links.map((l) => env.DB.prepare('INSERT INTO activity_students (id,activity_id,student_id,token,status) VALUES (?,?,?,?,?)').bind(l.rowId, id, l.studentId, l.token, 'pending')),
  ]);
  const row = await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first<any>();
  const fits = await fitFor(env, teacherId, row, chosen.map((c) => c.id));
  return {
    activity: activityDto(row, links.length, 0),
    suitability: { summary: fitSummary(fits), students: fits.filter((f) => f.fit === 'easier_possible' || f.fit === 'out_of_range') },
    links: links.map((l) => ({ studentId: l.studentId, name: l.name, token: l.token, url: playUrl(env, l.token) })),
  };
}

export async function createActivity(req: Request, env: Env, teacherId: string) {
  return createFromBody(env, teacherId, await readJson(req));
}

/** GET /templates?grade=&skill=&level=&gameType= */
export function listTemplates(req: Request) {
  const sp = new URL(req.url).searchParams;
  return json({ templates: filterTemplates({ grade: sp.get('grade'), skill: sp.get('skill'), level: sp.get('level'), gameType: sp.get('gameType') }).map(templateDto) });
}
export function getTemplate(id: string) {
  const t = templateById(id);
  if (!t) throw new HttpError(404, 'not_found', 'قالب یافت نشد.');
  return json({ template: templateDto(t) });
}

/** POST /activities/from-template — template defaults, overridden by any field the teacher sends (nothing is locked). */
export async function createFromTemplate(req: Request, env: Env, teacherId: string) {
  const raw = (await readJson(req)) as Record<string, unknown>;
  const t = templateById(String(raw?.templateId ?? ''));
  if (!t) throw new HttpError(404, 'not_found', 'قالب یافت نشد.');
  const defaults = { gameType: t.gameType, difficultyMode: t.difficultyMode, questionCount: t.questionCount, suggestedMinutes: t.suggestedMinutes, title: t.title, description: t.description,
    level: t.level, skills: t.skills, gradeMin: t.gradeMin, gradeMax: t.gradeMax, ageMin: t.ageMin, ageMax: t.ageMax };
  const merged = { ...defaults, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) };
  return createFromBody(env, teacherId, merged);
}

async function createFromBody(env: Env, teacherId: string, body: unknown) {
  const b = parse(activitySchema, body);
  if (b.templateId && !templateById(b.templateId)) throw new HttpError(400, 'validation_error', 'قالب معتبر نیست.');
  await assertClassOpen(env, teacherId, b.classId);
  const chosen = await chooseStudents(env, teacherId, b.classId, b.studentIds);
  return json(await insertActivity(env, teacherId, b, chosen), 201);
}

async function counts(env: Env, id: string) {
  const c = await env.DB.prepare(
    `SELECT COUNT(*) AS assigned, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN status!='pending' THEN 1 ELSE 0 END) AS touched
       FROM activity_students WHERE activity_id = ?`,
  ).bind(id).first<{ assigned: number; completed: number | null; touched: number | null }>();
  return { assigned: c?.assigned ?? 0, completed: c?.completed ?? 0, touched: c?.touched ?? 0 };
}


/** Shared by GET /activities and the dashboard: lifecycle + grade / skill / level / game / completion filters. */
export function applyActivityFilters<T extends Record<string, any>>(all: T[], sp: URLSearchParams, want = 'open'): T[] {
  const gradeF = gradeByCode(sp.get('grade'))?.order ?? null, skillF = sp.get('skill'), levelF = sp.get('level'), gameF = sp.get('gameType');
  const completion = sp.get('completion'); // done = everyone finished, open = somebody still has to
  return all.filter((a) => (want === 'all' ? true : want === 'open' ? a.lifecycle !== 'archived' : a.lifecycle === want))
    .filter((a) => !gameF || a.gameType === gameF)
    .filter((a) => !levelF || a.level === levelF)
    .filter((a) => !skillF || a.effectiveSkills.includes(skillF))
    // grade filter: activities whose range contains the grade, plus activities without any range (old/unrestricted ones)
    .filter((a) => gradeF === null || !a.hasSuitabilityRange || ((a.gradeMin === null || (gradeByCode(a.gradeMin)!.order <= gradeF)) && (a.gradeMax === null || (gradeByCode(a.gradeMax)!.order >= gradeF))))
    .filter((a) => !completion || (completion === 'done' ? a.assigned > 0 && a.completed >= a.assigned : a.completed < a.assigned));
}

/** GET /activities?classId=&lifecycle=active|ended|archived|all (default: everything not archived). */
export async function listActivities(req: Request, env: Env, teacherId: string) {
  const url = new URL(req.url);
  const classId = url.searchParams.get('classId');
  const want = url.searchParams.get('lifecycle') ?? 'open';
  if (classId) await getOwnedClass(env.DB, teacherId, classId);
  const { results } = await env.DB.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM activity_students x WHERE x.activity_id = a.id) AS assigned_n,
            (SELECT COUNT(*) FROM activity_students x WHERE x.activity_id = a.id AND x.status = 'completed') AS completed_n
       FROM activities a WHERE a.teacher_id = ? ${classId ? 'AND a.class_id = ?' : ''} ORDER BY a.created_at DESC LIMIT 200`,
  ).bind(...(classId ? [teacherId, classId] : [teacherId])).all<any>();
  const all = results.map((a) => activityDto(a, a.assigned_n, a.completed_n));
  const activities = applyActivityFilters(all, url.searchParams, want);
  return json({ activities });
}

export async function getActivity(env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  const rows = await env.DB.prepare(
    `SELECT ast.student_id, ast.token, ast.status, ast.started_at, ast.completed_at, s.display_name
       FROM activity_students ast JOIN students s ON s.id = ast.student_id WHERE ast.activity_id = ? ORDER BY s.display_name`,
  ).bind(id).all<any>();
  const c = await counts(env, id);
  const fits = new Map((await fitFor(env, teacherId, a, rows.results.map((r) => r.student_id))).map((f) => [f.studentId, f]));
  return json({
    activity: activityDto(a, c.assigned, c.completed),
    students: rows.results.map((r) => ({ studentId: r.student_id, name: r.display_name, token: r.token, url: playUrl(env, r.token), status: r.status, startedAt: r.started_at, completedAt: r.completed_at, fit: fits.get(r.student_id)?.fit ?? 'unknown', fitLabel: fits.get(r.student_id)?.label ?? null, fitReasons: fits.get(r.student_id)?.reasons ?? [] })),
  });
}

/** Edit (spec 2.1). Title/description/time/expiry are always editable. Game type never changes.
 *  Difficulty and question count change how the seeded question pool is built, so they are locked once a child has started. */
export async function updateActivity(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  const b = parse(activityUpdateSchema, await readJson(req));
  const c = await counts(env, id);
  const settingsChange = (b.difficultyMode !== undefined && b.difficultyMode !== a.difficulty_mode) || (b.questionCount !== undefined && b.questionCount !== a.question_count);
  const previewAffectingChange = settingsChange ||
    (b.level !== undefined && b.level !== a.activity_level) ||
    (b.ageMin !== undefined && b.ageMin !== a.age_min) || (b.ageMax !== undefined && b.ageMax !== a.age_max) ||
    (b.gradeMin !== undefined && (gradeByCode(b.gradeMin)?.order ?? null) !== a.grade_min) ||
    (b.gradeMax !== undefined && (gradeByCode(b.gradeMax)?.order ?? null) !== a.grade_max) ||
    (b.skills !== undefined && JSON.stringify(b.skills ?? []) !== JSON.stringify(a.skills_json ? JSON.parse(a.skills_json) : []));
  if (settingsChange && c.touched > 0)
    throw new HttpError(409, 'activity_in_progress', 'پس از شروع دانش‌آموزان، سطح دشواری و تعداد سؤال قابل تغییر نیست. از «ساخت نسخه جدید» استفاده کنید.');
  const expires = b.expiresInDays !== undefined ? new Date(Date.now() + b.expiresInDays * 86400_000).toISOString() : a.expires_at;
  // A change that alters what the child plays invalidates an earlier preview/approval — but ONLY while the activity is not published.
  // A published activity (students may already be playing) is never switched back to draft by an edit.
  const resetPreview = previewAffectingChange && a.publish_state !== 'published';
  const stmts = [env.DB.prepare(
    'UPDATE activities SET title=?, description=?, suggested_minutes=?, difficulty_mode=?, question_count=?, expires_at=?, age_min=?, age_max=?, grade_min=?, grade_max=?, activity_level=?, skills_json=?, previewed_at=?, preview_feedback=?, teacher_approved_at=?, publish_state=? WHERE id=? AND teacher_id=?',
  ).bind(
    b.title !== undefined ? (b.title || null) : a.title,
    b.description !== undefined ? (b.description || null) : a.description,
    b.suggestedMinutes !== undefined ? b.suggestedMinutes : a.suggested_minutes,
    b.difficultyMode ?? a.difficulty_mode, b.questionCount ?? a.question_count, expires,
    b.ageMin !== undefined ? b.ageMin : a.age_min, b.ageMax !== undefined ? b.ageMax : a.age_max,
    b.gradeMin !== undefined ? gradeByCode(b.gradeMin)?.order ?? null : a.grade_min, b.gradeMax !== undefined ? gradeByCode(b.gradeMax)?.order ?? null : a.grade_max,
    b.level !== undefined ? b.level : a.activity_level, b.skills !== undefined ? (b.skills?.length ? JSON.stringify(b.skills) : null) : a.skills_json,
    resetPreview ? null : a.previewed_at, resetPreview ? null : a.preview_feedback, resetPreview ? null : a.teacher_approved_at, resetPreview ? 'draft' : a.publish_state,
    id, teacherId,
  )];
  // Old preview runs no longer describe this activity: drop them, so a stale run can never be used to approve the edited one.
  if (resetPreview) stmts.push(env.DB.prepare('DELETE FROM teacher_preview_sessions WHERE activity_id = ?').bind(id));
  await env.DB.batch(stmts);
  return getActivity(env, teacherId, id);
}

/** "ساخت نسخه جدید" (spec 2.2): same class + settings, fresh links, title "<base> - تمرین دوم". Old results are untouched. */
export async function duplicateActivity(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  const b = parse(duplicateSchema, await readJson(req));
  await assertClassOpen(env, teacherId, a.class_id);
  const base = ((a.title as string | null) || GAME_NAMES_FA[a.game_type] || a.game_type).replace(/\s-\sتمرین\s\S+$/u, '');
  let title = b.title?.trim() || '';
  if (!title) {
    const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM activities WHERE class_id = ? AND teacher_id = ? AND (title = ? OR title LIKE ?)')
      .bind(a.class_id, teacherId, base, `${base} - تمرین %`).first<{ n: number }>())?.n ?? 1;
    const k = Math.max(2, n + 1);
    title = `${base} - تمرین ${ORDINALS_FA[k] ?? k}`;
  }
  const chosen = await chooseStudents(env, teacherId, a.class_id, b.studentIds);
  const out = await insertActivity(env, teacherId, {
    classId: a.class_id, gameType: a.game_type, difficultyMode: a.difficulty_mode, questionCount: a.question_count,
    title, description: a.description, suggestedMinutes: a.suggested_minutes,
    ageMin: a.age_min, ageMax: a.age_max, gradeMin: gradeByOrderCode(a.grade_min), gradeMax: gradeByOrderCode(a.grade_max), level: a.activity_level,
    skills: a.skills_json ? JSON.parse(a.skills_json) : null, templateId: a.template_id, requiresPreview: b.requiresPreview,
  }, chosen);
  return json(out, 201);
}

export async function cancelActivity(env: Env, teacherId: string, id: string) {
  await getOwnedActivity(env.DB, teacherId, id);
  await env.DB.prepare("UPDATE activities SET status = 'canceled' WHERE id = ? AND teacher_id = ?").bind(id, teacherId).run();
  return json({ ok: true });
}

/** Starts an isolated teacher run. Its token is never an activity_students token.
 *  Body (optional): { compareMode: 'easy'|'medium'|'hard' } → try another level without touching the activity (it never counts as approval). */
export async function startPreview(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  if (a.status === 'canceled') throw new HttpError(409, 'activity_canceled', 'این فعالیت لغو شده است.');
  const body = parse(previewStartSchema, await readJson(req));
  const compare = body.compareMode && body.compareMode !== a.difficulty_mode ? body.compareMode : null;
  const token = newPlayToken();
  const tuning = await previewTuning(env, id, GEN_VERSION);
  const cls = await getOwnedClass(env.DB, teacherId, a.class_id);
  await env.DB.prepare('INSERT INTO teacher_preview_sessions (id,activity_id,teacher_id,token,started_at,tuning,gen_version,compare_mode) VALUES (?,?,?,?,?,?,?,?)')
    .bind(newId(), id, teacherId, token, nowIso(), tuning, GEN_VERSION, compare).run();
  if (!compare) await env.DB.prepare("UPDATE activities SET publish_state = CASE WHEN publish_state = 'draft' THEN 'testing' ELSE publish_state END WHERE id = ? AND teacher_id = ?").bind(id, teacherId).run();
  return json({ token, url: `${playBaseUrl(env)}/preview/${token}`, comparison: !!compare, summary: previewSummary(a, cls, compare) });
}

/** Teacher's verdict after a completed (non-comparison) preview of the CURRENT settings.
 *  suitable / too_easy → ready to publish (an easy activity is safe; the teacher may still choose to edit it). too_hard / needs_edit → back to editing. */
export async function recordPreviewFeedback(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  const { feedback } = parse(previewFeedbackSchema, await readJson(req));
  const completed = await env.DB.prepare("SELECT id FROM teacher_preview_sessions WHERE activity_id = ? AND teacher_id = ? AND status = 'completed' AND compare_mode IS NULL ORDER BY completed_at DESC LIMIT 1").bind(id, teacherId).first();
  if (!completed) throw new HttpError(409, 'preview_required', 'ابتدا فعالیت را کامل آزمایش کنید.');
  const approved = feedback === 'suitable' || feedback === 'too_easy';
  const now = nowIso();
  if (a.publish_state === 'published') { // already live: the verdict is only recorded, the activity stays published
    await env.DB.prepare('UPDATE activities SET previewed_at=?, preview_feedback=? WHERE id=? AND teacher_id=?').bind(now, feedback, id, teacherId).run();
    return getActivity(env, teacherId, id);
  }
  await env.DB.prepare('UPDATE activities SET previewed_at=?, preview_feedback=?, teacher_approved_at=?, publish_state=? WHERE id=? AND teacher_id=?')
    .bind(now, feedback, approved ? now : null, approved ? 'ready_to_publish' : 'draft', id, teacherId).run();
  return getActivity(env, teacherId, id);
}

/** Publish = unlock the student links. Normal path: only after an approved preview.
 *  Teacher's explicit choice: body { withoutPreview: true } publishes an untested activity (recorded as feedback 'skipped'). */
export async function publishActivity(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  const body = parse(publishSchema, await readJson(req));
  if (a.status === 'canceled') throw new HttpError(409, 'activity_canceled', 'این فعالیت لغو شده است.');
  if (a.publish_state === 'published') return getActivity(env, teacherId, id);
  const approved = a.previewed_at && a.preview_feedback && a.teacher_approved_at && a.publish_state === 'ready_to_publish';
  const now = nowIso();
  if (!approved) {
    if (!body.withoutPreview)
      throw new HttpError(409, 'teacher_approval_required', a.preview_feedback === 'too_hard' || a.preview_feedback === 'needs_edit'
        ? 'فعالیت نیاز به ویرایش دارد. آن را ویرایش و دوباره آزمایش کنید، یا آگاهانه بدون آزمایش منتشر کنید.'
        : 'این فعالیت هنوز آزمایش نشده است. ابتدا آن را آزمایش کنید، یا آگاهانه بدون آزمایش منتشر کنید.', { canPublishWithoutPreview: true });
    await env.DB.prepare("UPDATE activities SET preview_feedback = 'skipped', previewed_at = NULL, teacher_approved_at = ? WHERE id = ? AND teacher_id = ?").bind(now, id, teacherId).run();
  }
  // The activity may have been waiting as a draft for days: the validity period starts at publication, not at creation.
  const span = Math.max(86400_000, Date.parse(a.expires_at ?? '') - Date.parse(a.created_at) || DEFAULT_EXPIRY_DAYS * 86400_000);
  await env.DB.prepare("UPDATE activities SET publish_state = 'published', expires_at = ? WHERE id = ? AND teacher_id = ?").bind(new Date(Date.now() + span).toISOString(), id, teacherId).run();
  return getActivity(env, teacherId, id);
}

export async function setArchived(env: Env, teacherId: string, id: string, archived: boolean) {
  await getOwnedActivity(env.DB, teacherId, id);
  await env.DB.prepare('UPDATE activities SET archived_at = ? WHERE id = ? AND teacher_id = ?').bind(archived ? nowIso() : null, id, teacherId).run();
  return getActivity(env, teacherId, id);
}

/** New entry links for students who have NOT finished (lost/leaked link). The old link stops working immediately;
 *  a started session survives because it hangs off the activity_student row, not the token. */
export async function regenerateLinks(req: Request, env: Env, teacherId: string, id: string) {
  const a = await getOwnedActivity(env.DB, teacherId, id);
  if (a.status === 'canceled') throw new HttpError(409, 'activity_canceled', 'این فعالیت لغو شده است.');
  const b = parse(regenerateSchema, await readJson(req));
  const rows = await env.DB.prepare(
    `SELECT ast.id, ast.student_id, s.display_name FROM activity_students ast JOIN students s ON s.id = ast.student_id
      WHERE ast.activity_id = ? AND ast.status != 'completed' ${b.studentId ? 'AND ast.student_id = ?' : ''}`,
  ).bind(...(b.studentId ? [id, b.studentId] : [id])).all<{ id: string; student_id: string; display_name: string }>();
  if (!rows.results.length) throw new HttpError(404, 'nothing_to_regenerate', 'دانش‌آموزی برای ساخت لینک جدید پیدا نشد.');
  const links = rows.results.map((r) => ({ id: r.id, studentId: r.student_id, name: r.display_name, token: newPlayToken() }));
  await env.DB.batch(links.map((l) => env.DB.prepare('UPDATE activity_students SET token = ? WHERE id = ?').bind(l.token, l.id)));
  return json({ links: links.map((l) => ({ studentId: l.studentId, name: l.name, token: l.token, url: playUrl(env, l.token) })) });
}
