// 画面のファイルは「まず最新を取りに行き、ダメなら保存分」、大きな部品は「保存分を優先」（初回に使ったとき保存。以後オフラインでも動く）
const V = 'taisosei-v3';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon-192.png', 'lib/chart.umd.min.js', 'lib/tesseract.min.js', 'lib/worker.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const store = (req, res) => { if (res.ok) { const c = res.clone(); caches.open(V).then(ca => ca.put(req, c)); } return res; };
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.includes('/lib/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => store(e.request, r))));
  } else {
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => store(e.request, r)).catch(() => caches.match(e.request)));
  }
});
