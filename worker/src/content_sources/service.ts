import type { Env } from '../env';
import { newId, nowIso } from '../utils/ids';
import { ExtractError, EXTRACT_MESSAGES_FA, extractRawText, LIMITS, STATUS_FOR_ERROR, type ExtractErrorCode, type ExtractInput, type FileType } from './extract';
import { processText } from './text';

export const NEEDS_REVIEW_MESSAGE_FA = 'فصل‌ها و درس‌های این منبع به‌طور قطعی تشخیص داده نشد. می‌توانید کل متن را انتخاب کنید یا فقط بخشی از آن را مشخص کنید.';
/** A source stuck in «processing» for longer than this (a killed request: out of CPU / memory) is reported as failed and may be sent again. */
export const STALE_PROCESSING_MS = 5 * 60_000;
export const STALE_PROCESSING_MESSAGE_FA = 'پردازش این فایل کامل نشد؛ احتمالاً برای سرور سنگین است. دوباره ارسال کنید و اگر باز هم ناموفق بود، کتاب را به چند فایل کوچک‌تر (مثلاً فصل‌به‌فصل) تقسیم کنید.';
const BATCH = 40;

async function finish(env: Env, id: string, status: string, message: string | null, counts: { chars: number; chunks: number; pages: number | null } = { chars: 0, chunks: 0, pages: null }) {
  await env.DB.prepare('UPDATE content_sources SET status=?, status_message=?, char_count=?, chunk_count=?, page_count=?, updated_at=? WHERE id=?')
    .bind(status, message, counts.chars, counts.chunks, counts.pages, nowIso(), id).run();
}

/** File → text → sections → chunks → storage. Never throws for bad input: the source ends in needs_ocr / failed with a plain Persian message.
 *  Returns false when someone else is already processing this source (a duplicate request): nothing is touched in that case.
 *  Only the extracted text is stored; `input` (the uploaded bytes) is dropped when this function returns. */
export async function processSource(env: Env, teacherId: string, source: { id: string; file_type: string }, input: ExtractInput): Promise<boolean> {
  const stale = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE content_sources SET status='processing', status_message=NULL, updated_at=?
      WHERE id=? AND teacher_id=? AND (status IN ('pending_file','failed','needs_ocr') OR (status='processing' AND updated_at < ?))`,
  ).bind(nowIso(), source.id, teacherId, stale).run();
  if (!(claim.meta.changes ?? 0)) return false;

  try {
    const raw = await extractRawText(source.file_type as FileType, input);
    const p = processText(raw);
    if (p.charCount > LIMITS.maxChars) throw new ExtractError('too_long');
    if (!p.chunks.length) throw new ExtractError(source.file_type === 'pdf' ? 'needs_ocr' : 'empty');

    const ids = p.sections.map(() => newId());
    const now = nowIso();
    const stmts = [
      env.DB.prepare('DELETE FROM content_source_chunks WHERE source_id = ?').bind(source.id),
      env.DB.prepare('DELETE FROM content_source_sections WHERE source_id = ?').bind(source.id),
      ...p.sections.map((s, i) => env.DB.prepare('INSERT INTO content_source_sections (id,source_id,parent_id,title,section_type,order_index) VALUES (?,?,?,?,?,?)')
        .bind(ids[i], source.id, s.parentIndex === null ? null : ids[s.parentIndex], s.title, s.type, i + 1)),
      ...p.chunks.map((c, i) => env.DB.prepare('INSERT INTO content_source_chunks (id,source_id,section_id,chunk_index,content,page_number,metadata,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(newId(), source.id, ids[c.sectionIndex], i + 1, c.content, c.page, JSON.stringify({ chars: c.content.length }), now)),
    ];
    for (let i = 0; i < stmts.length; i += BATCH) await env.DB.batch(stmts.slice(i, i + BATCH));
    await finish(env, source.id, p.confident ? 'ready' : 'needs_review', p.confident ? null : NEEDS_REVIEW_MESSAGE_FA, { chars: p.charCount, chunks: p.chunks.length, pages: p.pageCount });
  } catch (e) {
    const code: ExtractErrorCode = e instanceof ExtractError ? e.code : 'unreadable';
    if (!(e instanceof ExtractError)) console.error(JSON.stringify({ level: 'error', where: 'content-source-process', message: e instanceof Error ? e.message : String(e) })); // no text, no ids of people
    await env.DB.batch([
      env.DB.prepare('DELETE FROM content_source_chunks WHERE source_id = ?').bind(source.id),
      env.DB.prepare('DELETE FROM content_source_sections WHERE source_id = ?').bind(source.id),
    ]);
    await finish(env, source.id, STATUS_FOR_ERROR[code], EXTRACT_MESSAGES_FA[code]);
  }
  return true;
}
