// Classic (non-module) watchdog: if the app never starts (very old WebView, blocked script/host, hung request),
// show a readable message instead of a blank page.
(function () {
  setTimeout(function () {
    if (window.__yadbinReady) return;
    var app = document.getElementById('app'); if (!app) return;
    app.innerHTML = '';
    var c = document.createElement('section'); c.className = 'card center'; c.setAttribute('role', 'alert');
    var h = document.createElement('h2'); h.textContent = '⏳ بازی بارگذاری نشد';
    var p = document.createElement('p'); p.textContent = 'اینترنت را بررسی کن یا لینک را در مرورگر اصلی گوشی (مثلاً Chrome) باز کن.';
    var b = document.createElement('button'); b.className = 'btn primary big'; b.textContent = 'تلاش دوباره';
    b.addEventListener('click', function () { location.reload(); });
    c.appendChild(h); c.appendChild(p); c.appendChild(b); app.appendChild(c);
  }, 10000);
})();
