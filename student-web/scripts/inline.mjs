// Post-build: fold JS + CSS + watchdog into dist/index.html so the game needs ONE network request to start.
// On throttled/filtered networks the extra asset requests are what tends to hang. CSP gets exact sha256 hashes
// for the inline scripts, so `script-src` stays strict (no 'unsafe-inline' for scripts).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const read = (p) => readFileSync(new URL(p, dist), 'utf8');
const hash = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');
const hashes = [];
let html = read('index.html');

let n = 0;
html = html.replace(/<link rel="stylesheet"[^>]*href="\/([^"]+\.css)"[^>]*>/, (_m, f) => { n++; return `<style>${safe(read(f))}</style>`; });
let appJs = '';
html = html.replace(/\s*<script type="module"[^>]*src="\/([^"]+\.js)"[^>]*><\/script>/, (_m, f) => { n++; appJs = safe(read(f)); return ''; });
let watchdog = '';
html = html.replace(/\s*<script src="\/boot-check\.js"[^>]*><\/script>/, () => { n++; watchdog = safe(read('boot-check.js')); return ''; });
if (n !== 3) throw new Error(`inline.mjs: expected 3 replacements, got ${n} — index.html layout changed`);

// Start the TLS handshake to the API host while the page is still parsing (first connection is the flaky one).
const api = process.env.VITE_API_BASE;
if (api && /^https:\/\/[\w.-]+$/.test(api)) html = html.replace('</head>', `  <link rel="preconnect" href="${api}" crossorigin>\n</head>`);

hashes.push(hash(appJs), hash(watchdog));
html = html.replace('</body>', `  <script type="module">${appJs}</script>\n  <script>${watchdog}</script>\n</body>`);
writeFileSync(new URL('index.html', dist), html);

const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
if (!headers.includes("script-src 'self'")) throw new Error("inline.mjs: _headers has no script-src 'self'");
writeFileSync(new URL('_headers', dist), headers.replace("script-src 'self'", `script-src 'self' ${hashes.join(' ')}`));

rmSync(new URL('assets/', dist), { recursive: true, force: true });
rmSync(new URL('boot-check.js', dist), { force: true });
// SPA fallback is handled by the platform (Workers assets `not_found_handling`); the catch-all rule would be flagged as a redirect loop.
rmSync(new URL('_redirects', dist), { force: true });
console.log(`inlined into index.html (${(html.length / 1024).toFixed(1)} KB), ${hashes.length} script hashes`);
