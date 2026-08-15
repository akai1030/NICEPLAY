/* ============================================================
   NICEPLAY · 狀態層
   ------------------------------------------------------------
   一份狀態，三個地方保持一致：
     · 記憶體   —— 畫面直接讀
     · localStorage —— 關掉瀏覽器再開還在
     · BroadcastChannel —— 同一臺電腦的其他視窗（投影視窗）跟著變

   沒有伺服器。整套跑在瀏覽器裡，比賽全程不需要網路。

   同步策略沿用實戰驗證過的做法：
     · 傳「整份狀態」而不是「哪裡變了」——
       漏掉一次不會永遠歪掉，下一次就對回來，系統沒有「同步失敗」這個狀態
     · 倒數存「結束的絕對時刻」而不是「剩幾秒」——
       各視窗自己減自己的時間，不會因為傳遞延遲各報各的
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Store = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var KEY = 'niceplay.state.v1';
var CH = 'niceplay';

function uid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function blank() {
  return {
    v: 1,
    event: { name: '', date: today() },
    config: {
      format: 'swiss',          /* swiss | single | roundrobin */
      rounds: 4,
      cut: 0,                   /* 瑞士制跑完取前 N 名打淘汰賽，0 = 不打 */
      minutes: 30,              /* 每輪時間，0 = 不計時 */
      tableNaming: 'number',    /* number | letter | custom */
      tableCount: 0,            /* 0 = 依人數自動 */
      customTables: [],
      rules: { win: 3, draw: 1, loss: 0, minWinPct: 0.25 },
      liveTable: ''             /* 直播／主桌，空字串 = 沒有 */
    },
    players: [],
    matches: [],
    timer: { running: false, endsAt: 0, remainMs: 0, durMs: 0, round: null },
    phase: 'setup',             /* setup | running | done */
    rev: 0
  };
}

function today() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function pad(n) { return (n < 10 ? '0' : '') + n; }

/* ── 建立 ─────────────────────────────────────────────── */
function create() {
  var state = load() || blank();
  var subs = [];
  var chan = null;
  var quiet = false;               /* 收到別人的廣播時，不要再廣播回去 */

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      chan = new BroadcastChannel(CH);
      chan.onmessage = function (e) {
        if (!e.data || e.data.rev === undefined) return;
        if (e.data.rev <= state.rev) return;        /* 比自己舊就忽略 */
        state = e.data.state;
        quiet = true; emit(); quiet = false;
      };
    }
  } catch (err) { chan = null; }

  /* 另一個視窗直接改 localStorage（例如另一個分頁重設）也要跟上 */
  if (typeof addEventListener === 'function') {
    addEventListener('storage', function (e) {
      if (e.key !== KEY || !e.newValue) return;
      try {
        var next = JSON.parse(e.newValue);
        if (next && next.rev > state.rev) { state = next; quiet = true; emit(); quiet = false; }
      } catch (err) { /* 壞掉的就忽略，下一次寫入會蓋掉 */ }
    });
  }

  function emit() { subs.forEach(function (fn) { try { fn(state); } catch (e) {} }); }

  function commit(fn) {
    if (typeof fn === 'function') fn(state);
    state.rev = (state.rev || 0) + 1;
    save(state);
    if (chan && !quiet) {
      try { chan.postMessage({ rev: state.rev, state: state }); } catch (e) {}
    }
    emit();
    return state;
  }

  return {
    get: function () { return state; },
    commit: commit,
    subscribe: function (fn) { subs.push(fn); fn(state); return function () {
      subs = subs.filter(function (f) { return f !== fn; }); }; },
    reset: function () { return commit(function () {
      var b = blank(); Object.keys(state).forEach(function (k) { delete state[k]; });
      Object.keys(b).forEach(function (k) { state[k] = b[k]; });
    }); },
    replace: function (next) { return commit(function () {
      Object.keys(state).forEach(function (k) { delete state[k]; });
      Object.keys(next).forEach(function (k) { state[k] = next[k]; });
    }); }
  };
}

/* ── 存讀 ─────────────────────────────────────────────── */
function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { /* 無痕模式或空間滿了：記憶體裡照樣能跑完這一場 */ }
}
function load() {
  try {
    var raw = localStorage.getItem(KEY);
    if (!raw) return null;
    var s = JSON.parse(raw);
    return (s && s.v === 1) ? s : null;
  } catch (e) { return null; }
}

/* ── 匯出／匯入 ───────────────────────────────────────── */
function toJSON(state) { return JSON.stringify(state, null, 1); }
function fromJSON(text) {
  var s = JSON.parse(text);
  if (!s || s.v !== 1) throw new Error('不是 NICEPLAY 的存檔');
  return s;
}

/* ── 名單解析 ─────────────────────────────────────────
   一行一位。允許「1 王小明」「王小明」「1,王小明」這幾種寫法，
   前面的號碼可有可無。名字中間有空白也不會被切掉。      */
function parsePlayers(text) {
  var out = [], seen = {};
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var s = line.trim();
    if (!s) return;
    s = s.replace(/^[\s,、]+/, '');
    var m = s.match(/^(\d{1,3})[\s.,、:：)\]]+(.+)$/);
    var name = (m ? m[2] : s).trim();
    if (!name) return;
    var k = name.toLowerCase();
    if (seen[k]) return;                            /* 同名只留一個 */
    seen[k] = 1;
    out.push({ id: uid(), no: out.length + 1, name: name, dropped: false });
  });
  return out;
}

return {
  KEY: KEY, blank: blank, create: create, uid: uid,
  save: save, load: load, toJSON: toJSON, fromJSON: fromJSON,
  parsePlayers: parsePlayers
};
});
