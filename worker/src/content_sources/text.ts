/** Content Sources (کتاب‌ها و منابع درسی): pure text pipeline. No I/O, no AI, no book-specific rules.
 *  raw text → normalize → lines (+ page numbers) → section detection → chunks.
 *  Page breaks arrive from extractors as a form-feed character (\f); text without them simply has no page numbers. */

export const SECTION_TYPES = ['chapter', 'lesson', 'section', 'exercise', 'summary', 'other'] as const;
export type SectionType = (typeof SECTION_TYPES)[number];
export const SECTION_TYPE_LABELS_FA: Record<SectionType, string> = { chapter: 'فصل', lesson: 'درس', section: 'بخش', exercise: 'تمرین', summary: 'خلاصه', other: 'متن' };

/** Upper bound of one chunk. A chunk is the unit that is sent to the AI, so it stays small and focused. */
export const MAX_CHUNK_CHARS = 1200;

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const toLatinDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
export const toPersianDigits = (s: string | number) => String(s).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

/** Persian-aware cleanup. Keeps digits, diacritics (needed for Quran books) and page breaks; fixes only typing/encoding noise. */
export function normalizeSourceText(raw: string): string {
  return raw
    .normalize('NFKC')                                           // Arabic presentation forms (common in PDFs) → plain letters
    .replace(/\r\n?/g, '\n')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/\u0640/g, '')                                      // tatweel
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000\t]/g, ' ')
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '') // invisible bidi / BOM marks
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '')    // control chars (\n and \f stay)
    .replace(/\u200c{2,}/g, '\u200c')
    .replace(/\u200c(?= )|(?<= )\u200c/g, '')                    // half-space next to a real space is noise
    .replace(/^\u200c+|\u200c+$/gm, '')
    .replace(/ {2,}/g, ' ')
    .replace(/ *\n */g, '\n').replace(/ *\f */g, '\f')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface SrcLine { text: string; page: number | null }

/** Splits normalized text into lines and tags each with its page (null when the text has no page breaks). */
export function toLines(normalized: string): SrcLine[] {
  const hasPages = normalized.includes('\f');
  const out: SrcLine[] = [];
  let page = 1;
  for (const pageText of normalized.split('\f')) {
    for (const l of pageText.split('\n')) out.push({ text: l.trim(), page: hasPages ? page : null });
    page++;
  }
  return out;
}

const ORD = '(?:اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|یازدهم|دوازدهم|سیزدهم|چهاردهم|پانزدهم|شانزدهم|هفدهم|هجدهم|نوزدهم|بیستم|\\d+)';
const END = '(?=$|[\\s:\\-–—.،])';
const RULES: { type: SectionType; re: RegExp; maxLen: number }[] = [
  { type: 'chapter', re: new RegExp(`^فصل\\s*${ORD}${END}`), maxLen: 90 },
  { type: 'lesson', re: new RegExp(`^درس\\s*${ORD}${END}`), maxLen: 90 },
  { type: 'section', re: new RegExp(`^بخش\\s*${ORD}${END}`), maxLen: 90 },
  { type: 'section', re: /^\d{1,2}\s*[-–]\s*\d{1,2}(?:\s*[-–]\s*\d{1,2})?(?:\s+\S|$)/, maxLen: 70 },
  { type: 'exercise', re: new RegExp(`^(?:تمرین(?:\\s*ها)?|تمرینات|کار\\s*در\\s*کلاس|کاردرکلاس|فعالیت|مسئله|مساله|مسأله)${END}`), maxLen: 40 },
  { type: 'summary', re: new RegExp(`^(?:خلاصه(?:\\s+(?:فصل|درس))?|جمع\\s*بندی(?:\\s+فصل)?)${END}`), maxLen: 40 },
];

/** Heading type of one line, or null. Conservative: a heading is short, starts with the keyword and is not a sentence. */
export function headingType(line: string): SectionType | null {
  const t = line.trim();
  if (!t || /[.؟!]$/.test(t)) return null;
  const m = toLatinDigits(t);
  for (const r of RULES) if (m.length <= r.maxLen && r.re.test(m)) return r.type;
  return null;
}

export interface DetectedSection { title: string; type: SectionType; parentIndex: number | null; lines: SrcLine[] }
export interface Detection { sections: DetectedSection[]; confident: boolean }

/** Finds chapters / lessons / sections by their usual headings, for any book. Without a trustworthy structure the whole text
 *  becomes one section and `confident` is false, so the teacher can pick a range by hand. */
