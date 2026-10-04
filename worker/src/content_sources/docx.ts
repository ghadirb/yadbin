/** DOCX → plain text without any dependency: a .docx is a ZIP; the text lives in word/document.xml (deflate-compressed). */

const MAX_UNZIPPED = 25 * 1024 * 1024; // zip-bomb guard: never inflate more than this

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

async function inflateRaw(data: Uint8Array, cap: number): Promise<Uint8Array> {
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) { await reader.cancel(); throw new Error('zip_too_big'); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Bytes of one entry of a ZIP archive, or null when it is not there. Throws on a broken / unsupported (zip64, encrypted) archive. */
export async function readZipEntry(bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip_invalid');
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(v, p) !== 0x02014b50) throw new Error('zip_invalid');
    const flags = u16(v, p + 8), method = u16(v, p + 10), csize = u32(v, p + 20), usize = u32(v, p + 24);
    const nameLen = u16(v, p + 28), extraLen = u16(v, p + 30), commentLen = u16(v, p + 32), local = u32(v, p + 42);
    const entryName = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;
    if (flags & 1) throw new Error('zip_encrypted');
    if (usize > MAX_UNZIPPED) throw new Error('zip_too_big');
    if (local + 30 > bytes.length || u32(v, local) !== 0x04034b50) throw new Error('zip_invalid');
    const start = local + 30 + u16(v, local + 26) + u16(v, local + 28);
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) return raw;
    if (method === 8) return inflateRaw(raw, MAX_UNZIPPED);
    throw new Error('zip_unsupported');
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s: string) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
  if (e[0] === '#') { const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : ''; }
  return ENTITIES[e] ?? m;
});

/** Text of word/document.xml: one paragraph per line, blank line between paragraphs. */
export function documentXmlToText(xml: string): string {
  const out: string[] = [];
  for (const chunk of xml.split(/<w:p[ >]/).slice(1)) {
    const body = chunk.split('</w:p>')[0];
    let line = '';
    for (const m of body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) {
      if (m[1] !== undefined) line += decodeXml(m[1]);
      else line += m[0] === '<w:tab/>' ? ' ' : '\n';
    }
    out.push(line.trim());
  }
  return out.join('\n\n');
}

export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const doc = await readZipEntry(bytes, 'word/document.xml');
  if (!doc) throw new Error('docx_no_document');
  return documentXmlToText(new TextDecoder('utf-8').decode(doc));
}
