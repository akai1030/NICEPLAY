/* NICEPLAY · Service Worker
   只做一件事：把整包程式快取起來，第一次載入之後就完全不需要網路。
   比賽資料存在 localStorage，本來就不經過這裡。 */
/* 版本號由 tools/stamp.sh 蓋上去，跟 index.html 裡的 ?v= 是同一組。
   換版本＝換快取名＝舊的整包丟掉，不會新舊混用。 */
const VERSION = '202608162357';
const CACHE = 'niceplay-' + VERSION;
const SHELL = [
  './', './index.html', './manifest.json',
  './src/style.css?v=' + VERSION, './src/qr.js?v=' + VERSION,
  './src/engine.js?v=' + VERSION,
  './src/store.js?v=' + VERSION, './src/net.js?v=' + VERSION, './src/ui.js?v=' + VERSION,
  './assets/mark.png', './assets/mark-light.png',
  './assets/wordmark.png', './assets/wordmark-light.png',
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

/* 這個 Service Worker 只管「程式本身」。房間伺服器的請求一律不碰。

   為什麼要特別擋：Service Worker 預設會攔截這個頁面發出的每一個請求，
   包含打到別的網域的。房間伺服器有三種請求，三種都被攔壞：

   一、SSE 長連線（/stream）。res.clone() 會開出第二條分支，
       cache.put 等著整串讀完才寫入 —— 但長連線永遠不會結束，
       複製出來的那條也就永遠沒人消化，反過來卡住原本那條，
       畫面就變成「連線中斷」。
   二、輪詢（GET /api/rooms/XXX）。回應被寫進快取，之後網路抖一下
       就會拿到舊的房間狀態當成新的 —— 比賽進行中拿到過期的對戰表，
       比連不上還糟。
   三、任何失敗時的最後手段是回 index.html。JSON 請求拿到一頁 HTML，
       解析失敗，畫面顯示「連不到伺服器」。

   所以：只處理同網域、而且不是 /api/ 的 GET。 */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  let url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;
  if (e.request.headers.get('accept') === 'text/event-stream') return;

  /* 網路優先、失敗才走快取：有網路時自動拿到新版，沒網路時照樣開得起來。 */
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
