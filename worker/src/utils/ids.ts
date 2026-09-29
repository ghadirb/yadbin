export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

// 32 symbols, no 0/O/1/I. 256 % 32 === 0 so (byte & 31) is unbiased.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 16 chars * 5 bits = 80 bits of entropy. Contains no student/class/teacher information. */
export function newPlayToken(length = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let s = '';
  for (const b of bytes) s += ALPHABET[b & 31];
  return s;
}
export const TOKEN_RE = /^[A-HJ-NP-Z2-9]{16}$/;
