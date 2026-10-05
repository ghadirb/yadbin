import { z } from 'zod';
import type { Env } from '../env';
import { gradeByCode, isGradeCode } from '../education/catalog';
import { EXTRACT_MESSAGES_FA, FILE_TYPES, LIMITS, type ExtractInput, type FileType } from '../content_sources/extract';
import { processSource, STALE_PROCESSING_MESSAGE_FA, STALE_PROCESSING_MS } from '../content_sources/service';
import { SECTION_TYPE_LABELS_FA, type SectionType } from '../content_sources/text';
import { HttpError, json, notFound } from '../utils/http';
import { newId, nowIso } from '../utils/ids';
import { rateLimit } from '../utils/ratelimit';
import { parse } from '../validation/schemas';

/** کتاب‌ها و منابع درسی. Every query filters by teacher_id: a foreign id looks exactly like a missing one (404).
 *  The UI never shows technical words; «chunk» is internal and only appears as «بخش‌های متن» counts. */

export const SOURCE_STATUS_LABELS_FA: Record<string, string> = {
  pending_file: 'در انتظار فایل', processing: 'در حال پردازش', ready: 'آماده استفاده', needs_review: 'نیاز به بررسی', needs_ocr: 'نیاز به بررسی', failed: 'خطا',
};
const FILE_TYPE_LABELS_FA: Record<string, string> = { pdf: 'PDF', docx: 'Word', txt: 'متن ساده', paste: 'متن واردشده' };
export const USABLE_STATUSES = new Set(['ready', 'needs_review']);
const MAX_JSON_BYTES = 1_500_000; // pasted book text is larger than the 512 KB limit of ordinary JSON bodies

const createSchema = z.object({
  title: z.string({ error: 'عنوان منبع الزامی است.' }).trim().min(2, 'عنوان منبع خیلی کوتاه است.').max(100, 'عنوان منبع خیلی بلند است.'),
  description: z.string().trim().max(500, 'توضیح خیلی بلند است.').optional(),
  subject: z.string().trim().max(60, 'نام درس خیلی بلند است.').optional(),
  gradeCode: z.string().refine(isGradeCode, 'پایه معتبر نیست.').optional(),
  fileType: z.enum(FILE_TYPES, { error: 'نوع منبع معتبر نیست (PDF، Word، متن ساده یا متن واردشده).' }),
  originalFileName: z.string().trim().max(200).optional(),
  text: z.string().max(1_200_000, 'متن خیلی بلند است.').optional(),
});
const updateSchema = z.object({
  title: z.string().trim().min(2, 'عنوان منبع خیلی کوتاه است.').max(100, 'عنوان منبع خیلی بلند است.').optional(),
  description: z.string().trim().max(500, 'توضیح خیلی بلند است.').nullable().optional(),
  subject: z.string().trim().max(60, 'نام درس خیلی بلند است.').nullable().optional(),
  gradeCode: z.string().refine(isGradeCode, 'پایه معتبر نیست.').nullable().optional(),
});

async function readLargeJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get('Content-Length') ?? 0);
  if (len > MAX_JSON_BYTES) throw new HttpError(413, 'payload_too_large', EXTRACT_MESSAGES_FA.too_long);
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, 'payload_too_large', EXTRACT_MESSAGES_FA.too_long);
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'bad_request', 'بدنه درخواست معتبر نیست.'); }
}

export async function getOwnedSource(db: D1Database, teacherId: string, id: string) {
  const row = await db.prepare('SELECT * FROM content_sources WHERE id = ? AND teacher_id = ?').bind(id, teacherId).first<any>();
  if (!row) throw notFound('منبع یافت نشد.');
  return row;
}

