/* NICEPLAY · Service Worker
   只做一件事：把整包程式快取起來，第一次載入之後就完全不需要網路。
   比賽資料存在 localStorage，本來就不經過這裡。 */
/* 版本號由 tools/stamp.sh 蓋上去，跟 index.html 裡的 ?v= 是同一組。
   換版本＝換快取名＝舊的整包丟掉，不會新舊混用。 */
const VERSION = '202608160145';
const CACHE = 'niceplay-' + VERSION;
const SHELL = [
  './', './index.html', './manifest.json',
  './src/style.css?v=' + VERSION, './src/engine.js?v=' + VERSION,
  './src/store.js?v=' + VERSION, './src/net.js?v=' + VERSION, './src/ui.js?v=' + VERSION,
  './assets/mark.png', './assets/mark-light.png',
  './assets/wordmark.png', './assets/wordmark-light.png',
  './assets/lockup.png', './assets/lockup-light.png',
  './assets/favicon-32.png', './assets/favicon-64.png', './assets/favicon-180.png',
  './assets/icon-192.png'
];

/* 一次 addAll，只要有一個檔 404 整批就都不會進快取 ——
   所以改成一個一個放，少一個檔不會讓離線功能整個失效。 */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
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
