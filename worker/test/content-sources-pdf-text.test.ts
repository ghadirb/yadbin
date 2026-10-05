import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEnv, registerTeacher, type TestEnv } from './helpers';
import { ExtractError, extractRawText, looksReversedPersian } from '../src/content_sources/extract';
import { parseVisionPages, readPages, VISION } from '../src/ai/source-vision';

/** PDF text read ON THE PHONE (PdfBox) or from page IMAGES (vision model): the Worker never parses the PDF itself, so the free-plan CPU limit is no longer a problem. */

let t: TestEnv;
beforeAll(async () => { t = await createEnv(); }, 60_000);
afterAll(async () => { await t.dispose(); });

const LINE = (i: number) => `علی ${10 + i} مداد دارد و ${20 + i} دفتر دیگر می‌خرد، پس در مجموع ${30 + i} وسیله از این کتاب خواهد داشت.`;
const page = (n: number, from: number) => [`فصل ${n}: عدد`, ...Array.from({ length: 8 }, (_, i) => LINE(from + i))].join('\n');
const PAGES = [page(1, 0), page(2, 8), page(3, 16)].join('\f');
const reverse = (s: string) => s.split('\n').map((l) => [...l].reverse().join('')).join('\n');
const jpegB64 = 'A'.repeat(400); // shape-valid placeholder: the fake provider never decodes it

const asReq = (body: unknown) => new Request('http://x/api/content-sources/read-pages', { method: 'POST', body: JSON.stringify(body) });
async function call(tc: { id: string }, body: unknown, reply: string | null) {
  try {
    const res = await readPages(asReq(body), { DB: t.db } as any, tc.id, async () => reply);
    return { status: res.status, data: (await res.json()) as any };
  } catch (e: any) { return { status: e.status as number, data: { error: e.code, message: e.message } as any }; }
}
const expireTrial = (id: string) => t.db.prepare('UPDATE teachers SET trial_expires_at = ? WHERE id = ?').bind(new Date(Date.now() - 86400_000).toISOString(), id).run();
const aiUsed = async (id: string) => (await t.db.prepare("SELECT count FROM usage_counters WHERE teacher_id = ? AND feature = 'ai'").bind(id).first<{ count: number }>())?.count ?? 0;

