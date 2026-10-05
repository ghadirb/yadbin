import { extractDocxText } from './docx';

/** V1 limits (documented in docs/content-sources.md). Bigger books: import chapter by chapter. */
export const LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxPages: 300,
  maxChars: 400_000,
  maxSourcesPerTeacher: 30,
  /** a PDF whose pages carry fewer characters than this on average has no usable text layer (scan) */
  minCharsPerPage: 25,
} as const;

export const FILE_TYPES = ['pdf', 'docx', 'txt', 'paste'] as const;
export type FileType = (typeof FILE_TYPES)[number];

export type ExtractErrorCode = 'needs_ocr' | 'unreadable' | 'empty' | 'too_large' | 'too_many_pages' | 'too_long';
/** Which status a failed extraction leaves the source in. needs_ocr is its own state so OCR can be added later without a schema change. */
export const STATUS_FOR_ERROR: Record<ExtractErrorCode, 'needs_ocr' | 'failed'> = { needs_ocr: 'needs_ocr', unreadable: 'failed', empty: 'failed', too_large: 'failed', too_many_pages: 'failed', too_long: 'failed' };

export const EXTRACT_MESSAGES_FA: Record<ExtractErrorCode, string> = {
  needs_ocr: 'این فایل احتمالاً اسکن‌شده است و متن قابل استخراج ندارد. در حال حاضر یک PDF متنی یا متن کتاب را وارد کنید.',
  unreadable: 'فایل خوانده نشد؛ ممکن است آسیب‌دیده، رمزدار یا از نوع پشتیبانی‌نشده باشد. فایل دیگری را امتحان کنید یا متن را وارد کنید.',
  empty: 'در این منبع متنی پیدا نشد.',
  too_large: 'حجم فایل از حد مجاز (۲۰ مگابایت) بیشتر است. فصل‌های موردنظر را جداگانه وارد کنید.',
  too_many_pages: 'تعداد صفحات از حد مجاز (۳۰۰ صفحه) بیشتر است. فصل‌های موردنظر را جداگانه وارد کنید.',
  too_long: 'حجم متن از حد مجاز (۴۰۰ هزار نویسه) بیشتر است. فصل‌های موردنظر را جداگانه وارد کنید.',
};

export class ExtractError extends Error {
  constructor(public code: ExtractErrorCode) { super(EXTRACT_MESSAGES_FA[code]); }
}

/** Private-use / replacement characters are what broken PDF fonts turn into: the text is unusable even if it is "there". */
export function looksGarbled(text: string): boolean {
  const visible = text.replace(/\s/g, '');
  if (visible.length < 40) return false;
  const bad = (visible.match(/[\uE000-\uF8FF\uFFFD]/g) ?? []).length;
  return bad / visible.length > 0.08;
}

/** Persian text taken from a PDF in VISUAL order comes out letter-reversed («که» → «هک»). The most frequent short Persian words give it away:
 *  when their mirrored forms outnumber the real ones the text is unusable and the page images must be read by the vision model instead. */
const FA_COMMON = ['که', 'در', 'از', 'را', 'این', 'با', 'به', 'است', 'های', 'می'];
export function looksReversedPersian(text: string): boolean {
  const words = text.normalize('NFKC').replace(/[\u200c\u200d]/g, ' ').split(/[^\u0600-\u06FF]+/).filter(Boolean);
  if (words.length < 40) return false;
  const fwd = new Set(FA_COMMON), rev = new Set(FA_COMMON.map((w) => [...w].reverse().join('')));
  let f = 0, r = 0;
  for (const w of words) { if (fwd.has(w)) f++; else if (rev.has(w)) r++; }
  return r >= 8 && r > f * 1.5;
}

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if ((utf8.match(/\uFFFD/g) ?? []).length / Math.max(1, utf8.length) < 0.01) return utf8;
  try { return new TextDecoder('windows-1256').decode(bytes); } catch { return utf8; } // old Persian text files
}

const isPdf = (b: Uint8Array) => new TextDecoder('latin1').decode(b.subarray(0, 1024)).includes('%PDF-');
const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

/** Pages of a text PDF. unpdf (pdf.js for serverless) is loaded lazily, so nothing else pays for it. */
async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  let pages: string[];
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    if (pdf.numPages > LIMITS.maxPages) throw new ExtractError('too_many_pages');
    const r = await extractText(pdf, { mergePages: false });
    pages = Array.isArray(r.text) ? r.text : [r.text];
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    throw new ExtractError('unreadable'); // invalid structure, password, unsupported features
  }
  return pages;
}

/** `text` for a PDF = pages already read ON THE PHONE (joined by \f); the Worker then does no PDF parsing at all. */
export interface ExtractInput { text?: string; bytes?: Uint8Array }

/** Raw text of a source. Page breaks are marked with \f so the pipeline can keep page numbers. Throws ExtractError (never crashes). */
export async function extractRawText(fileType: FileType, input: ExtractInput): Promise<string> {
  let text: string;
  if (fileType === 'paste' || fileType === 'txt') {
    text = input.text ?? (input.bytes ? decodeText(input.bytes) : '');
  } else if (fileType === 'pdf' && input.text !== undefined) {
    // Text extracted on the device (PdfBox) or read from page images by the vision model: same quality gates as a server-side PDF read.
    text = input.text;
    const pages = text.split('\f');
    if (pages.length > LIMITS.maxPages) throw new ExtractError('too_many_pages');
    const chars = text.replace(/\s/g, '').length;
    if (!chars) throw new ExtractError('needs_ocr');
    if (chars < LIMITS.minCharsPerPage * Math.max(1, pages.length) || looksGarbled(text) || looksReversedPersian(text)) throw new ExtractError('needs_ocr');
  } else {
    const bytes = input.bytes;
    if (!bytes || !bytes.length) throw new ExtractError('empty');
    if (bytes.length > LIMITS.maxFileBytes) throw new ExtractError('too_large');
    if (fileType === 'docx') {
      if (!isZip(bytes)) throw new ExtractError('unreadable');
      try { text = await extractDocxText(bytes); } catch { throw new ExtractError('unreadable'); }
    } else {
      if (!isPdf(bytes)) throw new ExtractError('unreadable');
      const pages = await pdfPages(bytes);
      text = pages.join('\f');
      const chars = text.replace(/\s/g, '').length;
      if (chars < LIMITS.minCharsPerPage * Math.max(1, pages.length) || looksGarbled(text) || looksReversedPersian(text)) throw new ExtractError('needs_ocr');
    }
  }
  if (!text.replace(/[\s\f]/g, '')) throw new ExtractError(fileType === 'pdf' ? 'needs_ocr' : 'empty');
  if (text.length > LIMITS.maxChars * 1.5) throw new ExtractError('too_long');
  return text;
}
