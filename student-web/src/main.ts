import './styles.css';
import { h } from './components/dom';
import { offlineBanner, createDomUi } from './play/screens';
import { tokenFromPath } from './play/router';
import { runSession } from './session/controller';
import { openStore } from './storage/kv';
import { createApi } from './sync/api';

declare global { interface Window { __yadbinReady?: boolean } }

async function boot() {
  window.__yadbinReady = true;
  const root = document.getElementById('app')!;
  root.before(offlineBanner());
  const ui = createDomUi(root);
  const token = tokenFromPath(location.pathname);
  if (!token) { ui.error('invalid', 'این لینک معتبر نیست.'); return; }
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const api = createApi(import.meta.env.VITE_API_BASE ?? '');
  window.addEventListener('unhandledrejection', () => ui.error('generic', 'مشکلی پیش آمد. صفحه را دوباره باز کنید.', () => location.reload()));
  const store = await openStore();
  try { await runSession({ token, api, store, ui }); }
  catch (e) { console.error(e); ui.error('generic', 'مشکلی پیش آمد. صفحه را دوباره باز کنید.', () => location.reload()); }
}
void boot();
void h; // keep helper import tree-shakable-safe