describe('PDF text extracted on the device', () => {
  it('a pdf source with its text is processed in the same request, keeps page numbers and needs no PDF parsing in the Worker', async () => {
    const tc = await registerTeacher(t);
    const r = await t.api('POST', '/api/content-sources', { title: 'ریاضی دوم', fileType: 'pdf', originalFileName: 'riazi2.pdf', text: PAGES }, tc.token);
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data.source.fileType).toBe('pdf');
    expect(['ready', 'needs_review']).toContain(r.data.source.status);
    expect(r.data.source.pageCount).toBe(3);
    const pages = await t.db.prepare('SELECT DISTINCT page_number AS p FROM content_source_chunks WHERE source_id = ? ORDER BY p').bind(r.data.source.id).all<{ p: number }>();
    expect(pages.results.map((x) => x.p)).toEqual([1, 2, 3]);
  });

  it('resend: POST /:id/process with JSON {text} reads a pdf source from phone text (no file bytes, no PDF parsing in the Worker)', async () => {
    const tc = await registerTeacher(t);
    const a = await t.api('POST', '/api/content-sources', { title: 'ارسال دوباره', fileType: 'pdf', originalFileName: 'riazi2.pdf' }, tc.token);
    expect(a.data.source.status).toBe('pending_file');
    const r = await t.api('POST', `/api/content-sources/${a.data.source.id}/process`, { text: PAGES }, tc.token);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(['ready', 'needs_review']).toContain(r.data.source.status);
    expect(r.data.source.pageCount).toBe(3);
  });

  it('a pdf without text (scan) still waits for a file; an empty-text pdf ends as needs_ocr, not as a crash', async () => {
    const tc = await registerTeacher(t);
    const a = await t.api('POST', '/api/content-sources', { title: 'اسکن', fileType: 'pdf' }, tc.token);
    expect(a.data.source.status).toBe('pending_file');
    const b = await t.api('POST', '/api/content-sources', { title: 'اسکن ۲', fileType: 'pdf', text: 'ab\fcd\fef' }, tc.token);
    expect(b.status).toBe(201);
    expect(b.data.source.status).toBe('needs_ocr');
    expect(b.data.source.usable).toBe(false);
  });

  it('letter-reversed Persian (visual order) is detected and sent to the image reader instead of being stored as garbage', async () => {
    expect(looksReversedPersian(PAGES)).toBe(false);
    expect(looksReversedPersian(reverse(PAGES))).toBe(true);
    await expect(extractRawText('pdf', { text: reverse(PAGES) })).rejects.toMatchObject({ code: 'needs_ocr' });
    const tc = await registerTeacher(t);
    const r = await t.api('POST', '/api/content-sources', { title: 'وارونه', fileType: 'pdf', text: reverse(PAGES) }, tc.token);
    expect(r.data.source.status).toBe('needs_ocr');
    expect(await t.db.prepare('SELECT COUNT(*) AS n FROM content_source_chunks WHERE source_id = ?').bind(r.data.source.id).first<{ n: number }>()).toMatchObject({ n: 0 });
  });

  it('too many pages and sparse pages are refused with the usual codes', async () => {
    await expect(extractRawText('pdf', { text: Array.from({ length: 301 }, () => 'متن').join('\f') })).rejects.toBeInstanceOf(ExtractError);
    await expect(extractRawText('pdf', { text: ['کم', 'کم', 'کم'].join('\f') })).rejects.toMatchObject({ code: 'needs_ocr' });
  });
});

const makePro = (id: string) => t.db.prepare("INSERT INTO subscriptions (id, teacher_id, plan_id, status, started_at, expires_at, created_at, updated_at) VALUES (?, ?, 'pro_monthly', 'active', ?, ?, ?, ?)")
  .bind(`sub-${id}`, id, new Date().toISOString(), new Date(Date.now() + 30 * 86400_000).toISOString(), new Date().toISOString(), new Date().toISOString()).run();
const ocrUsed = async (id: string) => (await t.db.prepare("SELECT count FROM usage_counters WHERE teacher_id = ? AND feature = 'ocr_pages'").bind(id).first<{ count: number }>())?.count ?? 0;
const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);