export function sourceDto(s0: any) {
  // A request that was killed half-way leaves «processing» behind forever: after a few minutes show it as failed so the teacher can send the file again.
  const stuck = s0.status === 'processing' && Date.now() - Date.parse(s0.updated_at) > STALE_PROCESSING_MS;
  const s = stuck ? { ...s0, status: 'failed', status_message: STALE_PROCESSING_MESSAGE_FA } : s0;
  return {
    id: s.id, title: s.title, description: s.description ?? null, subject: s.subject ?? null,
    gradeCode: s.grade_code ?? null, gradeLabel: gradeByCode(s.grade_code)?.label ?? null,
    fileType: s.file_type, fileTypeLabel: FILE_TYPE_LABELS_FA[s.file_type] ?? s.file_type, originalFileName: s.original_file_name ?? null,
    status: s.status, statusLabel: SOURCE_STATUS_LABELS_FA[s.status] ?? s.status, statusMessage: s.status_message ?? null, usable: USABLE_STATUSES.has(s.status),
    charCount: s.char_count, partCount: s.chunk_count, pageCount: s.page_count ?? null, createdAt: s.created_at, updatedAt: s.updated_at,
  };
}

async function loadSections(db: D1Database, sourceId: string) {
  const { results } = await db.prepare(
    `SELECT s.id, s.parent_id, s.title, s.section_type, s.order_index,
            (SELECT COUNT(*) FROM content_source_chunks c WHERE c.section_id = s.id) AS part_n,
            (SELECT COALESCE(SUM(LENGTH(c.content)), 0) FROM content_source_chunks c WHERE c.section_id = s.id) AS chars
       FROM content_source_sections s WHERE s.source_id = ? ORDER BY s.order_index`,
  ).bind(sourceId).all<any>();
  return results.map((r) => ({
    id: r.id, parentId: r.parent_id ?? null, title: r.title, type: r.section_type, typeLabel: SECTION_TYPE_LABELS_FA[r.section_type as SectionType] ?? 'متن',
    orderIndex: r.order_index, partCount: r.part_n, charCount: r.chars,
  }));
}

async function detail(env: Env, teacherId: string, id: string, status = 200, extra: Record<string, unknown> = {}) {
  const s = await getOwnedSource(env.DB, teacherId, id);
  return json({ source: sourceDto(s), sections: await loadSections(env.DB, id), ...extra }, status);
}

// ───────────────────────── CRUD ─────────────────────────

/** POST /content-sources. Pasted text, a .txt, or a PDF whose text the phone already extracted (pages joined by \f) is processed right away;
 *  a PDF / Word file itself waits for POST /:id/process. */