export function detectSections(lines: SrcLine[]): Detection {
  const sections: DetectedSection[] = [];
  let chapter: number | null = null, found = 0;
  let current: DetectedSection | null = null;
  const preface: SrcLine[] = [];
  for (const ln of lines) {
    const type = headingType(ln.text);
    if (type) {
      if (type === 'chapter' || type === 'lesson' || type === 'section') found++;
      current = { title: ln.text.slice(0, 120), type, parentIndex: type === 'chapter' ? null : chapter, lines: [] };
      sections.push(current);
      if (type === 'chapter') chapter = sections.length - 1;
    } else if (current) current.lines.push(ln);
    else preface.push(ln);
  }
  if (!found) {
    const any = lines.some((l) => l.text);
    return { sections: any ? [{ title: 'کل متن', type: 'other', parentIndex: null, lines }] : [], confident: false };
  }
  if (preface.some((l) => l.text)) {
    // everything before the first heading is kept as the first section; parent indices shift by one
    for (const s of sections) if (s.parentIndex !== null) s.parentIndex += 1;
    sections.unshift({ title: 'ابتدای منبع', type: 'other', parentIndex: null, lines: preface });
  }
  return { sections, confident: true };
}

export interface DetectedChunk { sectionIndex: number; content: string; page: number | null }

const SENTENCE_SPLIT = /(?<=[.!?؟؛۔…])\s+/;

/** Splits the text of every section into chunks of at most `max` chars, never across sections, keeping the start page. */
export function chunkSections(sections: DetectedSection[], max = MAX_CHUNK_CHARS): DetectedChunk[] {
  const out: DetectedChunk[] = [];
  sections.forEach((sec, sectionIndex) => {
    // paragraphs: consecutive non-empty lines; a blank line ends one
    const paras: { text: string; page: number | null }[] = [];
    let buf: string[] = [], bufPage: number | null = null;
    const flush = () => { if (buf.length) paras.push({ text: buf.join(' '), page: bufPage }); buf = []; };
    for (const l of sec.lines) {
      if (!l.text) { flush(); continue; }
      if (buf.length && l.page !== bufPage) flush(); // a paragraph never crosses a page break: every chunk then belongs to ONE exact page
      if (!buf.length) bufPage = l.page;
      buf.push(l.text);
    }
    flush();
    let cur = '', curPage: number | null = null;
    const push = () => { if (cur.trim()) out.push({ sectionIndex, content: cur.trim(), page: curPage }); cur = ''; curPage = null; };
    const add = (piece: string, page: number | null) => {
      if (cur && (cur.length + piece.length + 1 > max || page !== curPage)) push();
      if (!cur) curPage = page;
      cur += (cur ? '\n' : '') + piece;
    };
    for (const p of paras) {
      if (p.text.length <= max) { add(p.text, p.page); continue; }
      for (const s of p.text.split(SENTENCE_SPLIT)) {
        // a single "sentence" can still be huge (no punctuation): hard-cut on a space near the limit
        let rest = s;
        while (rest.length > max) {
          let cut = rest.lastIndexOf(' ', max);
          if (cut < max / 2) cut = max;
          add(rest.slice(0, cut).trim(), p.page);
          rest = rest.slice(cut).trim();
        }
        if (rest) add(rest, p.page);
      }
    }
    push();
  });
  return out;
}

export interface ProcessedText { sections: DetectedSection[]; chunks: DetectedChunk[]; charCount: number; pageCount: number | null; confident: boolean }

/** The whole pure pipeline. `charCount` counts the normalized text without page breaks. */
export function processText(raw: string): ProcessedText {
  const normalized = normalizeSourceText(raw);
  const lines = toLines(normalized);
  const { sections, confident } = detectSections(lines);
  const chunks = chunkSections(sections);
  const pages = lines.reduce<number | null>((m, l) => (l.page === null ? m : Math.max(m ?? 0, l.page)), null);
  return { sections, chunks, charCount: normalized.replace(/\f/g, '').length, pageCount: pages, confident };
}

const shortTitle = (t: string) => t.split(/\s*[:–—]\s*|\s+-\s+/)[0].trim();

/** Human-readable origin of a question, built ONLY from stored section titles and a real page number. */
export function sourceReferenceLabel(opts: { parentTitle?: string | null; title: string; page?: number | null }): string {
  const parts = [opts.parentTitle ? shortTitle(opts.parentTitle) : null, shortTitle(opts.title)].filter((x): x is string => !!x);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.join('، ') + (opts.page ? `، صفحه ${toPersianDigits(opts.page)}` : '');
}
