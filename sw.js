/* NICEPLAY · Service Worker
   只做一件事：把整包程式快取起來，第一次載入之後就完全不需要網路。
   比賽資料存在 localStorage，本來就不經過這裡。 */
const CACHE = 'niceplay-v1';
const SHELL = [
  './', './index.html', './manifest.json', './icon.svg',
  './src/style.css', './src/engine.js', './src/store.js', './src/ui.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 網路優先、失敗才走快取：有網路時自動拿到新版，沒網路時照樣開得起來。 */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