export async function createSource(req: Request, env: Env, teacherId: string) {
  const b = parse(createSchema, await readLargeJson(req));
  await rateLimit(env, `src-create:${teacherId}`, 30, 3600);
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM content_sources WHERE teacher_id = ?').bind(teacherId).first<{ n: number }>())?.n ?? 0;
  if (n >= LIMITS.maxSourcesPerTeacher) throw new HttpError(409, 'sources_limit', `حداکثر ${LIMITS.maxSourcesPerTeacher} منبع می‌توانید داشته باشید. ابتدا منبع‌های بی‌استفاده را حذف کنید.`);
  const hasText = !!b.text?.trim();
  if (b.fileType === 'paste' && !hasText) throw new HttpError(400, 'validation_error', 'متن منبع را وارد کنید.');
  const id = newId(), now = nowIso();
  await env.DB.prepare('INSERT INTO content_sources (id,teacher_id,title,description,subject,grade_code,file_type,original_file_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, teacherId, b.title, b.description || null, b.subject || null, b.gradeCode ?? null, b.fileType, b.originalFileName || null, 'pending_file', now, now).run();
  if (hasText && (b.fileType === 'paste' || b.fileType === 'txt' || b.fileType === 'pdf')) await processSource(env, teacherId, { id, file_type: b.fileType }, { text: b.text });
  return detail(env, teacherId, id, 201);
}

export async function listSources(_req: Request, env: Env, teacherId: string) {
  const { results } = await env.DB.prepare('SELECT * FROM content_sources WHERE teacher_id = ? ORDER BY updated_at DESC LIMIT 100').bind(teacherId).all<any>();
  return json({ sources: results.map(sourceDto), limit: LIMITS.maxSourcesPerTeacher, maxFileMegabytes: LIMITS.maxFileBytes / 1024 / 1024, maxPages: LIMITS.maxPages });
}

export async function getSource(env: Env, teacherId: string, id: string) { return detail(env, teacherId, id); }

export async function updateSource(req: Request, env: Env, teacherId: string, id: string) {
  const s = await getOwnedSource(env.DB, teacherId, id);
  const b = parse(updateSchema, await readLargeJson(req));
  await env.DB.prepare('UPDATE content_sources SET title=?, description=?, subject=?, grade_code=?, updated_at=? WHERE id=? AND teacher_id=?').bind(
    b.title ?? s.title, b.description !== undefined ? (b.description || null) : s.description, b.subject !== undefined ? (b.subject || null) : s.subject,
    b.gradeCode !== undefined ? b.gradeCode : s.grade_code, nowIso(), id, teacherId).run();
  return detail(env, teacherId, id);
}

/** Removes the source, its sections and its text. Assessments made from it stay (they are the teacher's own work): they only lose the link
 *  to the deleted book; the book title snapshot and the readable «منبع سؤال» text stay for the report. */
export async function deleteSource(env: Env, teacherId: string, id: string) {
  await getOwnedSource(env.DB, teacherId, id);
  await env.DB.batch([
    env.DB.prepare('UPDATE assessment_questions SET source_id = NULL, section_id = NULL, chunk_id = NULL WHERE source_id = ?').bind(id),
    env.DB.prepare('UPDATE assessments SET source_id = NULL WHERE source_id = ? AND teacher_id = ?').bind(id, teacherId),
    env.DB.prepare('DELETE FROM content_source_chunks WHERE source_id = ?').bind(id),
    env.DB.prepare('DELETE FROM content_source_sections WHERE source_id = ?').bind(id),
    env.DB.prepare('DELETE FROM content_sources WHERE id = ? AND teacher_id = ?').bind(id, teacherId),
  ]);
  return json({ ok: true });
}

// ───────────────────────── processing ─────────────────────────

/** POST /content-sources/:id/process — the raw file as the request body (application/octet-stream). Idempotent: a source that is already
 *  usable is returned as it is (`duplicate: true`) and a second request while one is running changes nothing. */
export async function processSourceRoute(req: Request, env: Env, teacherId: string, id: string) {
  const s = await getOwnedSource(env.DB, teacherId, id);
  if (USABLE_STATUSES.has(s.status)) return detail(env, teacherId, id, 200, { duplicate: true });
  await rateLimit(env, `src-process:${teacherId}`, 20, 3600);
  const len = Number(req.headers.get('Content-Length') ?? 0);
  if (len > LIMITS.maxFileBytes) throw new HttpError(413, 'file_too_large', EXTRACT_MESSAGES_FA.too_large);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > LIMITS.maxFileBytes) throw new HttpError(413, 'file_too_large', EXTRACT_MESSAGES_FA.too_large);
  if (!bytes.length) throw new HttpError(400, 'validation_error', 'فایل ارسال نشده است.');
  const input: ExtractInput = { bytes };
  const ran = await processSource(env, teacherId, { id, file_type: s.file_type as FileType }, input);
  if (!ran) return detail(env, teacherId, id, 200, { duplicate: true }); // another request is already processing it
  return detail(env, teacherId, id);
}

// ───────────────────────── sections ─────────────────────────

export async function listSections(env: Env, teacherId: string, id: string) {
  const s = await getOwnedSource(env.DB, teacherId, id);
  return json({ source: sourceDto(s), sections: await loadSections(env.DB, id) });
}

/** One chapter / lesson with its extracted text (for «مشاهده متن» and for picking a range by hand when the structure was uncertain). */
export async function getSection(env: Env, teacherId: string, id: string, sectionId: string) {
  await getOwnedSource(env.DB, teacherId, id);
  const sec = (await loadSections(env.DB, id)).find((x) => x.id === sectionId);
  if (!sec) throw notFound('بخش یافت نشد.');
  const { results } = await env.DB.prepare('SELECT chunk_index, content, page_number FROM content_source_chunks WHERE source_id = ? AND section_id = ? ORDER BY chunk_index LIMIT 200').bind(id, sectionId).all<any>();
  return json({ section: sec, parts: results.map((c) => ({ index: c.chunk_index, page: c.page_number ?? null, text: c.content })) });
}
