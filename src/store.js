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
    id: uid(),                  /* 這一場的身分。多場並存時用它認人 */
    /* host 是主辦單位。會出現在投影、選手手機、列印的名次表與桌卡上 ——
       店家辦的場子，畫面上要有店名；聯合活動要看得出是誰辦的。 */
    event: { name: '', date: today(), host: '' },
    config: {
      format: 'swiss',          /* swiss | single | roundrobin */
      rounds: 4,
      cut: 0,                   /* 瑞士制跑完取前 N 名打淘汰賽，0 = 不打 */
      /* 幾勝制。常規賽與淘汰賽分開設 —— 現場最常見的辦法就是
         瑞士制跑 BO1 控時間，切進淘汰賽才改 BO3。 */
      bo: 1,                    /* 常規賽（瑞士／循環）每場幾勝制 */
      boKO: 3,                  /* 淘汰賽每場幾勝制 */
      minutes: 30,              /* 每輪時間，0 = 不計時 */
      tableNaming: 'number',    /* number | letter | custom */
      tableCount: 0,            /* 0 = 依人數自動 */
      customTables: [],
      rules: { win: 3, draw: 1, loss: 0, minWinPct: 0.25 },
      liveTable: '',            /* 直播／主桌，空字串 = 沒有 */
      sound: true,              /* 時間到的提示音。主辦常常沒在看螢幕 */
      lateJoin: 'loss'          /* 中途加入的人前面幾輪：loss | bye | none */
    },
    players: [],
    matches: [],
    timer: { running: false, endsAt: 0, remainMs: 0, durMs: 0, round: null },
    /* 開房之後放選手那一組資訊。放在 state 裡是因為投影常常是
       另一個視窗（甚至另一臺筆電），那邊沒有連線層，只收得到狀態 ——
       不放這裡的話投影畫面就畫不出 QR。
       只放選手碼，店員密碼絕對不能進來：state 會送給每一個加入者，
       選手讀得到，等於把權限發出去。 */
    room: null,                 /* { view, srv } 或 null */
    theme: 'dark',              /* dark | light，全域，兩個視窗共用 */
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
        quiet = true; emit(true); quiet = false;
      };
    }
  } catch (err) { chan = null; }

  /* 另一個視窗直接改 localStorage（例如另一個分頁重設）也要跟上 */
  if (typeof addEventListener === 'function') {
    addEventListener('storage', function (e) {
      if (e.key !== KEY || !e.newValue) return;
      try {
        var next = JSON.parse(e.newValue);
        if (next && next.rev > state.rev) { state = next; quiet = true; emit(true); quiet = false; }
      } catch (err) { /* 壞掉的就忽略，下一次寫入會蓋掉 */ }
    });
  }

  /* 訂閱者要分得出這份狀態是「這個視窗自己改的」還是「別人推過來的」。
     分不出來的話，收到別人的狀態又照樣往外推，兩個視窗就會互推到天荒地老。 */
  function emit(remote) {
    subs.forEach(function (fn) { try { fn(state, !!remote); } catch (e) {} });
  }

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
    subscribe: function (fn) { subs.push(fn); fn(state, false); return function () {
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

/* ── 還原點 ───────────────────────────────────────────
   只留「上一步」，一層就好。

   會清掉東西的動作只有四個：重排這一輪、重新開始比賽、匯入存檔、
   全部清除重來。四個都已經要按兩次才會執行，但兩段確認擋不住
   「我以為我按的是別顆」—— 而在現場，那一下就是整場的成績。

   存成獨立的一把 key，跟主狀態分開：主狀態壞掉或被清掉的時候，
   還原點必須還在，不然它就沒有意義了。 */
var UNDO = 'niceplay.undo.v1';

function saveUndo(state, what) {
  try {
    localStorage.setItem(UNDO, JSON.stringify({
      at: Date.now(), what: what || '上一個動作', state: state
    }));
  } catch (e) { /* 空間滿了就算了，本來就是保險 */ }
}
function loadUndo() {
  try {
    var u = JSON.parse(localStorage.getItem(UNDO));
    return (u && u.state && u.state.v === 1) ? u : null;
  } catch (e) { return null; }
}
function clearUndo() { try { localStorage.removeItem(UNDO); } catch (e) {} }

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
    if (!s || s.v !== 1) return null;
    if (!s.id) s.id = uid();          /* 舊存檔沒有 id，補一個才進得了清單 */
    return s;
  } catch (e) { return null; }
}

