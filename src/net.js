/* ============================================================
   NICEPLAY · 連線層
   ------------------------------------------------------------
   不連線也能用 —— 這一層是選配的。開了房才會用到。

   三種角色
     off   單機。資料只在這臺瀏覽器裡（預設）
     host  主控。開房的那一臺，配對／下一輪都在這裡算
     guest 副控。用主控房號加入，可以回報勝負
     watch 選手。用觀眾碼加入，只能看 —— 伺服器會擋掉所有寫入

   同步策略跟伺服器對稱：
     · 主控把整份狀態推上去；加入者只送「回報勝負」這個小操作
     · 賽制永遠只有一份實作（engine.js），伺服器不懂賽制
     · SSE 即時收，斷了就退回輪詢；重連是免費的
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Net = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* 身分存在「分頁」而不是「這臺電腦」。

   localStorage 是整個網域共用的，所以主控開一個分頁當主控、
   再開一個分頁想當副控時，兩個分頁會讀到同一份連線資料，
   後開的那個直接繼承主控身分 —— 同一臺電腦就分不出誰是誰。
   sessionStorage 是每個分頁各一份，重整還在、關掉才沒，
   剛好就是「身分」該有的壽命。

   主控另外在 localStorage 留一份備援：主控端不小心關掉整個瀏覽器
   再打開，還接得回原本的房間（那把 hostToken 掉了就推不了狀態，
   等於整場要重開房）。但只在這個分頁沒有自己的身分、
   而且網址沒有指定身分的時候才會用到。 */
var SS = 'niceplay.net.v1';        /* 這個分頁的身分 */
var LS = 'niceplay.host.v1';       /* 主控備援，整臺電腦一份 */

function readJSON(store, key) {
  try { return JSON.parse(store.getItem(key)) || null; } catch (e) { return null; }
}
function loadConn(opts) {
  /* offline：這個視窗完全不要連線（投影窗）。
     window.open 開出來的視窗會「複製一份」opener 的 sessionStorage，
     所以投影窗會繼承主控身分 —— 不擋的話兩個視窗都會推狀態。 */
  if (opts.offline) return null;
  var c = readJSON(sessionStorage, SS);
  if (c) return c;
  if (opts.isolate) return null;   /* 網址已經指定身分，不要繼承主控 */
  var h = readJSON(localStorage, LS);
  return (h && h.role === 'host') ? h : null;
}
function saveConn(c, offline) {
  if (offline) return;               /* 投影窗不留任何身分 */
  try {
    if (c) sessionStorage.setItem(SS, JSON.stringify(c));
    else sessionStorage.removeItem(SS);
  } catch (e) {}
  try {
    if (c && c.role === 'host') localStorage.setItem(LS, JSON.stringify(c));
  } catch (e) {}
}
function dropHostBackup() { try { localStorage.removeItem(LS); } catch (e) {} }

