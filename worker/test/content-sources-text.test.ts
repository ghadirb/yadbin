import { describe, expect, it } from 'vitest';
import { chunkSections, detectSections, headingType, MAX_CHUNK_CHARS, normalizeSourceText, processText, sourceReferenceLabel, toLines } from '../src/content_sources/text';

const BOOK = `ریاضی ششم

فصل اول: عدد و الگوهای عددی
درس ۱: الگوهای عددی
در این درس با الگوهای عددی آشنا می‌شویم. هر الگو از یک قاعده پیروی می‌کند.
برای مثال دنبالهٔ ۲، ۴، ۶، ۸ یک الگوی عددی است.

درس ۲: ضرب و تقسیم
ضرب یعنی جمع مکرر. برای مثال ۳ × ۴ یعنی چهار بار جمع عدد سه.
تمرین
حاصل ۵ × ۶ را به‌دست آورید.
خلاصه فصل
الگو، قاعده و ضرب را یاد گرفتیم.

فصل دوم: کسر
درس اول: مفهوم کسر
کسر نشان‌دهندهٔ بخشی از یک کل است.`;

describe('normalizeSourceText', () => {
  it('unifies Arabic letters, drops noise, keeps digits and page breaks', () => {
    expect(normalizeSourceText('كتاب  يك\u0640')).toBe('کتاب یک');
    expect(normalizeSourceText('می\u200c خواهم')).toBe('می خواهم');
    expect(normalizeSourceText('می\u200cخواهم')).toBe('می\u200cخواهم');   // a real half-space between letters stays
    expect(normalizeSourceText('صفحه ۱\f\n\nصفحه ۲')).toContain('\f');
    expect(normalizeSourceText('عدد ۱۲ و ٣٤')).toBe('عدد ۱۲ و ٣٤');         // digits are not rewritten
    expect(normalizeSourceText('a\n\n\n\n\nb')).toBe('a\n\nb');
    expect(normalizeSourceText('ﻣﺪرﺳﻪ')).toBe('مدرسه');                       // presentation forms from PDFs
  });
});

describe('headingType', () => {
  it('recognises the usual headings of any book', () => {
    expect(headingType('فصل اول')).toBe('chapter');
    expect(headingType('فصل ۲: کسر')).toBe('chapter');
    expect(headingType('درس ۱')).toBe('lesson');
    expect(headingType('درس دوم: ضرب')).toBe('lesson');
    expect(headingType('بخش اول')).toBe('section');
    expect(headingType('۱-۱ جمع اعداد')).toBe('section');
    expect(headingType('تمرین')).toBe('exercise');
    expect(headingType('کار در کلاس')).toBe('exercise');
    expect(headingType('خلاصه فصل')).toBe('summary');
  });
  it('does not mistake ordinary sentences for headings', () => {
    for (const s of ['درس اول را بخوانید.', 'در این فصل می‌خوانیم', '۱۲.۵ کیلوگرم', 'فعالیت‌های بدنی برای سلامت مفید است و باید هر روز انجام شود', '', 'تمرین کنید.']) expect(headingType(s), s).toBeNull();
  });
});

describe('detectSections', () => {
  it('builds chapter → lesson hierarchy', () => {
    const d = detectSections(toLines(normalizeSourceText(BOOK)));
    expect(d.confident).toBe(true);
    const titles = d.sections.map((s) => [s.type, s.title]);
    expect(titles[0]).toEqual(['other', 'ابتدای منبع']);
    expect(d.sections.filter((s) => s.type === 'chapter')).toHaveLength(2);
    const ch1 = d.sections.findIndex((s) => s.title.startsWith('فصل اول'));
    const l2 = d.sections.find((s) => s.title.startsWith('درس ۲'))!;
    expect(l2.parentIndex).toBe(ch1);
    const ch2 = d.sections.findIndex((s) => s.title.startsWith('فصل دوم'));
    expect(d.sections.find((s) => s.title.startsWith('درس اول'))!.parentIndex).toBe(ch2);
    expect(d.sections.find((s) => s.type === 'exercise')!.lines.some((l) => l.text.includes('۵ × ۶'))).toBe(true);
  });
  it('without a recognisable structure the whole text is one section and confidence is false', () => {
    const d = detectSections(toLines(normalizeSourceText('یک متن ساده بدون هیچ عنوان.\nخط دوم.')));
    expect(d.confident).toBe(false);
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0].title).toBe('کل متن');
    expect(detectSections(toLines('')).sections).toHaveLength(0);
  });
});

describe('chunking', () => {
  it('keeps chunks small, inside their section, and loses no text', () => {
    const p = processText(BOOK);
    expect(p.chunks.length).toBeGreaterThan(3);
    for (const c of p.chunks) expect(c.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    const lesson = p.sections.findIndex((s) => s.title.startsWith('درس ۱'));
    expect(p.chunks.filter((c) => c.sectionIndex === lesson).map((c) => c.content).join('\n')).toContain('الگوی عددی');
    expect(p.chunks.filter((c) => c.sectionIndex === lesson).map((c) => c.content).join('\n')).not.toContain('ضرب یعنی');
    expect(p.pageCount).toBeNull();                 // pasted text has no page numbers
    expect(p.confident).toBe(true);
  });
  it('splits one huge paragraph and still loses nothing', () => {
    const sentence = 'این یک جملهٔ آزمایشی برای بخش‌بندی متن طولانی است. ';
    const big = sentence.repeat(200).trim();
    const chunks = chunkSections([{ title: 'کل متن', type: 'other', parentIndex: null, lines: [{ text: big, page: null }] }]);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    expect(chunks.map((c) => c.content).join(' ').replace(/\s+/g, ' ')).toBe(big);
    const noSpaces = 'الف'.repeat(5000);                       // no space, no punctuation: hard cut
    const hard = chunkSections([{ title: 't', type: 'other', parentIndex: null, lines: [{ text: noSpaces, page: null }] }]);
    expect(hard.every((c) => c.content.length <= MAX_CHUNK_CHARS)).toBe(true);
    expect(hard.map((c) => c.content).join('')).toBe(noSpaces);
  });
  it('keeps the page where each chunk starts', () => {
    const text = 'فصل اول: الگو\nدرس ۱: الگو\nمتن صفحهٔ یک.\n\f\nادامهٔ درس در صفحهٔ دو.\n\f\nدرس ۲: ضرب\nمتن درس دوم در صفحهٔ سه.';
    const p = processText(text);
    expect(p.pageCount).toBe(3);
    const l2 = p.sections.findIndex((s) => s.title.startsWith('درس ۲'));
    expect(p.chunks.find((c) => c.sectionIndex === l2)!.page).toBe(3);
  });
});

describe('sourceReferenceLabel', () => {
  it('is built from titles and a real page only', () => {
    expect(sourceReferenceLabel({ parentTitle: 'فصل اول: عدد', title: 'درس ۲: ضرب', page: 14 })).toBe('فصل اول، درس ۲، صفحه ۱۴');
    expect(sourceReferenceLabel({ title: 'کل متن' })).toBe('کل متن');
    expect(sourceReferenceLabel({ parentTitle: 'فصل اول', title: 'فصل اول' })).toBe('فصل اول');
  });
});