/* ── 賽事清單 ─────────────────────────────────────────
   週末連跑兩三場的店家，原本得「匯出 → 全部清除 → 重新設定」，
   而「全部清除」是整個介面最危險的一顆按鈕。

   設計上刻意不把所有場次都塞進同一把 key：
     KEY  永遠只放「現在這一場」—— 舊版存檔照樣讀得進來，格式沒變
     LIB  放「其他場次」
   切換就是兩邊對調。沒有重複存兩份，也不必動到既有的存讀路徑。 */
var LIB = 'niceplay.library.v1';

function libLoad() {
  try {
    var a = JSON.parse(localStorage.getItem(LIB));
    return Array.isArray(a) ? a.filter(function (e) { return e && e.id && e.state; }) : [];
  } catch (e) { return []; }
}
function libWrite(list) {
  try { localStorage.setItem(LIB, JSON.stringify(list)); return true; }
  catch (e) { return false; }        /* 空間滿了：回 false，讓上層講給人聽 */
}
function libEntry(state) {
  return {
    id: state.id, savedAt: Date.now(),
    name: state.event.name || '', host: state.event.host || '',
    date: state.event.date || '',
    players: (state.players || []).length,
    rounds: countRoundsIn(state.matches),
    state: state
  };
}
function countRoundsIn(matches) {
  var s = {};
  (matches || []).forEach(function (m) { if (typeof m.round === 'number') s[m.round] = 1; });
  return Object.keys(s).length;
}
/* 把「現在這一場」收進清單。已經在裡面就更新，不會變成兩筆。 */
function libStash(state) {
  var list = libLoad().filter(function (e) { return e.id !== state.id; });
  list.unshift(libEntry(state));
  return libWrite(list.slice(0, 20)) ? list : null;   /* 最多留 20 場 */
}
function libTake(id) {
  var list = libLoad(), hit = null;
  var rest = list.filter(function (e) {
    if (e.id === id) { hit = e; return false; }
    return true;
  });
  if (!hit) return null;
  libWrite(rest);
  return hit.state;
}
function libDrop(id) {
  libWrite(libLoad().filter(function (e) { return e.id !== id; }));
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
    /* 編號後面的分隔符要連全形一起認 —— 從 Word／Excel 貼過來的中文名單
       常常是「01）王小明」「1．王小明」「1，王小明」這種全形標點，
       只認半形的話整串會被當成名字，畫面上就變成「01）王小明」。
       刻意不收「-」：有人的名字本來就長那樣（3-Ply），切錯比不切更糟。 */
    var m = s.match(/^(\d{1,3})[\s.,、:：)\]）】．。，；;]+(.+)$/);
    var name = (m ? m[2] : s).trim();
    if (!name) return;

    /* 隊伍／店家：名字後面加 @桌遊記 或（桌遊記）都算。
       填了之後瑞士制會盡量避開同隊內戰 —— 大家大老遠來，
       第一輪就打到隊友是最沒意思的一種配對。 */
    var team = '';
    var tm = name.match(/^(.*?)[\s]*[@＠]\s*(.+)$/) ||
             name.match(/^(.*?)[\s]*[（(]\s*([^）)]+)[）)]\s*$/);
    if (tm && tm[1].trim()) { name = tm[1].trim(); team = tm[2].trim(); }

    var k = name.toLowerCase();
    if (seen[k]) return;                            /* 同名只留一個 */
    seen[k] = 1;
    out.push({ id: uid(), no: out.length + 1, name: name, team: team, dropped: false });
  });
  return out;
}

return {
  KEY: KEY, blank: blank, create: create, uid: uid,
  save: save, load: load, toJSON: toJSON, fromJSON: fromJSON,
  saveUndo: saveUndo, loadUndo: loadUndo, clearUndo: clearUndo,
  LIB: LIB, libLoad: libLoad, libStash: libStash, libTake: libTake, libDrop: libDrop,
  parsePlayers: parsePlayers
};
});