function create(opts) {
  opts = opts || {};
  var base = (opts.server || '').replace(/\/+$/, '');
  var conn = loadConn(opts);           /* {code, hostToken?, role} */
  var es = null, pollTimer = null, retry = null;
  var lastRev = 0;
  var online = false;
  var pushing = false, pushAgain = false;

  var on = {
    state: opts.onState || function () {},
    status: opts.onStatus || function () {}
  };

  /* 主控推出去的狀態會經 SSE 原封不動回到自己身上。內容一樣時無所謂，
     但推送在飛的時候本機又改了一次，回音就變成「用舊的蓋掉新的」。

     現場症狀：按「開始比賽」，對戰表排好又瞬間消失，只剩名單，計時器也
     退回不計時 —— 因為那顆按鈕連做兩次 commit（先寫名單、再排對戰），
     第一次的回音把第二次的成果洗掉，排隊中的第二次推送再把空的送上去。
     按「下一輪」不會，因為它只 commit 一次。

     伺服器是先廣播、後回應（見 server/index.js 的 /state），量過正式站
     八次有六次回音比 POST 的回應早到，所以這不是偶發。

     判斷方式：pushAgain 為真＝送出去之後本機又改過，本機一定比伺服器新，
     這時候進來的一律不理。只看 pushing 不夠精準 —— 那會把別人在這段時間
     做的變更也一起擋掉。 */
  function localAhead() { return !!(conn && conn.role === 'host' && pushAgain); }

  function status(msg, bad) {
    on.status({ role: conn ? conn.role : 'off', code: conn ? conn.code : '',
                online: online, msg: msg || '', bad: !!bad });
  }
  /* 回應一定要是 JSON 物件才算數。
     不檢查的話，任何中間層（Service Worker 的離線後備、公共 Wi-Fi 的
     登入攔截頁、CDN 的錯誤頁）回一頁 HTML 都會被當成「連上了但沒有新資料」，
     畫面看起來正常、其實整場都沒在同步 —— 那比直接報錯難查太多。 */
  function api(path, init) {
    if (!base) return Promise.reject(new Error('沒有設定伺服器位址'));
    return fetch(base + path, init).then(function (r) {
      return r.text().then(function (body) {
        var j = null;
        try { j = JSON.parse(body); } catch (e) { j = null; }
        if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
        if (!j || typeof j !== 'object') throw new Error('伺服器回的不是 JSON');
        return j;
      });
    });
  }

  /* ── 開房 / 加入 / 離開 ─────────────────────────── */
  function host(state) {
    return api('/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: state })
    }).then(function (j) {
      conn = { code: j.code, viewCode: j.viewCode, hostToken: j.hostToken, role: 'host' };
      saveConn(conn, opts.offline); lastRev = j.rev; online = true;
      listen();
      status('已開房 ' + j.code);
      return conn;
    });
  }

  function join(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) return Promise.reject(new Error('房號格式不對'));
    return api('/api/rooms/' + code).then(function (j) {
      /* 伺服器會告訴我們用的是哪一組碼 —— 觀眾碼就是唯讀 */
      var role = j.readOnly ? 'watch' : 'guest';
      conn = { code: code, role: role };
      saveConn(conn, opts.offline); lastRev = j.rev; online = true;
      on.state(j.state, role);
      listen();
      status(role === 'watch' ? '已進入查詢模式' : '已加入 ' + code);
      return conn;
    });
  }

  function leave() {
    stop();
    if (conn && conn.role === 'host') dropHostBackup();
    conn = null; saveConn(null, opts.offline); online = false;
    status('已離線，回到單機模式');
  }

  /* ── 收 ────────────────────────────────────────── */
  function stop() {
    if (es) { try { es.close(); } catch (e) {} es = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (retry) { clearTimeout(retry); retry = null; }
  }

  function listen() {
    stop();
    if (!conn || !base) return;

    if (typeof EventSource !== 'undefined') {
      try {
        es = new EventSource(base + '/api/rooms/' + conn.code + '/stream');
        es.onmessage = function (e) {
          var j;
          try { j = JSON.parse(e.data); } catch (err) { return; }
          if (!j || j.rev === undefined) return;
          online = true;
          if (localAhead()) return;                  /* 這是自己的舊回音 */
          if (j.rev <= lastRev) return;
          lastRev = j.rev;
          on.state(j.state, conn.role);
          status('');
        };
        es.onerror = function () {
          /* 連線斷了 —— 畫面照舊，退回輪詢，EventSource 自己也會重試 */
          online = false;
          status('連線中斷，重試中', true);
          startPolling();
        };
        return;
      } catch (e) { es = null; }
    }
    startPolling();
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pullOnce, 1500);
    pullOnce();
  }
  function pullOnce() {
    if (!conn) return;
    api('/api/rooms/' + conn.code).then(function (j) {
      online = true;
      if (!localAhead() && j.rev > lastRev) { lastRev = j.rev; on.state(j.state, conn.role); }
      status('');
    }).catch(function () { online = false; status('連不到伺服器', true); });
  }

  /* ── 送 ────────────────────────────────────────── */

  /* 主控推整份狀態。連續改動只送最後一次，避免洗版。 */
  function pushState(state) {
    if (!conn || conn.role !== 'host') return Promise.resolve();
    if (pushing) { pushAgain = true; return Promise.resolve(); }
    pushing = true;
    return api('/api/rooms/' + conn.code + '/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostToken: conn.hostToken, state: state })
    }).then(function (j) {
      lastRev = j.rev; online = true; status('');
    }).catch(function (e) {
      online = false; status('推送失敗：' + e.message, true);
    }).then(function () {
      pushing = false;
      if (pushAgain) { pushAgain = false; pushState(state); }
    });
  }

  /* 加入者回報一整場的小局。BO 的規則只有 engine.js 一份，
     副控在自己那邊算完再送過來，伺服器只驗格式、不重算。 */
  function sendMatch(round, table, games, result) {
    if (!conn || conn.role === 'watch') return Promise.resolve(null);
    return api('/api/rooms/' + conn.code + '/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'match', round: round, table: table,
                             games: games, result: result })
    }).then(function (j) {
      online = true;
      if (j.rev > lastRev) { lastRev = j.rev; on.state(j.state, conn.role); }
      status('');
      return j;
    }).catch(function (e) {
      online = false; status('送不出去：' + e.message, true);
      throw e;
    });
  }

  /* 加入者回報勝負（一勝制的老路，留著讓舊分頁還能用） */
  function sendResult(round, table, value) {
    if (!conn || conn.role === 'watch') return Promise.resolve(null);
    return api('/api/rooms/' + conn.code + '/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'result', round: round, table: table, value: value })
    }).then(function (j) {
      online = true;
      if (j.rev > lastRev) { lastRev = j.rev; on.state(j.state, conn.role); }
      status('');
      return j;
    }).catch(function (e) {
      online = false; status('送不出去：' + e.message, true);
      throw e;
    });
  }

  /* 重整之後自動接回原本的房間 */
  function resume() {
    if (!conn || !base) { status(''); return Promise.resolve(false); }
    return api('/api/rooms/' + conn.code).then(function (j) {
      lastRev = j.rev; online = true;
      if (conn.role !== 'host') on.state(j.state, conn.role);
      listen();
      status('已接回 ' + conn.code);
      return true;
    }).catch(function () {
      /* 房間過期或伺服器換過 —— 回到單機，資料還在本機不會掉 */
      if (conn && conn.role === 'host') dropHostBackup();
      conn = null; saveConn(null, opts.offline);
      status('原本的房間已經不在，回到單機模式', true);
      return false;
    });
  }

  return {
    get role() { return conn ? conn.role : 'off'; },
    get code() { return conn ? conn.code : ''; },
    get viewCode() { return conn ? (conn.viewCode || '') : ''; },
    get online() { return online; },
    get server() { return base; },
    setServer: function (u) { base = String(u || '').replace(/\/+$/, ''); },
    host: host, join: join, leave: leave, resume: resume,
    pushState: pushState, sendResult: sendResult, sendMatch: sendMatch, refresh: pullOnce
  };
}

return { create: create };
});
