/* ============================================================
   NICEPLAY · 連線層
   ------------------------------------------------------------
   不連線也能用 —— 這一層是選配的。開了房才會用到。

   三種角色
     off   單機。資料只在這臺瀏覽器裡（預設）
     host  主控。開房的那一臺，配對／下一輪都在這裡算
     guest 店員。用主控房號加入，可以回報勝負
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

var LS = 'niceplay.net.v1';

function loadConn() {
  try { return JSON.parse(localStorage.getItem(LS)) || null; } catch (e) { return null; }
}
function saveConn(c) {
  try {
    if (c) localStorage.setItem(LS, JSON.stringify(c));
    else localStorage.removeItem(LS);
  } catch (e) {}
}

function create(opts) {
  opts = opts || {};
  var base = (opts.server || '').replace(/\/+$/, '');
  var conn = loadConn();               /* {code, hostToken?, role} */
  var es = null, pollTimer = null, retry = null;
  var lastRev = 0;
  var online = false;
  var pushing = false, pushAgain = false;

  var on = {
    state: opts.onState || function () {},
    status: opts.onStatus || function () {}
  };

  function status(msg, bad) {
    on.status({ role: conn ? conn.role : 'off', code: conn ? conn.code : '',
                online: online, msg: msg || '', bad: !!bad });
  }
  function api(path, init) {
    if (!base) return Promise.reject(new Error('沒有設定伺服器位址'));
    return fetch(base + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
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
      saveConn(conn); lastRev = j.rev; online = true;
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
      saveConn(conn); lastRev = j.rev; online = true;
      on.state(j.state, role);
      listen();
      status(role === 'watch' ? '已進入查詢模式' : '已加入 ' + code);
      return conn;
    });
  }

  function leave() {
    stop();
    conn = null; saveConn(null); online = false;
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
      if (j.rev > lastRev) { lastRev = j.rev; on.state(j.state, conn.role); }
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

  /* 加入者回報勝負 */
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
      conn = null; saveConn(null);
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
    pushState: pushState, sendResult: sendResult, refresh: pullOnce
  };
}

return { create: create };
});
