/** Test fixtures for Content Sources: builds real .docx (ZIP) and text .pdf files in memory, so the extractors run on genuine file bytes. */

const te = new TextEncoder();

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(data: Uint8Array): number { let c = 0xffffffff; for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = []; let total = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); total += value.length; }
  const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}

export interface ZipEntry { name: string; data: Uint8Array; deflate?: boolean }

/** Minimal ZIP writer (stored or deflated entries): enough for a .docx. */
export async function makeZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  for (const e of entries) {
    const name = te.encode(e.name), crc = crc32(e.data);
    const body = e.deflate ? await deflateRaw(e.data) : e.data, method = e.deflate ? 8 : 0;
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(crc), ...u32(body.length), ...u32(e.data.length), ...u16(name.length), ...u16(0), ...name, ...body]);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(crc), ...u32(body.length), ...u32(e.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
    chunks.push(local); offset += local.length;
  }
  const cdSize = central.reduce((t, c) => t + c.length, 0);
  const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, eocd];
  const out = new Uint8Array(all.reduce((t, c) => t + c.length, 0)); let o = 0;
  for (const c of all) { out.set(c, o); o += c.length; }
  return out;
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A .docx whose body is one paragraph per entry of `paragraphs`. */
export async function makeDocx(paragraphs: string[], opts: { deflate?: boolean } = {}): Promise<Uint8Array> {
  const body = paragraphs.map((p) => `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return makeZip([
    { name: '[Content_Types].xml', data: te.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'), deflate: opts.deflate },
    { name: 'word/document.xml', data: te.encode(xml), deflate: opts.deflate },
  ]);
}

/** A genuine PDF with one page per entry. Text is Latin (the standard Helvetica font needs no embedding); an empty string makes a page with no text,
 *  which is what a scanned book looks like to a text extractor. */
export function makePdf(pages: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, i) => {
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${esc(text)}) Tj ET` : '';
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n'; const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) { offsets[id] = out.length; out += `${id} 0 obj\n${objs[id]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return te.encode(out);
}
