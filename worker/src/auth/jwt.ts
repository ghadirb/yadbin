import { timingSafeEqual } from './password';

const enc = new TextEncoder();
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
export interface JwtPayload { sub: string; iat: number; exp: number }
export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function signJwt(sub: string, secret: string, ttl = TOKEN_TTL_SECONDS): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify({ sub, iat: now, exp: now + ttl })));
  return `${head}.${body}.${b64u(await hmac(secret, `${head}.${body}`))}`;
}
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const expected = await hmac(secret, `${parts[0]}.${parts[1]}`);
    if (!timingSafeEqual(expected, unb64u(parts[2]))) return null;
    const header = JSON.parse(new TextDecoder().decode(unb64u(parts[0])));
    if (header.alg !== 'HS256') return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64u(parts[1]))) as JwtPayload;
    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
