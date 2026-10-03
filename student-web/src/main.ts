import './styles.css';
import { h } from './components/dom';
import { offlineBanner, createDomUi, previewBanner } from './play/screens';
import { tokenFromPath } from './play/router';
import { runSession } from './session/controller';
import { openStore } from './storage/kv';
import { createApi } from './sync/api';
import { createAssessmentUi } from './assessment/screens';

declare global { interface Window { __yadbinReady?: boolean } }

async function boot() {
  window.__yadbinReady = true;
  const root = document.getElementById('app')!;
  const previewMatch = /^\/preview\/([^/]+)$/.exec(location.pathname);
  const token = previewMatch?.[1] ?? tokenFromPath(location.pathname);
  if (previewMatch) root.before(previewBanner());
  root.before(offlineBanner());
  const api = createApi(import.meta.env.VITE_API_BASE ?? '', !!previewMatch);
  const ui = createDomUi(root, async () => {
    if (!token || !api.progress || previewMatch) return null;
    const r = await api.progress(token);
    return r.kind === 'ok' ? r.data : null;
  }, { preview: !!previewMatch });
  if (!token) { ui.error('invalid', 'این لینک معتبر نیست.'); return; }
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('unhandledrejection', () => ui.error('generic', 'مشکلی پیش آمد. صفحه را دوباره باز کنید.', () => location.reload()));
  const store = await openStore();
  const assessmentUi = createAssessmentUi(root, { preview: !!previewMatch });
  try { await runSession({ token, api, store, ui, assessmentUi, preview: !!previewMatch }); }
  catch (e) { console.error(e); ui.error('generic', 'مشکلی پیش آمد. صفحه را دوباره باز کنید.', () => location.reload()); }
}
void boot();
void h; // keep helper import tree-shakable-safe
