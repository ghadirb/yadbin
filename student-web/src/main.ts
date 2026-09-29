import './styles.css';
import { h } from './components/dom';
import { offlineBanner, createDomUi } from './play/screens';
import { tokenFromPath } from './play/router';
import { runSession } from './session/controller';
import { openStore } from './storage/kv';
import { createApi } from './sync/api';

async function boot() {
  const root = document.getElementById('app')!;
  root.before(offlineBanner());
  const ui = createDomUi(root);
  const token = tokenFromPath(location.pathname);
  if (!token) { ui.error('invalid', 'این لینک معتبر نیست.'); return; }
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const api = createApi(import.meta.env.VITE_API_BASE ?? '');
  const store = await openStore();
  try { await runSession({ token, api, store, ui }); }
  catch (e) { console.error(e); ui.error('generic', 'مشکلی پیش آمد. صفحه را دوباره باز کنید.'); }
}
void boot();
void h; // keep helper import tree-shakable-safe