describe('reading page images with the vision model (paid feature, per-page quota, cache)', () => {
  it('Pro: turns N images into exactly N cleaned pages and counts N pages (not one use per book)', async () => {
    const tc = await registerTeacher(t);
    await makePro(tc.id);
    const reply = '```json\n{"pages":["فصل اول\\nمتن صفحه ۱\\u0007","  متن صفحه ۲ "]}\n```';
    const r = await call(tc, { images: [jpegB64, jpegB64] }, reply);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.pages).toEqual(['فصل اول\nمتن صفحه ۱', 'متن صفحه ۲']);
    expect(r.data.charged).toBe(2);
    expect(await ocrUsed(tc.id)).toBe(2);
    await call(tc, { images: [jpegB64, jpegB64] }, reply);
    expect(await ocrUsed(tc.id)).toBe(4);
    expect(await aiUsed(tc.id)).toBe(0); // the old per-book AI counter is untouched
  });

  it('Free, Trial and expired accounts cannot use the image reader at all and nothing reaches the model', async () => {
    const trial = await registerTeacher(t); // a brand-new account is on the 7-day Trial
    const expired = await registerTeacher(t);
    await expireTrial(expired.id);
    for (const tc of [trial, expired]) {
      let called = false;
      try { await readPages(asReq({ images: [jpegB64] }), { DB: t.db } as any, tc.id, async () => { called = true; return '{"pages":["x"]}'; }); expect.unreachable(); }
      catch (e: any) { expect(e.status).toBe(403); expect(e.code).toBe('FEATURE_LIMIT_REACHED'); expect((e.extra as any)?.feature).toBe('ocr'); expect(e.message).toContain('اشتراک'); }
      expect(called).toBe(false);
      expect(await ocrUsed(tc.id)).toBe(0);
    }
    const look = await t.api('POST', '/api/content-sources/read-pages/cache', { fileHash: HASH, pageNumbers: [1] }, trial.token);
    expect(look.status).toBe(403);
  });

  it('the monthly page budget is enforced per page: a batch that does not fit is refused before the model is called', async () => {
    const tc = await registerTeacher(t);
    await makePro(tc.id);
    await t.db.prepare("INSERT INTO usage_counters (teacher_id, feature, period, count) VALUES (?, 'ocr_pages', ?, 399)").bind(tc.id, new Date().toISOString().slice(0, 7)).run();
    let called = false;
    try { await readPages(asReq({ images: [jpegB64, jpegB64] }), { DB: t.db } as any, tc.id, async () => { called = true; return '{"pages":["a","b"]}'; }); expect.unreachable(); }
    catch (e: any) { expect(e.status).toBe(403); expect(e.extra).toMatchObject({ feature: 'ocr', remaining: 1, limit: 400 }); }
    expect(called).toBe(false);
    const one = await call(tc, { images: [jpegB64] }, '{"pages":["آخرین صفحه"]}');
    expect(one.status).toBe(200);
    expect(await ocrUsed(tc.id)).toBe(400);
  });

  it('cache: pages of the same file are read once, then served free to the same or another Pro teacher', async () => {
    const a = await registerTeacher(t); const b = await registerTeacher(t);
    await makePro(a.id); await makePro(b.id);
    const first = await call(a, { images: [jpegB64, jpegB64], fileHash: HASH, pageNumbers: [5, 6] }, '{"pages":["متن پنج","متن شش"]}');
    expect(first.data.charged).toBe(2);
    expect(first.data.fromCache).toEqual([false, false]);
    // another teacher, same file: pages 5 and 6 cached, 7 is new → the model only gets ONE image
    let sent = 0;
    const res = await readPages(asReq({ images: [jpegB64, jpegB64, jpegB64], fileHash: HASH, pageNumbers: [5, 6, 7] }), { DB: t.db } as any, b.id, async (_e, imgs) => { sent = imgs.length; return '{"pages":["متن هفت"]}'; });
    const d: any = await res.json();
    expect(sent).toBe(1);
    expect(d.pages).toEqual(['متن پنج', 'متن شش', 'متن هفت']);
    expect(d.fromCache).toEqual([true, true, false]);
    expect(d.charged).toBe(1);
    expect(await ocrUsed(b.id)).toBe(1);
    // everything cached → the model is not called at all and nothing is charged
    let called = false;
    const all: any = await (await readPages(asReq({ images: [jpegB64], fileHash: HASH, pageNumbers: [5] }), { DB: t.db } as any, b.id, async () => { called = true; return null; })).json();
    expect(called).toBe(false); expect(all.pages).toEqual(['متن پنج']); expect(all.charged).toBe(0);
    // a different file never hits the cache
    const other = await call(b, { images: [jpegB64], fileHash: HASH2, pageNumbers: [5] }, '{"pages":["کتاب دیگر"]}');
    expect(other.data.pages).toEqual(['کتاب دیگر']);
  });

  it('cache lookup returns only the requested pages of that exact file hash', async () => {
    const a = await registerTeacher(t);
    await makePro(a.id);
    await call(a, { images: [jpegB64, jpegB64], fileHash: 'c'.repeat(64), pageNumbers: [1, 2] }, '{"pages":["یک","دو"]}');
    const r = await t.api('POST', '/api/content-sources/read-pages/cache', { fileHash: 'c'.repeat(64), pageNumbers: [1, 2, 3] }, a.token);
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.pages).toEqual({ '1': 'یک', '2': 'دو' });
    const wrong = await t.api('POST', '/api/content-sources/read-pages/cache', { fileHash: 'd'.repeat(64), pageNumbers: [1] }, a.token);
    expect(wrong.data.pages).toEqual({});
    expect((await t.api('POST', '/api/content-sources/read-pages/cache', { fileHash: 'xyz', pageNumbers: [1] }, a.token)).status).toBe(400);
  });

  it('a mismatched fileHash/pageNumbers pair is rejected', async () => {
    const tc = await registerTeacher(t);
    await makePro(tc.id);
    expect((await call(tc, { images: [jpegB64, jpegB64], fileHash: HASH, pageNumbers: [1] }, '{"pages":["a","b"]}')).status).toBe(400);
    expect((await call(tc, { images: [jpegB64], fileHash: HASH }, '{"pages":["a"]}')).status).toBe(400);
  });

  it('GET /api/subscription reports the image-reading quota (disabled for Trial, 400 pages for Pro)', async () => {
    const trial = await registerTeacher(t);
    const pro = await registerTeacher(t); await makePro(pro.id);
    const a = await t.api('GET', '/api/subscription', undefined, trial.token);
    expect(a.data.ocr).toMatchObject({ enabled: false, limit: 0, remaining: 0 });
    const b = await t.api('GET', '/api/subscription', undefined, pro.token);
    expect(b.data.ocr).toMatchObject({ enabled: true, limit: 400, used: 0, remaining: 400 });
  });

  it('rejects junk input, too many images, a wrong page count from the model and a missing provider — nothing is counted', async () => {
    const tc = await registerTeacher(t);
    await makePro(tc.id);
    expect((await call(tc, {}, '{"pages":[]}')).status).toBe(400);
    expect((await call(tc, { images: ['<script>'.padEnd(200, 'x')] }, '{"pages":["a"]}')).status).toBe(400);
    expect((await call(tc, { images: Array(VISION.maxImages + 1).fill(jpegB64) }, '{"pages":[]}')).status).toBe(400);
    const bad = await call(tc, { images: [jpegB64, jpegB64] }, '{"pages":["only one"]}');
    expect(bad.status).toBe(502); expect(bad.data.message).toContain('دوباره');
    const none = await call(tc, { images: [jpegB64] }, null);
    expect(none.status).toBe(503); expect(none.data.error).toBe('ai_unavailable');
    expect(await ocrUsed(tc.id)).toBe(0);
  });

  it('is login-only, and answers 503 (not a crash) for a Pro teacher when no AvalAI key is configured', async () => {
    expect((await t.api('POST', '/api/content-sources/read-pages', { images: [jpegB64] })).status).toBe(401);
    const tc = await registerTeacher(t);
    await makePro(tc.id);
    const r = await t.api('POST', '/api/content-sources/read-pages', { images: [jpegB64] }, tc.token);
    expect(r.status).toBe(503);
  });

  it('parseVisionPages never trusts a reply with a wrong shape', () => {
    expect(parseVisionPages('{"pages":["a","b"]}', 2)).toEqual(['a', 'b']);
    expect(parseVisionPages('{"pages":["a"]}', 2)).toBeNull();
    expect(parseVisionPages('{"pages":[1,2]}', 2)).toBeNull();
    expect(parseVisionPages('not json', 1)).toBeNull();
    expect(parseVisionPages(`{"pages":["${'x'.repeat(9000)}"]}`, 1)![0]).toHaveLength(VISION.maxPageChars);
  });

  it('the OCR result then becomes a normal source through the same text path', async () => {
    const tc = await registerTeacher(t);
    const r = await t.api('POST', '/api/content-sources', { title: 'کتاب اسکن‌شده', fileType: 'pdf', text: PAGES }, tc.token);
    expect(r.status).toBe(201);
    expect(r.data.source.usable).toBe(true);
  });
});
