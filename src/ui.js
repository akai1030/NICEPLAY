/* ============================================================
   NICEPLAY · 介面
   ------------------------------------------------------------
   三個分頁（設定 / 對戰 / 排名）＋ 一個投影覆蓋層。
   狀態全部來自 Store，這裡只負責畫出來和把操作寫回去。

   投影模式是「同一個網頁的另一個狀態」，不是另一個頁面 ——
   按「放大投影」就切過去，Esc 回來。要拆成兩個視窗的話，
   把網址加 #present 開第二個視窗拖到投影機，BroadcastChannel 會同步。
   ============================================================ */
(function () {
'use strict';

var E = window.Engine, S = window.Store;
var store = S.create();
var el = function (id) { return document.getElementById(id); };

/* 整個介面是一個 IIFE，又靠一個 250ms 的計時器在跑。
   任何一個沒接住的例外都會讓那個計時器停掉 —— 現場看到的是「畫面凍住」，
   而且不會有任何訊息告訴主辦發生了什麼事。
   接住它至少讓人知道要重整，也讓下一次 tick 還跑得動。 */
addEventListener('error', function (e) {
  try { toast('畫面出錯了：' + (e && e.message || '未知') + ' —— 重整一次就好，資料還在', true); }
  catch (err) {}
});
addEventListener('unhandledrejection', function (e) {
  try {
    var r = e && e.reason;
    toast('有一個動作沒完成：' + (r && r.message || r || '未知'), true);
  } catch (err) {}
});

var pvMode = 'matches';        /* 投影顯示：matches | rank */
var drafting = null;           /* 名單暫存，還沒按「開始比賽」 */
var applyingRemote = false;    /* 正在套用伺服器來的狀態，這時候不要再推回去 */

var SRV_KEY = 'niceplay.server';
var ME_KEY = 'niceplay.me';

/* 官方房間伺服器。自己架的話改這一行，或在設定頁直接改欄位（會記在瀏覽器裡）。 */
var DEFAULT_SERVER = 'https://niceplayroom.transtation.org';

/* 網址已經指定身分（副控／選手）的話，這個分頁就不要去繼承
   這臺電腦上的主控身分 —— 不然同一臺電腦開副控會變成第二個主控。 */
var ROLE_HASH = /^#(sub|staff)\b|^#join=/.test(location.hash);

/* 投影視窗不連線。它跟控制台在同一臺電腦，狀態走 BroadcastChannel 就夠了。
   讓它也連上去的話，兩個視窗會拿到同一把 hostToken、都以為自己是主控，
   於是「收到對方的狀態 → 再推回去」互推到天荒地老 ——
   伺服器被打爆，畫面看起來就是一直斷線。 */
var IS_PRESENT = (location.hash === '#present');

var net = window.Net.create({
  offline: IS_PRESENT,
  isolate: ROLE_HASH,
  server: localStorage.getItem(SRV_KEY) || DEFAULT_SERVER,
  onState: function (remote, role) {
    /* 伺服器來的整份狀態直接取代本機。主控與加入者都吃這條，
       所以「傳整份快照」的自癒特性在兩邊都成立。 */
    applyingRemote = true;
    try { store.replace(remote); } finally { applyingRemote = false; }
  },
  onStatus: function (s) { paintNet(s); }
});

/* ── 小工具 ─────────────────────────────────────────── */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function fmtCount(ms) {
  var neg = ms < 0; if (neg) ms = -ms;
  var s = Math.floor(ms / 1000);
  var t = s >= 3600
    ? Math.floor(s / 3600) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60)
    : pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  return (neg ? '+' : '') + t;
}
function toast(msg, bad) {
  var t = el('toast');
  t.textContent = msg;
  t.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.className = ''; }, bad ? 5200 : 3200);
}
function nameOf(st, id) {
  if (id === null || id === undefined) return '輪空';
  for (var i = 0; i < st.players.length; i++) if (st.players[i].id === id) return st.players[i].name;
  return '？';
}
function numOf(st, id) {
  for (var i = 0; i < st.players.length; i++) if (st.players[i].id === id) return st.players[i].no;
  return '';
}
function alive(st) { return st.players.filter(function (p) { return !p.dropped; }); }

/* 每個人的戰績查表。名字後面隨時看得到幾勝幾敗 ——
   現場最常被問的就是這個，而且會被問到主辦沒空排下一輪。
   算一次給整個畫面共用，不要每張卡各算一次。 */
function recMap(st) {
  var out = {};
  try {
    E.standings(st.players, st.matches, st.config.rules).forEach(function (x) {
      out[x.id] = { rec: x.w + '-' + x.l + (x.d ? '-' + x.d : ''), pts: x.pts, rank: x.rank };
    });
  } catch (e) {}
  return out;
}

/* 目前這一輪的 key（數字或「八強」這種字串） */
function currentRound(st) {
  if (!st.matches.length) return null;
  return st.matches[st.matches.length - 1].round;
}
function matchesOf(st, round) {
  return st.matches.filter(function (m) { return m.round === round; });
}
/* 輪次名稱。雙敗的 W1 / L4 / F 對現場沒有意義，一律翻成人話。 */
function roundLabel(r) {
  if (typeof r === 'number') return '第 ' + r + ' 輪';
  return /^[WL]\d+$|^F2?$/.test(r) ? E.koName(r) : r;
}

/* 賽制寫成人話。紙本與檔名都用得到 —— 印出來貼在櫃檯的那張，
   要讓沒參加的人也看得懂這是什麼比賽。 */
function formatLabel(cfg) {
  var f = cfg.format;
  var base = f === 'roundrobin' ? '循環賽'
           : f === 'single' ? '單敗淘汰'
           : f === 'double' ? '雙敗淘汰'
           : '瑞士制 ' + cfg.rounds + ' 輪';
  if (f === 'swiss' && cfg.cut >= 2) base += '＋前 ' + cfg.cut + ' 名淘汰賽';
  var bo = cfg.bo || 1, bk = cfg.boKO || 1;
  if (f === 'single' || f === 'double') return base + '　BO' + bk;
  if (bo === bk || !cfg.cut) return base + '　BO' + bo;
  return base + '　常規 BO' + bo + '／淘汰 BO' + bk;
}

/* 檔名前綴：主辦_賽事_日期。存成一整個資料夾之後才分得出哪張是哪場。 */
function fileStem(st) {
  return [st.event.host, st.event.name || 'niceplay', st.event.date]
    .filter(Boolean).join('_').replace(/[\\/:*?"<>|\s]+/g, '_');
}

/* ── 分頁 ───────────────────────────────────────────── */
document.querySelectorAll('.tabs button').forEach(function (b) {
  b.onclick = function () {
    if (b.disabled) return;
    document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('on'); });
    document.querySelectorAll('.pane').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    el(b.dataset.tab).classList.add('on');
  };
});
function goTab(id) {
  var b = document.querySelector('.tabs button[data-tab="' + id + '"]');
  if (b) b.click();
}

/* ── 設定：表單 ⇄ 狀態 ──────────────────────────────── */
function fillForm(st) {
  el('fName').value = st.event.name;
  el('fDate').value = st.event.date;
  el('fHost').value = st.event.host || '';        /* 舊存檔沒有這一欄 */
  el('fFormat').value = st.config.format;
  el('fRounds').value = st.config.rounds;
  el('fCut').value = String(st.config.cut || 0);
  /* 舊存檔沒有 bo / boKO —— 一律回到一勝制，不要替使用者改變已經在跑的賽事 */
  el('fBo').value = String(st.config.bo || 1);
  el('fBoKO').value = String(st.config.boKO || 1);
  el('fNaming').value = st.config.tableNaming;
  el('fTables').value = st.config.tableCount || '';
  el('fCustom').value = (st.config.customTables || []).join(', ');
  el('fLive').value = st.config.liveTable || '';
  el('fWin').value = st.config.rules.win;
  el('fDraw').value = st.config.rules.draw;
  el('fLoss').value = st.config.rules.loss;
  el('fMinutes').value = st.config.minutes;
  el('fSound').value = (st.config.sound === false) ? '0' : '1';
  el('fLate').value = st.config.lateJoin || 'loss';
  syncFormatFields();
}

function readForm(st) {
  st.event.name = el('fName').value.trim();
  st.event.date = el('fDate').value.trim();
  st.event.host = el('fHost').value.trim();
  st.config.format = el('fFormat').value;
  st.config.rounds = Math.max(1, parseInt(el('fRounds').value, 10) || 1);
  st.config.cut = parseInt(el('fCut').value, 10) || 0;
  st.config.bo = parseInt(el('fBo').value, 10) || 1;
  st.config.boKO = parseInt(el('fBoKO').value, 10) || 1;
  st.config.tableNaming = el('fNaming').value;
  st.config.tableCount = parseInt(el('fTables').value, 10) || 0;
  st.config.customTables = el('fCustom').value.split(/[,，]/)
    .map(function (s) { return s.trim(); }).filter(Boolean);
  st.config.liveTable = el('fLive').value.trim();
  st.config.rules.win = parseInt(el('fWin').value, 10);
  st.config.rules.draw = parseInt(el('fDraw').value, 10);
  st.config.rules.loss = parseInt(el('fLoss').value, 10);
  st.config.minutes = Math.max(0, parseInt(el('fMinutes').value, 10) || 0);
  st.config.sound = el('fSound').value !== '0';
  st.config.lateJoin = el('fLate').value;
}

/* 賽制不同，該問的東西也不同 —— 不相關的欄位直接收起來 */
function syncFormatFields() {
  var f = el('fFormat').value;
  el('wrapRounds').style.display = (f === 'swiss') ? '' : 'none';
  el('wrapCut').style.display = (f === 'swiss') ? '' : 'none';
  el('wrapCustom').style.display = (el('fNaming').value === 'custom') ? '' : 'none';

  /* 純淘汰賽沒有「常規賽」，瑞士制不接淘汰賽就沒有「淘汰賽」——
     不相關的那個直接收起來，免得設了半天沒作用。 */
  var isKO = (f === 'single' || f === 'double');
  var hasNormal = !isKO;
  var hasKO = isKO || (f === 'swiss' && (parseInt(el('fCut').value, 10) || 0) >= 2);
  el('wrapBo').style.display = hasNormal ? '' : 'none';
  el('wrapBoKO').style.display = hasKO ? '' : 'none';
  el('boHint').innerHTML = boHintText(hasNormal, hasKO);
  updateTableHint();
}

/* 幾勝制講清楚兩件現場一定會問的事：要贏幾局、平手怎麼算 */
function boHintText(hasNormal, hasKO) {
  var parts = [];
  if (hasNormal) parts.push('常規賽 ' + boWord(parseInt(el('fBo').value, 10) || 1));
  if (hasKO) parts.push('淘汰賽 ' + boWord(parseInt(el('fBoKO').value, 10) || 1));
  if (f === 'double') {
    parts.push('雙敗：輸一場掉敗部，敗部再輸才結束。' +
               '總決賽如果是敗部冠軍贏，兩邊都只輸一場，會自動加賽一場');
  }
  if (!parts.length) return '';
  return parts.join('　·　') + '<br>' +
    '對戰卡上點誰贏，就記他一局；打滿還沒有人過半就算平手（BO2 的 1-1、BO3 的 1-1-1）。' +
    '點錯用卡片右邊的「退一局」往回退。<b>每一場的幾勝制在排出來的當下就定了</b> —— ' +
    '中途改設定只影響之後排的輪次，已經打完的不會被改寫。';
}
function boWord(bo) {
  if (bo <= 1) return '<b>BO1</b>　一局定勝負';
  return '<b>BO' + bo + '</b>　先贏 ' + E.winsNeeded(bo) + ' 局' +
         (bo % 2 === 0 ? '，' + (bo / 2) + '-' + (bo / 2) + ' 算平手' : '');
}

function updateTableHint(st) {
  st = st || store.get();
  var n = (drafting || st.players).filter(function (p) { return !p.dropped; }).length;
  if (!n) { el('tableHint').textContent = '先讀入名單，系統會依人數自動建議桌數。'; return; }
  var count = parseInt(el('fTables').value, 10) || E.suggestTables(n);
  var names = E.makeTables(Math.min(count, 60), el('fNaming').value,
    el('fCustom').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean));
  var head = names.slice(0, 8).join('、') + (count > 8 ? ' …… ' + names[Math.min(count, 60) - 1] : '');
  el('tableHint').innerHTML = n + ' 人 → 需要 <b>' + E.suggestTables(n) + '</b> 桌，' +
    '目前設定 <b>' + count + '</b> 桌：' + esc(head);
}

/* ── 名單 ─────────────────────────────────────────────
   文字框永遠等於完整名單：按「更新名單」會把它正規化後寫回去，
   所以要加人只要在最後補一行再按一次，原本的人不會被洗掉。
   比賽開始後只做「新增」，不會刪人 —— 要移除請用退賽，
   不然已經打完的場次會對不到人。                          */
function syncPlayerBox(st) {
  var box = el('fPlayers');
  if (document.activeElement === box) return;      /* 正在打字就別動它 */
  var list = drafting || st.players;
  /* 寫回去的格式要跟讀得進來的一致，不然按第二次「更新名單」隊伍就掉了 */
  box.value = list.map(function (p) {
    return p.no + ' ' + p.name + (p.team ? ' @' + p.team : '');
  }).join('\n');
}

el('btnParse').onclick = function () {
  var typed = S.parsePlayers(el('fPlayers').value);
  if (!typed.length) { toast('看不出名字，一行一位試試', true); return; }
  var st = store.get();

  if (!st.matches.length) {
    /* 還沒開賽：整份取代，編號重排 */
    drafting = typed.map(function (p, i) {
      return { id: p.id, no: i + 1, name: p.name, team: p.team || '', dropped: false };
    });
    paintRoster(drafting);
    syncPlayerBox(st);
    el('playerMsg').innerHTML = '<span class="ok">名單共 ' + drafting.length + ' 位</span>';
    if (el('fFormat').value === 'swiss') el('fRounds').value = E.suggestRounds(drafting.length);
    updateTableHint();
    return;
  }

  /* 比賽中：比對名字，只加新的，舊的保留原本的 id 與成績 */
  var byName = {};
  st.players.forEach(function (p) { byName[p.name] = p; });
  var added = [], missing = [];
  typed.forEach(function (p) { if (!byName[p.name]) added.push(p); });
  var typedNames = {};
  typed.forEach(function (p) { typedNames[p.name] = 1; });
  st.players.forEach(function (p) { if (!typedNames[p.name]) missing.push(p.name); });

  if (!added.length) {
    toast(missing.length ? '沒有新的人。要移除請用排名頁的「退賽」' : '名單沒有變動',
          missing.length > 0);
    syncPlayerBox(st);
    return;
  }

  /* 遲到的人前面幾輪怎麼算。不補的話他等於白拿一個很高的 OMW% ——
     分母裡少了那幾場，同分時會排在有打滿的人前面，那不公平。
     實務上通常記為敗，但這是主辦的決定，所以做成設定而不是寫死。 */
  var past = E.countRounds(st.matches);
  var mode = el('fLate').value;
  var names = added.map(function (p) { return p.name; });

  store.commit(function (s) {
    added.forEach(function (p) {
      var id = S.uid();
      s.players.push({ id: id, no: s.players.length + 1, name: p.name,
                       team: p.team || '', dropped: false });
      if (mode === 'none' || !past) return;
      for (var r = 1; r <= past; r++) {
        s.matches.push({
          round: r, table: mode === 'loss' ? '未到' : '輪空',
          a: id, b: null, bo: 1, games: [],
          result: mode === 'loss' ? 'noshow' : 'bye'
        });
      }
    });
  });

  var tail = (past && mode !== 'none')
    ? '　前 ' + past + ' 輪各補記一' + (mode === 'loss' ? '敗' : '次輪空')
    : '';
  toast('已加入 ' + added.length + ' 位：' + names.join('、') + tail +
        (missing.length ? '（' + missing.join('、') + ' 未移除，請用退賽）' : ''));
};

function paintRoster(list) {
  el('rosterView').innerHTML = list.map(function (p) {
    return '<div class="nm' + (p.dropped ? ' out' : '') + '"><i>' + p.no + '</i>' +
           '<span>' + esc(p.name) + '</span></div>';
  }).join('');
}

/* ── 開始比賽 ───────────────────────────────────────── */
/* 設定頁與對戰空頁各有一顆，走同一條路 ——
   名單都齊了卻還沒排對戰的時候，不應該把人趕回設定頁才能開賽。 */
function startEvent() {
  var st = store.get();
  var list = drafting || st.players;
  if (list.length < 2) { toast('至少要兩位選手', true); return; }
  if (st.matches.length) {
    ask({ title: '重新開始比賽？',
          body: '已經有比賽在進行。重新開始會清掉所有配對與勝負，名單留著，回到還沒排第一輪的狀態。',
          yes: '重新開始' },
        function () { markUndo('重新開始比賽'); doStart(list); });
    return;
  }
  doStart(list);
}
function doStart(list) {
  store.commit(function (s) {
    readForm(s);
    s.players = list.map(function (p, i) {
      return { id: p.id, no: i + 1, name: p.name, dropped: false };
    });
    s.matches = [];
    s.timer = { running: false, endsAt: 0, remainMs: 0, durMs: 0, round: null };
    s.phase = 'running';
  });
  drafting = null;
  makeNextRound(true);
}
el('btnStart').onclick = startEvent;
el('btnStartHere').onclick = startEvent;

/* ── 賽事清單 ─────────────────────────────────────────
   切換＝把現在這一場收進清單、把目標那一場拿出來當現在。
   兩邊對調，沒有重複存兩份。

   開著房的時候切換，房間會跟著換成新的那一場 —— 房號不變，
   所以副控與選手的畫面會整個換掉。那通常正是想要的（同一臺筆電
   接著辦下一場），但要先講一聲。 */
function eventTitle(e) {
  var bits = [e.host, e.name || '（未命名）', e.date].filter(Boolean).join('　');
  var tail = e.players ? '　' + e.players + ' 人' : '';
  if (e.rounds) tail += ' · ' + e.rounds + ' 輪';
  return bits + tail;
}

function paintEvents(st) {
  var lib = S.libLoad();
  var opts = ['<option value="' + esc(st.id) + '">' +
              esc(eventTitle({ host: st.event.host, name: st.event.name, date: st.event.date,
                               players: st.players.length,
                               rounds: E.countRounds(st.matches) })) +
              '　←　現在</option>'];
  lib.forEach(function (e) {
    opts.push('<option value="' + esc(e.id) + '">' + esc(eventTitle(e)) + '</option>');
  });
  /* 每次 render 都重建 <select> 會把使用者正在拉開的選單關掉 ——
     內容真的變了才重畫。 */
  var sig = opts.join('');
  if (el('fEvent')._sig !== sig) {
    el('fEvent')._sig = sig;
    el('fEvent').innerHTML = sig;
  }
  el('fEvent').value = st.id;
  el('btnDelEvent').disabled = !lib.length;   /* 只剩一場就不給刪，免得刪到空 */
  el('eventHint').innerHTML = lib.length
    ? '另外還有 <b>' + lib.length + '</b> 場存在這臺電腦裡。切換不會動到任何一場的成績。'
    : '目前只有這一場。按「新增一場」會把現在這場收起來，開一個全新的。';
}

function switchEvent(id) {
  var st = store.get();
  if (id === st.id) return;

  /* 順序很要緊：一定要先確定「現在這一場收得下」，才去把目標拿出來。
     反過來做的話，收不下的時候目標已經被移出清單，兩邊就都沒了。 */
  var exists = S.libLoad().some(function (e) { return e.id === id; });
  if (!exists) { toast('找不到那一場，可能已經被刪掉了', true); paintEvents(st); return; }

  var mine = JSON.parse(JSON.stringify(st));
  if (!S.libStash(mine)) {
    toast('瀏覽器空間滿了，收不下現在這一場 —— 請先匯出存檔或刪掉幾場舊的', true);
    paintEvents(st);
    return;
  }
  var next = S.libTake(id);
  if (!next) { toast('那一場讀不出來', true); paintEvents(st); return; }
  markUndo('切換賽事');
  store.replace(next);
  drafting = null;
  fillForm._once = false;
  fillForm(store.get());
  toast('已切到「' + (next.event.name || '未命名') + '」');
}

el('fEvent').onchange = function () { switchEvent(el('fEvent').value); };

el('btnNewEvent').onclick = function () {
  var st = store.get();
  ask({ title: '新增一場？',
        body: '現在這一場會完整收進賽事清單（成績、設定都留著），然後開一個空白的新場次。隨時可以切回來。',
        yes: '新增一場' }, function () {
    var mine = JSON.parse(JSON.stringify(store.get()));
    if (!S.libStash(mine)) {
      toast('瀏覽器空間滿了 —— 請先刪掉幾場舊的，或匯出存檔', true);
      return;
    }
    markUndo('新增一場');
    var b = S.blank();
    b.event.host = st.event.host;      /* 同一家店連著辦，主辦單位帶過去 */
    b.config = JSON.parse(JSON.stringify(st.config));
    store.replace(b);
    drafting = null;
    fillForm._once = false;
    fillForm(store.get());
    goTab('tSetup');
    toast('新的一場開好了　賽制與主辦單位都照抄上一場');
  });
};

el('btnDelEvent').onclick = function () {
  var st = store.get();
  var lib = S.libLoad();
  if (!lib.length) { toast('只剩這一場，刪掉就沒有了', true); return; }
  ask({ title: '刪掉「' + (st.event.name || '未命名') + '」？',
        body: '這一場的名單與所有勝負都會消失，而且不在「還原上一步」的範圍內。清單裡的其他場次不受影響。',
        yes: '刪掉' }, function () {
    var next = S.libTake(lib[0].id);
    store.replace(next);
    drafting = null;
    fillForm._once = false;
    fillForm(store.get());
    toast('已刪掉，現在切到「' + (next.event.name || '未命名') + '」');
  });
};

/* ── 還原點 ───────────────────────────────────────────
   會清掉東西的動作，動手之前先存一份。兩段確認擋不住
   「我以為我按的是別顆」，而現場那一下就是整場的成績。 */
function markUndo(what) {
  S.saveUndo(JSON.parse(JSON.stringify(store.get())), what);
  paintUndo();
}
function paintUndo() {
  var u = S.loadUndo();
  el('undoBar').hidden = !u;
  if (u) {
    var mins = Math.round((Date.now() - u.at) / 60000);
    el('undoWhat').textContent = u.what +
      (mins < 1 ? '（剛剛）' : '（' + mins + ' 分鐘前）');
  }
}
el('btnUndo').onclick = function () {
  var u = S.loadUndo();
  if (!u) return;
  ask({ title: '還原上一步？',
        body: '會回到「' + u.what + '」之前的狀態，那之後做的都不算。',
        yes: '還原' }, function () {
    /* 還原本身也要能反悔：把現在這份存成新的還原點 */
    var now = JSON.parse(JSON.stringify(store.get()));
    store.replace(u.state);
    drafting = null;
    S.saveUndo(now, '還原');
    paintUndo();
    toast('已回到「' + u.what + '」之前。再按一次「還原上一步」可以回到剛才');
  });
};

/* 會清掉東西的動作，動手之前先問一次。
   原本是「同一顆按兩次」—— 現場的回饋是沒有人看得懂：畫面上沒有任何
   東西在等第二下，提示條看起來就只是「按了沒反應」。改成明確的兩顆
   按鈕，而且確定鍵直接寫出要做什麼（「重新開始」而不是「確定」），
   看的人不用回想剛才按到的是哪一顆。

   非同步 —— 後續動作要放進 go 裡面。
     o.title  一句話講清楚要做什麼，帶問號
     o.body   代價。使用者真正要判斷的是這一句
     o.yes    確定鍵上的字，用動詞
     o.warn   true = 金色（注意但不會清掉東西），預設紅色         */
var askGo = null;
function ask(o, go) {
  askGo = go;
  el('askTitle').textContent = o.title;
  el('askBody').textContent = o.body;
  el('askYes').textContent = o.yes;
  el('ask').querySelector('.ask-box').className = 'ask-box' + (o.warn ? ' warn' : '');
  el('ask').hidden = false;
  /* 先落在「取消」上 —— 鍵盤直接按 Enter 不應該就把東西清掉 */
  el('askNo').focus();
}
function askClose() { askGo = null; el('ask').hidden = true; }
el('askNo').onclick = askClose;
el('ask').onclick = function (e) { if (e.target === el('ask')) askClose(); };
el('askYes').onclick = function () {
  var go = askGo;
  askClose();
  if (go) go();
};
function askOpen() { return !el('ask').hidden; }
/* Esc 一律當成取消。在投影窗裡 Esc 本來是留給「離開全螢幕」的，
   但框開著的時候它是畫面上唯一的東西，先把它收掉才合理。 */
addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && askOpen()) { askClose(); e.stopImmediatePropagation(); }
});

/* ── 產生下一輪 ─────────────────────────────────────── */
function makeNextRound(silent) {
  var st = store.get();
  var res = E.nextRound(st);

  if (res.error) { toast('配不出來：' + res.error, true); return false; }
  if (res.done) {
    store.commit(function (s) { s.phase = 'done'; });
    toast(res.notes && res.notes[0] ? res.notes[0] : '比賽結束');
    goTab('tRank');
    return false;
  }

  var chk = E.check(res.matches);
  if (!chk.ok) { toast('配對有問題（同一人被排兩桌），請回報這個狀況', true); return false; }

  var round = res.matches[0].round;
  if (typeof round !== 'string') {
    round = E.countRounds(st.matches) + 1;
    res.matches.forEach(function (m) { m.round = round; });
  }

  store.commit(function (s) {
    s.matches = s.matches.concat(res.matches);
    var mins = s.config.minutes;
    s.timer = { running: false, endsAt: 0, remainMs: mins * 60000, durMs: mins * 60000, round: round };
  });

  if (res.notes && res.notes.length) toast(res.notes.join('；'), true);
  else if (!silent) toast(roundLabel(round) + '　已排好 ' + res.matches.filter(function (m) {
    return m.b !== null; }).length + ' 桌');
  goTab('tPlay');
  return true;
}

el('btnNext').onclick = function () {
  var st = store.get();
  var r = currentRound(st);
  var open = r === null ? 0
    : matchesOf(st, r).filter(function (m) { return !m.result; }).length;
  if (!open) { makeNextRound(); return; }
  /* 不是清東西，是「現在排就少算」—— 用金色，跟紅色的那幾個分開 */
  ask({ title: '還有 ' + open + ' 桌沒回報',
        body: '現在排下一輪，這 ' + open + ' 桌就不會有勝負，那幾位的戰績會少算。',
        yes: '仍要排下一輪', warn: true },
      function () { makeNextRound(); });
};

el('btnRepair').onclick = function () {
  var st = store.get();
  var r = currentRound(st);
  if (r === null) return;
  ask({ title: '重排' + roundLabel(r) + '？',
        body: '會清掉' + roundLabel(r) + '已經回報的勝負，重新配一次對手。之前幾輪不受影響。',
        yes: '重排這一輪' }, function () {
    markUndo('重排' + roundLabel(r));
    store.commit(function (s) {
      s.matches = s.matches.filter(function (m) { return m.round !== r; });
    });
    makeNextRound();
  });
};

/* ── 回報勝負 ───────────────────────────────────────── */
/* ── 手動換位 ─────────────────────────────────────────
   幾乎每場都會遇到：兩個人是同店隊友、有人遲到要補進來、
   某位選手需要固定靠門的桌。原本唯一的辦法是「重排這一輪」再賭一次，
   賭不到就一直重排。

   做成「點兩個人就交換」而不是拖曳 —— 現場常常是單手拿著手機或
   一手還拿著紙條，拖曳在觸控上又特別容易放錯位置。 */
var swapMode = false, swapFrom = null;

el('btnSwap').onclick = function () {
  var st = store.get();
  if (currentRound(st) === null) { toast('還沒排對戰，沒有位子可以換', true); return; }
  if (net.role === 'guest' || net.role === 'watch') {
    toast('換位子要在主控那臺做', true); return;
  }
  swapMode = !swapMode; swapFrom = null;
  paintSwap();
  toast(swapMode ? '點兩個人就交換位子；再按一次「手動換位」結束'
                 : '已結束手動換位');
};

function paintSwap() {
  document.body.classList.toggle('swapping', swapMode);
  el('swapBar').hidden = !swapMode;
  el('btnSwap').classList.toggle('on', swapMode);
  if (!swapMode) return;
  var st = store.get();
  el('swapPick').textContent = swapFrom
    ? '已選：' + nameOf(st, swapFrom) + '　再點另一個人就交換'
    : '還沒選人';
  document.querySelectorAll('#matchList .sd').forEach(function (b) {
    b.classList.toggle('picked', !!swapFrom && b.dataset.id === swapFrom);
  });
}

/* 交換兩個人的位子。被動到的那兩桌一律清掉勝負 ——
   對手變了，原本回報的結果就不算數，留著只會變成錯的成績。 */
function doSwap(idA, idB) {
  var st = store.get(), r = currentRound(st);
  if (idA === idB) return;
  store.commit(function (s) {
    var touched = [];
    s.matches.forEach(function (m) {
      if (m.round !== r) return;
      if (m.a === idA) { m.a = idB; touched.push(m); }
      else if (m.a === idB) { m.a = idA; touched.push(m); }
      if (m.b === idA) { m.b = idB; touched.push(m); }
      else if (m.b === idB) { m.b = idA; touched.push(m); }
    });
    touched.forEach(function (m) {
      if (m.b === null || m.b === undefined) { m.result = 'bye'; m.games = []; return; }
      m.result = null; m.games = [];
    });
  });
  toast('已交換 ' + nameOf(st, idA) + ' 與 ' + nameOf(st, idB) + '　那兩桌的勝負已清空');
}

el('matchList').addEventListener('click', function (e) {
  var u = e.target.closest('.undo');
  if (u) { reportGame(u.dataset.t, null); return; }
  var d = e.target.closest('.sd,.dw');
  if (!d || d.classList.contains('bye') || !d.dataset.t) return;

  if (swapMode) {
    if (!d.dataset.id) return;                 /* 平手那一格不是人 */
    if (!swapFrom) { swapFrom = d.dataset.id; paintSwap(); return; }
    var from = swapFrom;
    swapFrom = null;
    doSwap(from, d.dataset.id);
    paintSwap();
    return;
  }
  reportGame(d.dataset.t, d.dataset.r);
});

/* want：'a' | 'b' | 'draw' 記一局，null 退一局。
   規則一律問 engine.playGame —— 主控與副控走同一條，兩邊不會有分歧。 */
function reportGame(table, want) {
  var st = store.get(), r = currentRound(st);
  if (net.role === 'watch') { toast('查詢模式只能看，回報請找副控', true); return; }

  var m = null;
  matchesOf(st, r).forEach(function (x) { if (x.table === table) m = x; });
  if (!m || m.b === null || m.b === undefined) return;

  var next = E.playGame(m, want === null ? null : want);
  if (!next) {
    if (want !== null) toast('這一場已經分出勝負了 —— 要改請先按「退一局」', true);
    return;
  }

  if (net.role === 'guest') {
    /* 加入者不改本機，送給伺服器；伺服器套用完會把新狀態推回來 */
    net.sendMatch(r, table, next.games, next.result).catch(function () {});
    return;
  }
  store.commit(function (s) {
    s.matches.forEach(function (x) {
      if (x.round === r && x.table === table) { x.games = next.games; x.result = next.result; }
    });
  });
}

/* ── 計時 ───────────────────────────────────────────── */
el('btnTimer').onclick = function () {
  store.commit(function (s) {
    var t = s.timer;
    if (t.running) { t.remainMs = t.endsAt - Date.now(); t.running = false; }
    else { t.endsAt = Date.now() + (t.remainMs || t.durMs); t.running = true; }
  });
};
function remainMs(st) {
  var t = st.timer;
  return t.running ? (t.endsAt - Date.now()) : (t.remainMs || 0);
}

/* ── 退賽 ───────────────────────────────────────────── */
el('rankView').addEventListener('click', function (e) {
  var b = e.target.closest('.dropb');
  if (!b) return;
  var id = b.dataset.id;
  store.commit(function (s) {
    s.players.forEach(function (p) { if (p.id === id) p.dropped = !p.dropped; });
  });
});

/* ── 匯出 / 匯入 / 清除 ─────────────────────────────── */
el('btnExport').onclick = function () {
  var st = store.get();
  var name = fileStem(st) + '.json';
  var blob = new Blob([S.toJSON(st)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/\s+/g, '_');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  toast('已匯出 ' + a.download);
};
/* ── 自動存檔 ─────────────────────────────────────────
   「一步還原」擋得住誤按，擋不住瀏覽器資料被清掉或整臺當機。
   選一個資料夾，之後每次換輪、每次回報就自己寫一份 JSON 進去。

   File System Access API 只有 Chrome / Edge 有，Safari 沒有 ——
   沒有的時候整顆按鈕就不出現，而不是按了才說做不到。
   授權不能保存到下次開啟（瀏覽器的規定），所以每場開始要按一次；
   按鈕文字直接寫「開啟」而不是「設定」，暗示它是每場的動作。 */
var autoDir = null, autoTimer = null, autoLast = '';

function autoSupported() { return typeof window.showDirectoryPicker === 'function'; }

function paintAuto() {
  el('autoRow').hidden = !autoSupported();
  el('btnAutoSave').textContent = autoDir ? '停止自動存檔' : '開啟自動存檔';
  el('btnAutoSave').classList.toggle('on', !!autoDir);
  el('autoMsg').innerHTML = autoDir
    ? '<span class="ok">每次變動都會寫進「' + esc(autoDir.name) + '」</span>'
    : '選一個資料夾，之後每次變動就自己存一份。瀏覽器資料被清掉也救得回來。';
}

el('btnAutoSave').onclick = function () {
  if (autoDir) {
    autoDir = null; clearTimeout(autoTimer); paintAuto();
    toast('已停止自動存檔');
    return;
  }
  window.showDirectoryPicker({ mode: 'readwrite' }).then(function (dir) {
    autoDir = dir;
    paintAuto();
    autoWrite(true);
    toast('自動存檔已開啟 —— 存到「' + dir.name + '」');
  }).catch(function () { /* 使用者自己取消，不用講話 */ });
};

/* 節流：現場一輪會有幾十次回報，每一次都寫檔沒有意義。
   兩秒內的連續變動只寫最後一次。 */
function autoWrite(now) {
  if (!autoDir) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(function () {
    var st = store.get();
    var text = S.toJSON(st);
    if (text === autoLast) return;               /* 沒變就不要一直寫 */
    var name = fileStem(st) + '.json';
    autoDir.getFileHandle(name, { create: true })
      .then(function (fh) { return fh.createWritable(); })
      .then(function (w) { return w.write(text).then(function () { return w.close(); }); })
      .then(function () { autoLast = text; })
      .catch(function (e) {
        autoDir = null; paintAuto();
        toast('自動存檔中斷了：' + (e && e.message || '') + ' —— 請重新開啟', true);
      });
  }, now ? 0 : 2000);
}

el('btnImport').onclick = function () { el('fileImport').click(); };
el('fileImport').onchange = function (e) {
  var f = e.target.files[0]; if (!f) return;
  var rd = new FileReader();
  rd.onload = function () {
    try {
      var next = S.fromJSON(rd.result);
      markUndo('匯入存檔');
      store.replace(next);
      drafting = null;
      toast('已匯入 ' + (next.event.name || '存檔'));
    } catch (err) { toast('讀不出來：' + err.message, true); }
  };
  rd.readAsText(f);
  e.target.value = '';
};
el('btnReset').onclick = function () {
  ask({ title: '全部清除？',
        body: '會刪掉名單與所有勝負，整個回到空白畫面。清完還可以按「還原上一步」救回來。',
        yes: '全部清除' }, function () {
    markUndo('全部清除重來');
    store.reset(); drafting = null;
    toast('已全部清除');
    goTab('tSetup');
  });
};
/* ── 匯出 CSV ─────────────────────────────────────────
   店家事後要把成績貼進 Excel、或上傳到官方系統，所以給的是
   「打得開就能用」的檔：欄位固定、有 BOM（不然 Excel 會把中文變亂碼）、
   換行用 CRLF（Windows 的 Excel 才不會擠成一行）。 */
function csvCell(s) {
  s = String(s === null || s === undefined ? '' : s);
  /* 以 = + - @ 開頭的字會被 Excel 當成公式執行 —— 有人取名叫「=1+1」
     不是惡意也會壞掉，真的有心的話那是一條注入路徑。
     前面補一個單引號，Excel 就當純文字，顯示出來還是原本的字。 */
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCSV(rows, suffix) {
  var st = store.get();
  var name = fileStem(st) + '_' + suffix + '.csv';
  var text = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  toast('已匯出 ' + name);
}

el('btnCsvRank').onclick = function () {
  var st = store.get();
  if (!st.players.length) { toast('還沒有名單', true); return; }
  var out = [['名次', '編號', '選手', '勝', '敗', '平手', '輪空', '積分',
              'OMW%', 'OOMW%', '狀態']];
  E.standings(st.players, st.matches, st.config.rules).forEach(function (r) {
    out.push([r.rank, r.no, r.name, r.w, r.l, r.d, r.byes, r.pts,
              (r.omw * 100).toFixed(1), (r.oomw * 100).toFixed(1),
              r.dropped ? '退賽' : '']);
  });
  downloadCSV(out, '名次');
};

/* 對戰紀錄：一場一列，含小局比分 —— BO3 打成 2-1 的話兩邊都看得到。 */
el('btnCsvLog').onclick = function () {
  var st = store.get();
  if (!st.matches.length) { toast('還沒有對戰紀錄', true); return; }
  var out = [['輪次', '桌號', '幾勝制', '選手A編號', '選手A', '選手B編號', '選手B',
              '結果', 'A小局', 'B小局', '和局', '逐局']];
  st.matches.forEach(function (m) {
    var g = E.tallyGames(E.gamesOf(m));
    var bye = (m.b === null || m.b === undefined);
    var res = bye ? '輪空（視同勝）'
            : m.result === 'a' ? nameOf(st, m.a) + ' 勝'
            : m.result === 'b' ? nameOf(st, m.b) + ' 勝'
            : m.result === 'draw' ? '平手' : '未回報';
    out.push([roundLabel(m.round), m.table, 'BO' + (m.bo || 1),
              bye ? '' : numOf(st, m.a), nameOf(st, m.a),
              bye ? '' : numOf(st, m.b), bye ? '' : nameOf(st, m.b),
              res, bye ? '' : g.a, bye ? '' : g.b, bye ? '' : g.draw,
              bye ? '' : E.gamesOf(m).map(function (x) {
                return x === 'a' ? 'A' : (x === 'b' ? 'B' : '和');
              }).join('')]);
  });
  downloadCSV(out, '對戰紀錄');
};

/* ── 桌卡 ─────────────────────────────────────────────
   一張 A4 印兩張，中間對折就能立在桌上，兩面都看得到桌號。
   現場最花時間的一段是「唸桌號、大家找位子」—— 桌卡擺好，
   選手自己就會走到定位。 */
el('btnTents').onclick = function () {
  var st = store.get(), r = currentRound(st);
  if (r === null) { toast('還沒排對戰，沒有桌卡可以印', true); return; }
  var ms = matchesOf(st, r).filter(function (m) { return m.b !== null && m.b !== undefined; })
                           .sort(byTableName);
  if (!ms.length) { toast('這一輪沒有要坐桌的場次', true); return; }

  var head = [st.event.host, st.event.name].filter(Boolean).join('　·　');
  el('tents').innerHTML = ms.map(function (m) {
    var bo = m.bo || 1;
    return '<div class="tent">' +
      '<div class="tent-hd">' + esc(head) + '<b>' + esc(roundLabel(m.round)) + '</b></div>' +
      '<div class="tent-no">' + esc(m.table) + '</div>' +
      '<div class="tent-p"><i>' + numOf(st, m.a) + '</i>' + esc(nameOf(st, m.a)) + '</div>' +
      '<div class="tent-vs">VS' + (bo > 1 ? '　·　BO' + bo + '　先贏 ' + E.winsNeeded(bo) + ' 局' : '') + '</div>' +
      '<div class="tent-p"><i>' + numOf(st, m.b) + '</i>' + esc(nameOf(st, m.b)) + '</div>' +
      '</div>';
  }).join('');

  document.body.classList.add('print-tents');
  setTimeout(function () {
    window.print();
    setTimeout(function () { document.body.classList.remove('print-tents'); }, 500);
  }, 60);
  toast('共 ' + ms.length + ' 張桌卡，一張 A4 印兩張');
};

el('btnPrint').onclick = function () {
  el('tRank').classList.add('print-me');
  setTimeout(function () { window.print(); setTimeout(function () {
    el('tRank').classList.remove('print-me'); }, 500); }, 60);
};

/* ── 使用手冊 ─────────────────────────────────────────
   左下角那顆按鈕，任何一頁都按得到。第一次打開這個網站的店家
   會找它，現場忘記下一步的人也會找它。                */
function openBook(on) {
  el('book').classList.toggle('on', on);
  el('book').scrollTop = 0;
  el('bookBody').scrollTop = 0;
}
el('btnBook').onclick = function () { openBook(true); };
el('btnBookClose').onclick = function () { openBook(false); };
el('btnBookPrint').onclick = function () { window.print(); };
addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && el('book').classList.contains('on')) openBook(false);
});

/* ── 連線 ─────────────────────────────────────────────
   開房＝這臺當主控，配對與下一輪都在這裡算。

   給出去的東西分成兩種，因為兩種人的處境完全不一樣：

     副控　拿「網址 ＋ 密碼」。密碼不寫在網址裡 —— 網址會在群組裡
           被轉來轉去，密碼才是真正的權限。他打開網址會看到一個
           只有輸入框的畫面，輸入密碼就進去。
     選手　掃投影畫面上的 QR，或拿一條把查詢碼寫在裡面的網址。
           零輸入。反正查詢碼只能看，公開也沒差。            */

function siteURL() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}
/* 自己架伺服器的店家，發出去的連結要把位址帶著走 ——
   不然副控與選手會連到官方那臺，然後看到「找不到這個房號」。
   用官方位址的時候不加，連結才短。 */
function srvTail() {
  var sv = net.server;
  return (!sv || sv === DEFAULT_SERVER) ? '' : '&srv=' + encodeURIComponent(sv);
}
function staffURL() { return siteURL() + '#sub' + srvTail(); }
function viewURL(code) { return siteURL() + '#join=' + code + srvTail(); }

function paintNet(st) {
  var pill = el('netPill');
  var role = st.role;
  pill.hidden = (role === 'off');
  pill.className = 'netpill ' + (st.bad ? 'bad' : role);
  /* 主控最在意的是「副控還在不在」—— 那件事不會有狀態變動來帶出來，
     所以直接把連著的裝置數掛在角色徽章上。扣掉自己才是「別人」。 */
  var others = Math.max(0, (st.clients || 0) - 1);
  pill.textContent = role === 'off' ? '' : ({
    host: '主控 ', guest: '副控 ', watch: '選手 '
  }[role] || '') + st.code +
    (role === 'host' && st.online ? '　+' + others + ' 臺' : '') +
    (st.online ? '' : ' · 斷線');
  pill.title = role === 'host'
    ? '目前有 ' + others + ' 臺副控或選手連著（不含這一臺）'
    : '';

  el('netOff').hidden = (role !== 'off');
  el('netOn').hidden = (role !== 'host');

  if (role === 'host') {
    el('urlStaff').value = staffURL();
    el('pwStaff').value = net.code;
    el('urlView').value = viewURL(net.viewCode);
    el('roomCode').value = net.code;
    el('viewCode').value = net.viewCode;
    el('takeKey').value = net.takeoverKey;
  }
  el('adoptOut').hidden = (role !== 'host');
  el('adoptOutHint').hidden = (role !== 'host');
  if (role === 'host') {
    el('roomHint').innerHTML =
      '兩邊都不用打房號：副控貼網址、輸入密碼；選手掃 QR。<br>' +
      '房間會在最後一次操作的 36 小時後自動消失。';
  }

  /* 角色是連線層決定的，會比「收到狀態」晚一步到 ——
     所以身分一變就要再畫一次，不然選手畫面會停在空的。 */
  var was = document.body.className;
  document.body.classList.toggle('guest',  role === 'guest');
  document.body.classList.toggle('player', role === 'watch');
  /* 密碼畫面只由它自己開關（輸入成功、或按「我不是副控」）。
     這裡不要碰 —— 之前寫成「不是選手就關掉」，結果這臺剛好是主控的話，
     一開 #staff 就被自己的狀態推播關掉，直接掉回設定頁。 */

  if (st.msg) toast(st.msg, st.bad);
  if (document.body.className !== was) render(store.get());
}

/* 複製按鈕。navigator.clipboard 在非 HTTPS 或舊瀏覽器不存在，
   所以保留 select + execCommand 那條老路 —— 現場最不需要的就是
   「複製沒反應」。 */
function copyFrom(id, btn) {
  var input = el(id), text = input.value;
  var done = function () {
    if (!btn) return;
    var old = btn.textContent;
    btn.textContent = '已複製'; btn.classList.add('done');
    setTimeout(function () { btn.textContent = old; btn.classList.remove('done'); }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { legacy(); });
  } else { legacy(); }
  function legacy() {
    try {
      input.removeAttribute('hidden');
      input.select(); input.setSelectionRange(0, 999);
      document.execCommand('copy');
      done();
    } catch (e) { toast('複製不了，請長按選取：' + text, true); }
  }
}
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-copy]');
  if (b) copyFrom(b.dataset.copy, b);
});

/* ── QR ───────────────────────────────────────────────
   自己畫，不載任何外部服務 —— 現場常常只有一支手機熱點，
   而且把房號送到第三方產圖網站也不像話。 */
function qrSVG(text, size) {
  if (!window.QR) return '';
  try { return QR.svg(text, { size: size, margin: 2, ecc: 'M' }); }
  catch (e) { return ''; }
}
/* 選手連結一律從 state.room 算，不要從連線層算 ——
   投影常常是另一個視窗，那邊沒有連線，只收得到狀態。 */
function roomViewURL(st) {
  var r = st && st.room;
  if (!r || !r.view) return '';
  return siteURL() + '#join=' + r.view + (r.srv ? '&srv=' + encodeURIComponent(r.srv) : '');
}

/* 一個容器畫一次，網址沒變就不重畫（QR 不便宜） */
function drawQR(boxId, imgId, url, size) {
  var box = el(boxId); if (!box) return;
  box.hidden = !url;
  if (!url) { box._url = ''; return; }
  if (box._url === url) return;
  box._url = url;
  el(imgId).innerHTML = qrSVG(url, size);
}

function paintQRs(st) {
  var url = roomViewURL(st);
  drawQR('pvQR', 'pvQRImg', url, 240);          /* 投影右下角常駐 */
  drawQR('sideQR', 'sideQRImg', url, 300);      /* 設定頁「給選手」那一格 */
  if (url) el('sideQRUrl').textContent = url;
}
function openBigQR() {
  var url = roomViewURL(store.get()) || el('urlView').value;
  el('qrImg').innerHTML = qrSVG(url, 640);
  el('qrUrl').textContent = url;
  el('qrbox').classList.add('on');
}
el('btnQR').onclick = openBigQR;
/* 投影頁尾那枚 QR 只有郵票大，坐後排的掃不到 —— 點一下就放到滿版。
   #qrbox 的 z-index 比投影層高，所以全螢幕投影時也蓋得上去。 */
el('pvQR').onclick = openBigQR;
el('btnQRClose').onclick = function () { el('qrbox').classList.remove('on'); };
el('qrbox').onclick = function (e) { if (e.target === el('qrbox')) el('btnQRClose').onclick(); };

/* ── 選手查詢畫面 ─────────────────────────────────────
   完全獨立的一頁。選手要知道的只有三件事：
   我在第幾桌、本輪誰打誰、我現在第幾名。                */
var meId = localStorage.getItem(ME_KEY) || '';

function paintWatch(st) {
  el('wtName').textContent = st.event.name || '賽事進行中';
  var r = currentRound(st);
  el('wtRound').textContent = r === null ? '尚未開始' : roundLabel(r);
  el('wtCode').textContent = net.code ? '查詢碼 ' + net.code : '';

  var me = null;
  st.players.forEach(function (p) { if (p.id === meId) me = p; });

  el('wtPick').hidden = !!me;
  el('wtMe').hidden = !me;

  if (!me) {
    el('meList').innerHTML = st.players.map(function (p) {
      return '<div class="nm" data-id="' + p.id + '"><i>' + p.no + '</i>' +
             '<span>' + esc(p.name) + '</span></div>';
    }).join('') || '<div class="hint">主辦還沒讀入名單。</div>';
  } else {
    el('wtPlayer').textContent = me.name;

    var mine = null;
    matchesOf(st, r).forEach(function (m) { if (m.a === meId || m.b === meId) mine = m; });

    if (!mine) {
      el('wtLead').textContent = ''; el('wtTail').textContent = '';
      el('wtTable').textContent = r === null ? '尚未開始' : '本輪沒有你的場次';
      el('wtTable').style.fontSize = '26px';
      el('wtOpp').textContent = '';
    } else if (mine.b === null || mine.b === undefined) {
      el('wtLead').textContent = '本輪'; el('wtTail').textContent = '';
      el('wtTable').textContent = '輪空';
      el('wtTable').style.fontSize = '';
      el('wtOpp').innerHTML = '這一輪不用打，直接算一勝。';
    } else {
      el('wtLead').textContent = '你在第'; el('wtTail').textContent = '桌';
      el('wtTable').textContent = mine.table;
      el('wtTable').style.fontSize = '';
      var oppId = (mine.a === meId) ? mine.b : mine.a;
      var res = mine.result;
      var mineIsA = (mine.a === meId);
      var tail = !res ? '' :
        res === 'draw' ? '　<b>平手</b>' :
        ((res === 'a') === mineIsA ? '　<b>你贏了</b>' : '　你輸了');
      /* BO 制要看得到目前幾比幾 —— 選手最想知道的就是「還差幾局」 */
      var mbo = mine.bo || 1;
      if (mbo > 1) {
        var mg = E.tallyGames(E.gamesOf(mine));
        tail += '　<span class="sc">' + (mineIsA ? mg.a + '-' + mg.b : mg.b + '-' + mg.a) +
                (mg.draw ? '（平 ' + mg.draw + '）' : '') +
                '　BO' + mbo + '　先贏 ' + E.winsNeeded(mbo) + ' 局</span>';
      }
      el('wtOpp').innerHTML = '對手　<b>' + esc(nameOf(st, oppId)) + '</b>' + tail;
    }

    var rows = E.standings(st.players, st.matches, st.config.rules);
    var row = null;
    rows.forEach(function (x) { if (x.id === meId) row = x; });
    el('wtStat').textContent = row
      ? '目前第 ' + row.rank + ' 名　' + row.w + ' 勝 ' + row.l + ' 敗' +
        (row.d ? ' ' + row.d + ' 平' : '') + '　' + row.pts + ' 分'
      : '';
  }

  /* 成績單只在真的有成績之後才出現 —— 還沒打就給一張空的沒有意義 */
  var played = me && st.matches.some(function (m) {
    return (m.a === meId || m.b === meId) && m.result;
  });
  el('wtCardSec').hidden = !played;
  if (played) { try { drawCard(st, me); } catch (e) { el('wtCardSec').hidden = true; } }

  /* 我的每一輪：打過誰、幾比幾。輪空也要列出來，不然選手會以為漏了一輪。 */
  var mine = me ? st.matches.filter(function (m) { return m.a === meId || m.b === meId; }) : [];
  el('wtMineSec').hidden = !mine.length;
  if (mine.length) {
    el('wtMine').innerHTML = mine.map(function (m) {
      var bye = (m.b === null || m.b === undefined);
      var iAmA = (m.a === meId);
      var g = E.tallyGames(E.gamesOf(m));
      var oppId = iAmA ? m.b : m.a;
      var win = !bye && m.result && m.result !== 'draw' && ((m.result === 'a') === iAmA);
      var lose = !bye && m.result && m.result !== 'draw' && !win;
      var tag = bye ? '<span class="s">輪空 · 視同勝</span>'
              : !m.result ? '<span class="s">進行中</span>'
              : m.result === 'draw' ? '<span class="s">平手</span>'
              : '<span class="s">' + (win ? '勝' : '敗') + '</span>';
      var sc = (!bye && (m.bo || 1) > 1)
             ? '<span class="s sc">' + (iAmA ? g.a + '-' + g.b : g.b + '-' + g.a) + '</span>' : '';
      return '<div class="wr' + (win ? ' won' : lose ? ' lost' : '') + '">' +
        '<span class="t">' + esc(String(roundLabel(m.round)).replace('第 ', '').replace(' 輪', '')) + '</span>' +
        '<span class="p">' + (bye ? '—' : esc(nameOf(st, oppId))) + '</span>' + sc + tag +
        '</div>';
    }).join('');
  }

  /* 本輪對戰（唯讀） */
  var ms = (r === null) ? [] : matchesOf(st, r);
  el('wtMatchTitle').textContent = r === null ? '本輪對戰' : roundLabel(r) + '　對戰';
  var wrm = recMap(st);
  /* 這裡不要再用 r 當變數名 —— 外面的 r 是「第幾輪」 */
  var who = function (id, cls) {
    var rec = wrm[id];
    return '<span class="p' + cls + '">' + esc(nameOf(st, id)) +
           (rec ? '<em class="num">' + rec.rec + '</em>' : '') + '</span>';
  };
  el('wtMatches').innerHTML = ms.length ? ms.map(function (m) {
    var isMine = (m.a === meId || m.b === meId);
    var bye = (m.b === null || m.b === undefined);
    var ca = m.result === 'a' ? ' win' : (m.result === 'b' ? ' lose' : '');
    var cb = m.result === 'b' ? ' win' : (m.result === 'a' ? ' lose' : '');
    var mg = E.tallyGames(E.gamesOf(m));
    var sc = (m.bo || 1) > 1 ? '<span class="x sc">' + mg.a + '-' + mg.b + '</span>' : '<span class="x">VS</span>';
    return '<div class="wr' + (isMine ? ' mine' : '') + '">' +
      '<span class="t">' + esc(m.table) + '</span>' + who(m.a, ca) +
      (bye ? '<span class="s">輪空</span>' : sc + who(m.b, cb)) +
      '</div>';
  }).join('') : '<div class="hint">還沒排對戰。</div>';

  /* 名次（唯讀） */
  var rk = E.standings(st.players, st.matches, st.config.rules);
  el('wtRank').innerHTML = rk.length ? rk.map(function (x) {
    return '<div class="wr' + (x.id === meId ? ' mine' : '') + '">' +
      '<span class="n">' + x.rank + '</span>' +
      '<span class="p">' + esc(x.name) + (x.dropped ? '（退賽）' : '') + '</span>' +
      '<span class="s">' + x.w + '-' + x.l + (x.d ? '-' + x.d : '') + '</span>' +
      '<span class="s">' + x.pts + ' 分</span>' +
      '</div>';
  }).join('') : '<div class="hint">還沒有成績。</div>';
}

/* ── 賽後成績單 ───────────────────────────────────────
   選手會自己轉發的東西 —— 對店家等於免費宣傳，所以主辦單位要在上面。
   用 Canvas 畫而不是截圖：截圖會把手機的狀態列、瀏覽器網址列一起帶進去，
   而且每支手機的比例都不一樣。這裡固定 1080×1350（IG 直式），
   誰的手機畫出來都一樣。 */
function drawCard(st, me) {
  var cv = el('wtCard'), g = cv.getContext('2d');
  var W = cv.width, H = cv.height;
  var dark = st.theme !== 'light';
  var bg = dark ? '#0B0D12' : '#FFFFFF';
  var fg = dark ? '#FFFFFF' : '#0B0D12';
  var dim = dark ? 'rgba(255,255,255,.62)' : 'rgba(11,13,18,.62)';
  var line = dark ? 'rgba(255,255,255,.16)' : 'rgba(11,13,18,.14)';
  var CN = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
  var MO = '"SF Mono",Menlo,Consolas,monospace';

  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  /* 頂部品牌漸層條 —— 全站唯一用漸層的地方，成績單也照這條規矩 */
  var grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#2563FF'); grad.addColorStop(.52, '#A855F7');
  grad.addColorStop(1, '#FF2ED1');
  g.fillStyle = grad; g.fillRect(0, 0, W, 16);

  var rows = E.standings(st.players, st.matches, st.config.rules);
  var mine = null;
  rows.forEach(function (r) { if (r.id === me.id) mine = r; });
  if (!mine) return;

  var y = 120;
  g.textAlign = 'left';
  g.fillStyle = dim; g.font = '34px ' + CN;
  g.fillText([st.event.host, st.event.name].filter(Boolean).join('　·　') || 'NICEPLAY', 80, y);
  y += 54;
  g.fillStyle = dim; g.font = '30px ' + MO;
  g.fillText(st.event.date || '', 80, y);

  /* 名次：整張圖最大的一個數字 */
  y += 170;
  g.fillStyle = fg; g.font = '900 220px ' + MO;
  g.fillText(String(mine.rank), 80, y);
  var w = g.measureText(String(mine.rank)).width;
  g.fillStyle = dim; g.font = '44px ' + CN;
  g.fillText('名', 80 + w + 20, y);

  y += 90;
  g.fillStyle = fg; g.font = '900 76px ' + CN;
  g.fillText(me.name, 80, y);
  if (me.team) {
    y += 52;
    g.fillStyle = dim; g.font = '36px ' + CN;
    g.fillText(me.team, 80, y);
  }

  y += 80;
  g.strokeStyle = line; g.lineWidth = 2;
  g.beginPath(); g.moveTo(80, y); g.lineTo(W - 80, y); g.stroke();

  /* 三個數字並排 */
  y += 100;
  var stats = [
    [mine.w + '-' + mine.l + (mine.d ? '-' + mine.d : ''), '戰績'],
    [String(mine.pts), '積分'],
    [(mine.omw * 100).toFixed(1), 'OMW%']
  ];
  stats.forEach(function (s, i) {
    var x = 80 + i * ((W - 160) / 3);
    g.fillStyle = fg; g.font = '700 68px ' + MO;
    g.fillText(s[0], x, y);
    g.fillStyle = dim; g.font = '30px ' + CN;
    g.fillText(s[1], x, y + 44);
  });

  /* 每一輪打了誰 */
  y += 130;
  g.fillStyle = dim; g.font = '30px ' + MO;
  g.fillText('EVERY ROUND', 80, y);
  y += 20;
  var mineMs = st.matches.filter(function (m) { return m.a === me.id || m.b === me.id; });
  mineMs.slice(0, 9).forEach(function (m) {
    y += 62;
    var bye = (m.b === null || m.b === undefined);
    var iAmA = (m.a === me.id);
    var opp = bye ? '—' : nameOf(st, iAmA ? m.b : m.a);
    var gm = E.tallyGames(E.gamesOf(m));
    var tag = bye ? (m.result === 'noshow' ? '未到' : '輪空')
            : !m.result ? '進行中'
            : m.result === 'draw' ? '平手'
            : (((m.result === 'a') === iAmA) ? '勝' : '敗');
    g.fillStyle = dim; g.font = '34px ' + MO;
    g.fillText(String(roundLabel(m.round)), 80, y);
    g.fillStyle = fg; g.font = '38px ' + CN;
    g.fillText(opp, 260, y);
    g.textAlign = 'right';
    if (!bye && (m.bo || 1) > 1) {
      g.fillStyle = dim; g.font = '32px ' + MO;
      g.fillText(iAmA ? gm.a + '-' + gm.b : gm.b + '-' + gm.a, W - 200, y);
    }
    g.fillStyle = (tag === '勝') ? '#FF2ED1' : dim;
    g.font = '700 36px ' + CN;
    g.fillText(tag, W - 80, y);
    g.textAlign = 'left';
  });

  g.fillStyle = dim; g.font = '28px ' + MO;
  g.fillText('NICEPLAY · niceplay.transtation.org', 80, H - 60);
}

el('btnWtCard').onclick = function () {
  var cv = el('wtCard'), st = store.get();
  try {
    cv.toBlob(function (blob) {
      if (!blob) { toast('這支瀏覽器存不了圖，長按上面那張圖也可以存', true); return; }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileStem(st) + '_成績單.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('已存成圖片');
    }, 'image/png');
  } catch (e) { toast('存不了圖，長按上面那張圖也可以存', true); }
};

el('meList').addEventListener('click', function (e) {
  var d = e.target.closest('.nm'); if (!d) return;
  meId = d.dataset.id;
  localStorage.setItem(ME_KEY, meId);
  render(store.get());
});
el('btnNotMe').onclick = function () {
  meId = ''; localStorage.removeItem(ME_KEY); render(store.get());
};
el('btnWtTheme').onclick = function () {
  store.commit(function (s) { s.theme = (s.theme === 'light') ? 'dark' : 'light'; });
};
el('btnWtLeave').onclick = function () {
  ask({ title: '離開查詢畫面？',
        body: '離開之後就查不到自己的桌號了，要重新掃一次 QR 或跟主辦拿連結。',
        yes: '離開' }, function () {
    meId = ''; localStorage.removeItem(ME_KEY);
    net.leave();
    location.hash = '';
    location.reload();
  });
};

/* ── 副控加入畫面 ─────────────────────────────────────── */
function openStaffGate(on) {
  document.body.classList.toggle('staffgate', on);
  if (on) setTimeout(function () { el('stCode').focus(); }, 60);
}
el('btnStJoin').onclick = function () {
  var code = el('stCode').value.trim().toUpperCase();
  if (code.length < 4) { el('stMsg').innerHTML = '<span class="bad">密碼是六碼</span>'; return; }
  el('stMsg').textContent = '連線中……';
  net.join(code).then(function (c) {
    if (c.role === 'watch') {
      /* 拿到的是選手查詢碼 —— 那就給他選手畫面，不要卡在這裡 */
      openStaffGate(false);
      location.hash = 'join=' + code;
      return;
    }
    openStaffGate(false);
    location.hash = '';
    goTab('tPlay');
    toast('進來了 —— 打完一桌就點贏的那一邊');
  }).catch(function (e) {
    el('stMsg').innerHTML = '<span class="bad">' + esc(e.message) + '</span>';
  });
};
el('stCode').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') el('btnStJoin').onclick();
});
el('btnStBack').onclick = function () {
  openStaffGate(false); location.hash = '';
};

el('fServer').oninput = function () {
  var v = el('fServer').value.trim();
  localStorage.setItem(SRV_KEY, v);
  net.setServer(v);
};

el('btnHost').onclick = function () {
  net.host(store.get()).then(function () {
    var srv = (net.server && net.server !== DEFAULT_SERVER) ? net.server : '';
    store.commit(function (s) { s.room = { view: net.viewCode, srv: srv }; });
    toast('開好了 —— 網址跟密碼給副控，選手掃右邊那個 QR');
  }).catch(function (e) { toast('開房失敗：' + e.message, true); });
};
el('btnJoin').onclick = function () {
  var code = el('fJoin').value.trim();
  if (!code) { toast('先輸入房號', true); return; }
  net.join(code).then(function (c) {
    if (c.role === 'watch') { location.hash = 'join=' + code.toUpperCase(); return; }
    goTab('tPlay');
  }).catch(function (e) { toast('加入失敗：' + e.message, true); });
};
el('btnAdopt').onclick = function () {
  var key = el('adoptKey').value.trim();
  if (!key) { toast('先貼上接管碼', true); return; }
  net.adopt(key).then(function (r) {
    el('adoptKey').value = '';
    /* 接管的是「連線」，不是「賽況」—— 賽況以這臺為準（多半是剛匯入的存檔），
       接管之後推一次就把它同步上去，副控與選手會立刻跟上。 */
    store.commit(function (s) {
      s.room = { view: r.conn.viewCode, srv: (net.server !== DEFAULT_SERVER ? net.server : '') };
    });
    toast('接回房間 ' + r.conn.code + ' —— 副控密碼與選手 QR 都不用重發');
  }).catch(function (e) { toast('接管失敗：' + e.message, true); });
};

el('btnLeave').onclick = function () {
  ask({ title: '離線？',
        body: '這臺會變回單機。副控跟選手的畫面不會再跟著你更新，成績都還在。',
        yes: '離線', warn: true }, function () {
    net.leave();
    store.commit(function (s) { s.room = null; });
  });
};

/* ── 網址路由 ─────────────────────────────────────────
   #staff     副控：輸入密碼的畫面
   #join=XXX  選手：直接進查詢畫面，什麼都不用打
   #present   投影                                     */
function routeHash() {
  var h = location.hash.replace(/^#/, '');

  /* 連結裡帶了伺服器位址就先套用，並記在這臺裝置上 */
  var sm = h.match(/[&?]srv=([^&]+)/);
  if (sm) {
    var sv = decodeURIComponent(sm[1]);
    net.setServer(sv);
    try { localStorage.setItem(SRV_KEY, sv); } catch (e) {}
    el('fServer').value = sv;
    h = h.replace(/[&?]srv=[^&]+/, '');
  }

  var m = h.match(/^join=([A-Za-z0-9]{4,12})$/);
  if (m) {
    var code = m[1].toUpperCase();
    openStaffGate(false);
    /* 已經在同一個房間了（重整、或從主畫面點回來）就接回去，
       不要重新 join —— 但一定要走 resume，因為身分的畫面切換
       是掛在連線狀態上的，不呼叫就會停在控制台那一頁。 */
    var p = (net.role === 'watch' && net.code === code) ? net.resume() : net.join(code);
    p.catch(function (e) {
      toast('這個查詢連結沒有用了：' + e.message, true);
      location.hash = '';
    });
    return true;
  }
  /* #staff 是舊名，留著讓已經發出去的連結還能用 */
  if (h === 'sub' || h === 'staff') { openStaffGate(true); return true; }
  return false;
}

/* ── 主題 ─────────────────────────────────────────────
   存在 state 裡而不是各自的 localStorage —— 這樣控制台切換，
   投影視窗會透過 BroadcastChannel 一起變，不用兩邊各按一次。 */
function applyTheme(st) {
  var t = st.theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  el('btnTheme').textContent = t === 'light' ? '☀' : '◐';
  el('btnTheme').title = t === 'light' ? '目前淺色，點一下換深色' : '目前深色，點一下換淺色';
  var meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#F5F6FA' : '#0B0D12');
}
el('btnTheme').onclick = function () {
  store.commit(function (s) { s.theme = (s.theme === 'light') ? 'dark' : 'light'; });
};

/* ── 投影模式 ─────────────────────────────────────────
   「放大投影」開一個新視窗，原本這個分頁繼續當控制台。
   兩邊靠 BroadcastChannel 同步，不需要伺服器。
   把新視窗拖到接電視的那個顯示器、按全螢幕就完成了。      */
var isPopup = false;           /* 這個視窗是被控制台開出來的投影窗 */

function enterPresent(on) {
  document.body.classList.toggle('present', on);
  if (on) location.hash = 'present';
  else if (location.hash === '#present') history.replaceState(null, '', location.pathname);
  render(store.get());
}

el('btnPresent').onclick = function () {
  var w = null;
  try {
    /* 具名視窗：重複按不會一直開新的，會把原本那個帶到前面 */
    w = window.open(location.pathname + '#present', 'niceplay-present');
  } catch (e) { w = null; }

  if (w) {
    try { w.focus(); } catch (e) {}
    toast('投影視窗已開啟 —— 把它拖到投影機那個螢幕，再按視窗裡的「全螢幕」');
  } else {
    /* 被擋掉就退回原本的同視窗放大，至少不會卡住 */
    enterPresent(true);
    toast('瀏覽器擋掉了新視窗，改成在這個分頁放大。按 Esc 回到控制台', true);
  }
};

el('btnFull').onclick = function () {
  var d = document.documentElement;
  if (document.fullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
  } else if (d.requestFullscreen) {
    d.requestFullscreen().catch(function () {});
  }
};

/* 關掉投影窗有兩個坑，兩個都會讓現場很難看：

   一、全螢幕的時候直接 window.close()。macOS 上全螢幕視窗自己佔一個桌面，
       視窗被腳本關掉時整個桌面會塌掉，畫面黑一下、選單列亂跳 ——
       所以一定要先退出全螢幕、等動畫跑完，再關。
   二、close() 不見得成功。只有腳本開出來的視窗關得掉；如果這個分頁是
       重新整理過、被工作階段還原、或使用者自己複製出來的，close() 會被
       瀏覽器無聲擋掉。擋掉就退回控制台畫面，不要讓人卡在一個關不掉的投影頁。 */
function closePresent() {
  var done = function () {
    if (!isPopup) { enterPresent(false); return; }
    try { window.close(); } catch (e) {}
    /* 沒關掉就是被擋了 —— 至少讓它變回可以操作的控制台 */
    setTimeout(function () {
      if (!window.closed) {
        isPopup = false;
        enterPresent(false);
        el('btnClosePv').textContent = '回到控制台';
        toast('這個視窗不是投影窗開出來的，瀏覽器不讓程式關它 —— 已經切回控制台', true);
      }
    }, 400);
  };
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().then(done, done);
    setTimeout(done, 700);          /* 有些瀏覽器不回 promise，補一個保險 */
    return;
  }
  done();
}

/* 比賽進行中誤按會直接讓全場失去畫面，所以先問一次 */
el('btnClosePv').onclick = function () {
  ask({ title: '關閉投影？',
        body: '全場的畫面會立刻消失。成績不受影響，關掉之後還可以再開。',
        yes: '關閉投影' }, function () { closePresent(); });
};

addEventListener('keydown', function (e) {
  if (!document.body.classList.contains('present')) return;
  if (askOpen()) return;            /* 框開著的時候，鍵盤都歸它 */
  /* Esc 只做一件事：離開全螢幕。
     絕對不能順手把投影窗關掉 —— macOS 上退出全螢幕本來就是按 Esc，
     兩件事綁在一起等於「想縮小畫面結果整個投影不見了」。 */
  if (e.key === 'Escape') return;
  if (e.key === '1') { pvMode = 'matches'; render(store.get()); }
  if (e.key === '2') { pvMode = 'rank'; render(store.get()); }
  if (e.key === '3') { pvMode = 'plan'; render(store.get()); }
  if (e.key === 'f' || e.key === 'F') el('btnFull').onclick();
});

/* 點畫面中央切換「對戰表 ⇄ 名次」，點頁尾的按鈕不算 */
el('pvBody').addEventListener('click', function () {
  var cycle = ['matches', 'rank', 'plan'];
  pvMode = cycle[(cycle.indexOf(pvMode) + 1) % cycle.length];
  render(store.get());
});

if (location.hash === '#present') {
  isPopup = !!window.opener;
  enterPresent(true);
  document.title = 'NICEPLAY · 投影';
  el('btnClosePv').textContent = isPopup ? '關閉投影窗' : '回到控制台';
}

/* ── 畫面 ───────────────────────────────────────────── */
function render(st) {
  var host = (st.event.host || '').trim();
  el('evtLabel').textContent = st.event.name
    ? [host, st.event.name, st.event.date].filter(Boolean).join('　')
    : '尚未設定賽事';

  /* 主辦單位在四個地方各露一次臉：投影、選手手機、紙本、檔名。
     留白就整個不顯示 —— 空的標籤比沒有標籤更難看。 */
  el('pvHost').hidden = !host;
  el('pvHost').textContent = host ? '主辦　' + host : '';
  el('wtHost').hidden = !host;
  el('wtHost').textContent = host;
  el('paperName').textContent = st.event.name || 'NICEPLAY 賽事';
  el('paperMeta').textContent = [
    host ? '主辦　' + host : '',
    st.event.date,
    st.players.length ? st.players.length + ' 人' : '',
    formatLabel(st.config)
  ].filter(Boolean).join('　·　');

  /* 分頁不再灰掉。灰掉的按鈕只會讓人以為程式壞了 ——
     點得下去，點進去再告訴他差什麼、按哪裡補。 */
  var has = st.matches.length > 0;
  var ready = st.players.length >= 2;
  el('playEmpty').hidden = has;
  el('playEmptyWhy').textContent = !st.players.length
    ? '還沒有參賽名單。到設定頁把名單一次貼上，按「更新名單」。'
    : ready
      ? '這 ' + st.players.length + ' 位都在了，確認沒問題就直接開賽 —— 系統會排好第一輪。'
      : '只有 1 位選手，至少要兩位才排得出對戰。';
  /* 名單就列在這裡，不用切回設定頁確認 */
  el('playEmptyList').innerHTML = st.players.map(function (p) {
    return '<div class="nm' + (p.dropped ? ' out' : '') + '"><i>' + p.no + '</i>' +
           '<span>' + esc(p.name) + '</span></div>';
  }).join('');
  el('btnStartHere').hidden = !ready;
  /* 還沒排對戰的時候，進度條與那排動作按鈕沒有東西可以操作 ——
     留著只會讓人以為「下一輪」才是開賽的按鈕。 */
  el('playProg').hidden = !has;
  el('playActs').hidden = !has;
  paintEvents(st);
  el('rankEmpty').hidden = !!st.players.length;
  el('rankEmptyWhy').textContent = '還沒有參賽名單。到設定頁把名單一次貼上，按「更新名單」。';

  if (!drafting) paintRoster(st.players);
  syncPlayerBox(st);
  el('hintWin').textContent = st.config.rules.win;
  el('hintDraw').textContent = st.config.rules.draw;
  el('hintLoss').textContent = st.config.rules.loss;

  applyTheme(st);
  paintQRs(st);
  paintMatches(st);
  paintRank(st);
  if (document.body.classList.contains('player')) paintWatch(st);
  if (document.body.classList.contains('present')) paintPresent(st);
}

/* ── 排序與搜尋 ───────────────────────────────────────
   兩種排序是兩種不同的工作節奏，不是誰比較好：
     依名次　排出來就是這樣，第一桌是分數最高的兩位，適合唸桌號
     依桌號　回報時是拿著紙條照桌號一張一張輸入，順序要對得起來
   存在這臺裝置上而不是賽事狀態裡 —— 主控跟副控可以各用各的順序。 */
var SORT_KEY = 'niceplay.sort';
function sortMode() {
  return localStorage.getItem(SORT_KEY) === 'table' ? 'table' : 'rank';
}
/* 桌號可能是 1、2、10，也可能是 A、B，或自訂的 Q1。
   純數字要照數值比（不然 10 會排在 2 前面），其餘照字面。 */
function byTableName(x, y) {
  var a = String(x.table), b = String(y.table);
  var na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return parseInt(a, 10) - parseInt(b, 10);
  if (na !== nb) return na ? -1 : 1;
  return a.localeCompare(b, 'zh-Hant');
}
function norm(s) { return String(s || '').trim().toLowerCase(); }
function matchMatches(st, m, q) {
  if (norm(m.table).indexOf(q) >= 0) return true;
  return [m.a, m.b].some(function (id) {
    if (id === null || id === undefined) return false;
    return norm(nameOf(st, id)).indexOf(q) >= 0 || String(numOf(st, id)) === q;
  });
}

/* 對戰列表 */
function paintMatches(st) {
  var r = currentRound(st);
  if (r === null) {
    el('matchList').innerHTML = '<div class="hint">還沒開始。到「設定」讀入名單後按「開始比賽」。</div>';
    el('progDone').textContent = '0/0';
    el('progRound').textContent = '—';
    el('progBar').style.width = '0';
    return;
  }
  var ms = matchesOf(st, r);
  var playable = ms.filter(function (m) { return m.b !== null; });
  var done = playable.filter(function (m) { return m.result; }).length;

  el('progRound').textContent = roundLabel(r);
  el('progDone').textContent = done + '/' + playable.length;
  el('progBar').style.width = (playable.length ? 100 * done / playable.length : 0) + '%';

  /* 整輪回報完之前，「下一輪」維持素藍、不誘導人往下走；
     回報完才升成漸層。全站同時只有一顆漸層按鈕，那顆就是現在該按的。 */
  var allIn = playable.length > 0 && done === playable.length;
  el('btnNext').classList.toggle('ready', allIn);
  el('btnNext').textContent = allIn ? '全部回報完 · 下一輪　→' : '下一輪　→';

  /* 排序與搜尋只影響「看到什麼」，不影響進度數字 ——
     篩選之後如果連 0/8 都跟著變，那個數字就沒有意義了。 */
  var view = ms.slice();
  if (sortMode() === 'table') view.sort(byTableName);
  var q = norm(el('playFind').value);
  if (q) view = view.filter(function (m) { return matchMatches(st, m, q); });
  el('playFindMsg').textContent = q
    ? (view.length ? '符合的 ' + view.length + ' 桌（共 ' + ms.length + ' 桌）'
                   : '找不到「' + el('playFind').value.trim() + '」')
    : '';

  var rm = recMap(st);
  el('matchList').innerHTML = view.map(function (m) {
    var live = st.config.liveTable && m.table === st.config.liveTable;
    var mine = net.role === 'watch' && meId && (m.a === meId || m.b === meId);
    var bo = m.bo || 1;
    var g = E.tallyGames(E.gamesOf(m));
    var h = '<div class="mt' + (m.result ? ' done' : '') + (live ? ' islive' : '') +
            (mine ? ' mine' : '') + (bo > 1 ? ' bo' : '') + '">' +
            '<div class="tb">' + esc(m.table) + '</div>';
    h += side(st, m, 'a', rm, bo, g);
    if (m.b === null || m.b === undefined) {
      /* 輪空不能點，所以維持 div —— 按不下去的按鈕對鍵盤與螢幕閱讀器
         都是雜訊，Tab 會停在一個什麼都不會發生的地方。 */
      h += '<div class="sd bye">輪空 · 視同勝</div>';
    } else {
      h += '<button type="button" class="dw' + (m.result === 'draw' ? ' on' : '') +
           '" data-t="' + esc(m.table) + '" data-r="draw"' +
           ' aria-label="第 ' + esc(m.table) + ' 桌　記一次平手"' +
           ' aria-pressed="' + (m.result === 'draw') + '">平手' +
           (g.draw ? '<b class="gn">×' + g.draw + '</b>' : '') + '</button>' +
           side(st, m, 'b', rm, bo, g);
      /* 退一局只在真的有東西可以退的時候出現 —— 空著的按鈕只會讓人以為壞了。
         一勝制不需要它：再點同一邊就是取消。 */
      if (bo > 1 && (g.a + g.b + g.draw) > 0) {
        h += '<button class="undo" data-t="' + esc(m.table) + '" title="退掉最後一局">⌫<i>退一局</i></button>';
      }
    }
    return h + '</div>';
  }).join('');
}

/* 小局進度用點點表示，點滿就是拿下這一場。畫「要贏幾局」個點，
   而不是「總共打幾局」—— 現場關心的是還差幾局，不是還剩幾局。 */
function pipsOf(bo, won) {
  if (bo <= 1) return '';
  var need = E.winsNeeded(bo), s = '';
  for (var i = 0; i < need; i++) s += '<i' + (i < won ? ' class="on"' : '') + '></i>';
  return '<span class="pips">' + s + '</span>';
}

/* 真的用 <button>，不是長得像按鈕的 div ——
   div 的 Tab 停不進去、螢幕閱讀器也不會唸出「這是可以按的」，
   等於整個回報流程對鍵盤使用者不存在。
   aria-pressed 讓輔助技術唸得出「已選取」，那是這個介面唯一的狀態。 */
function side(st, m, which, rm, bo, g) {
  var id = which === 'a' ? m.a : m.b;
  var cls = 'sd';
  var won = (m.result === which);
  if (won) cls += ' win';
  else if (m.result && m.result !== 'draw' && m.result !== 'bye') cls += ' lose';
  var r = rm && rm[id];
  var label = '第 ' + m.table + ' 桌　' + nameOf(st, id) +
              ((bo || 1) > 1 ? '　記他贏一局' : '　記他贏');
  return '<button type="button" class="' + cls + '" data-t="' + esc(m.table) +
         '" data-r="' + which + '" data-id="' + esc(id) + '" aria-pressed="' + won + '"' +
         ' aria-label="' + esc(label) + '">' +
         '<i>' + numOf(st, id) + '</i><span class="who">' + esc(nameOf(st, id)) + '</span>' +
         pipsOf(bo || 1, which === 'a' ? g.a : g.b) +
         (r ? '<span class="rec num">' + r.rec + '</span>' : '') + '</button>';
}

/* 排名表 */
function paintRank(st) {
  if (!st.players.length) { el('rankView').innerHTML =
    '<div class="hint">還沒有名單。</div>'; return; }
  var rows = E.standings(st.players, st.matches, st.config.rules);
  var live = rows.filter(function (r) { return !r.dropped; });
  var cut = st.config.cut || 0;
  el('rankTitle').textContent = cut ? '即時名次 · 前 ' + cut + ' 名晉級' : '即時名次';

  /* 搜尋只藏列，名次照原本算 —— 篩出來的那個人旁邊還是他真正的名次，
     不會因為只剩他一列就變成第 1 名。 */
  var q = norm(el('rankFind').value);
  var shown = q ? rows.filter(function (r) {
    return norm(r.name).indexOf(q) >= 0 || String(r.no) === q;
  }) : rows;
  if (q && !shown.length) {
    el('rankView').innerHTML = '<div class="hint">找不到「' + esc(el('rankFind').value.trim()) +
      '」。名單上共 ' + rows.length + ' 人。</div>';
    return;
  }

  var h = '<table class="rank"><thead><tr><th>#</th><th class="l">選手</th>' +
          '<th>戰績</th><th>積分</th><th>OMW%</th><th>OOMW%</th><th></th></tr></thead><tbody>';
  /* 前四名另外標 —— 那是有獎的名次，跟「晉級線」是兩件事，
     所以就算沒有設定晉級人數也要看得出來。 */
  var played = rows.some(function (r) { return r.played > 0; });
  shown.forEach(function (r) {
    var idx = live.indexOf(r);
    var inCut = cut && !r.dropped && idx > -1 && idx < cut;
    var podium = played && !r.dropped && idx > -1 && idx < 4;
    h += '<tr class="' + (inCut ? 'cut ' : '') + (cut && idx === cut - 1 ? 'cutline ' : '') +
         (podium ? 'top4 ' : '') + (r.dropped ? 'out' : '') + '">' +
         '<td class="rk">' + r.rank + '</td>' +
         '<td class="l"><div class="nmcell"><i>' + r.no + '</i>' + esc(r.name) +
           (r.byes ? ' <span style="color:var(--dim);font-size:12px">輪空' + r.byes + '</span>' : '') +
         '</div>' +
         /* 手機上右邊兩欄放不下，同一組數字改掛在名字底下 ——
            同分的時候，看的人要能自己看出憑什麼是這個順序。 */
         (played ? '<div class="tbk">OMW ' + (r.omw * 100).toFixed(1) +
                   '%　OOMW ' + (r.oomw * 100).toFixed(1) + '%</div>' : '') +
         '</td>' +
         '<td>' + r.w + '-' + r.l + (r.d ? '-' + r.d : '') + '</td>' +
         '<td class="pt">' + r.pts + '</td>' +
         '<td>' + (r.omw * 100).toFixed(1) + '</td>' +
         '<td>' + (r.oomw * 100).toFixed(1) + '</td>' +
         '<td><button class="dropb' + (r.dropped ? ' on' : '') + '" data-id="' + r.id + '">' +
           (r.dropped ? '已退賽' : '退賽') + '</button></td></tr>';
  });
  el('rankView').innerHTML = h + '</tbody></table>';
}

/* 投影 */
function paintPresent(st) {
  var r = currentRound(st);
  el('pvTag').textContent = r === null ? '—'
    : (typeof r === 'number' ? 'R' + r : r.replace('賽', ''));
  el('pvName').textContent = st.event.name || 'NICEPLAY';
  el('pvSub').textContent = r === null ? '尚未開始' : roundLabel(r);

  var ms = r === null ? [] : matchesOf(st, r);
  var playable = ms.filter(function (m) { return m.b !== null; });
  var done = playable.filter(function (m) { return m.result; }).length;
  el('pvFoot').textContent = r === null ? ''
    : (roundLabel(r) + '　已回報 ' + done + '/' + playable.length +
       (done < playable.length ? '　·　尚有 ' + (playable.length - done) + ' 桌未回報' : '　·　全部回報完畢'));

  if (pvMode === 'plan') paintPvPlan(st, r);
  else if (pvMode === 'rank' || r === null) paintPvRank(st);
  else paintPvMatches(st, ms);
}

/* ── 投影：賽程總覽 ───────────────────────────────────
   選手第三常問的是「還要打多久」。開場與換輪的空檔投這一頁，
   等於自動回答，主辦不用一直被同一句話打斷。

   預計結束時間是「參考值」不是「狀態」—— 換輪永遠是主辦按下去才發生，
   這個數字不會去推動任何東西，只是照現在的設定算給大家看。
   所以標題直接寫「預計」，而且時間到了也不會自己往下跑。 */
function paintPvPlan(st, r) {
  var cfg = st.config;
  var total = cfg.format === 'swiss' ? cfg.rounds : 0;
  var doneR = E.countRounds(st.matches);
  var nowR = (typeof r === 'number') ? r : doneR;
  var left = total ? Math.max(0, total - nowR) : 0;
  var alivePlayers = st.players.filter(function (p) { return !p.dropped; }).length;

  var mins = cfg.minutes || 0;
  var remainNow = Math.max(0, Math.ceil(remainMs(st) / 60000));
  var eta = '';
  if (mins && total) {
    /* 這一輪剩下的 + 之後每一輪，各多留五分鐘給回報與換位 */
    var totalMin = remainNow + left * (mins + 5);
    var d = new Date(Date.now() + totalMin * 60000);
    eta = pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  var cells = [
    ['ROUND', total ? nowR + ' / ' + total : String(nowR || '—'), total ? '第幾輪' : '輪次'],
    ['PLAYERS', String(alivePlayers), '目前人數'],
    ['CLOCK', mins ? mins + ' 分' : '不計時', '每輪時間'],
    ['ETA', eta || '—', eta ? '預計結束（參考）' : '未設定時間']
  ];

  var url = roomViewURL(st);
  var h = '<div class="pv-plan">' +
    '<div class="pv-plan-hd">' +
      '<b>' + esc(st.event.name || 'NICEPLAY') + '</b>' +
      (st.event.host ? '<span>主辦　' + esc(st.event.host) + '</span>' : '') +
      '<em>' + esc(formatLabel(cfg)) + '</em>' +
    '</div>' +
    '<div class="pv-plan-grid">' +
      cells.map(function (c) {
        return '<div class="pv-cell"><i>' + c[0] + '</i><b>' + esc(c[1]) +
               '</b><span>' + esc(c[2]) + '</span></div>';
      }).join('') +
    '</div>';

  if (url) {
    h += '<div class="pv-plan-qr"><div class="pv-plan-qrimg">' + qrSVG(url, 420) + '</div>' +
         '<div class="pv-plan-qrcap"><b>掃我查自己的桌號與名次</b>' +
         '<span>不用註冊、不用安裝，掃了就看得到</span></div></div>';
  }
  el('pvBody').innerHTML = h + '</div>';
}

function paintPvMatches(st, ms) {
  var n = ms.length;

  /* 欄數不用公式猜 —— 1 到 6 欄各試一次，挑「字能最大」的那個。
     一張卡橫向要放：桌號圈 + 編號籤 + 名字 + 勝 + 戰績 + 間距 ≈ 13.5 個字寬；
     縱向要放：兩行 + VS + 內距 ≈ 3.5 個字高。
     單位統一用 vw，所以先把視窗高度換算成 vw。                        */
  var vh = 100 * (window.innerHeight || 900) / (window.innerWidth || 1600);
  var best = { f: 0, cols: 1, rows: n };
  for (var c = 1; c <= Math.min(6, n); c++) {
    var rN = Math.ceil(n / c);
    var cw = 100 / c, ch = (vh * 0.74) / rN;
    var fit = Math.min(cw / 13.5, ch / 3.5);
    if (fit > best.f) best = { f: fit, cols: c, rows: rN };
  }
  var cols = best.cols, rowsN = best.rows;
  var f = Math.max(0.75, Math.min(3.4, best.f));

  var rank = {};
  E.standings(st.players, st.matches, st.config.rules).forEach(function (x) {
    rank[x.id] = x.w + '-' + x.l + (x.d ? '-' + x.d : '');
  });

  var h = '<div class="pv-grid" style="grid-template-columns:repeat(' + cols +
          ',1fr);grid-template-rows:repeat(' + rowsN + ',1fr)">';
  ms.forEach(function (m) {
    var live = st.config.liveTable && m.table === st.config.liveTable;
    h += '<div class="pv-seat' + (live ? ' live' : '') +
         '" style="padding:' + (f * .3) + 'vw ' + (f * .55) + 'vw;gap:' + (f * .5) + 'vw">' +
         '<div class="pv-no" style="width:' + (f * 2.05) + 'vw;height:' + (f * 2.05) +
         'vw;font-size:' + (f * 1.25) + 'vw">' + esc(m.table) + '</div><div class="pv-who">';
    h += pvLine(st, m, 'a', f, rank);
    if (m.b === null || m.b === undefined) {
      h += '<div class="pv-vs" style="font-size:' + (f * .5) + 'vw">BYE</div>' +
           '<div class="pv-p pv-empty" style="font-size:' + (f * .92) + 'vw">輪空 · 視同勝</div>';
    } else {
      h += '<div class="pv-vs" style="font-size:' + (f * .5) + 'vw">VS</div>' +
           pvLine(st, m, 'b', f, rank);
    }
    h += '</div></div>';
  });
  el('pvBody').innerHTML = h + '</div>';
}
function pvLine(st, m, which, f, rank) {
  var id = which === 'a' ? m.a : m.b;
  var cls = 'pv-p ' + which;
  var tag = '';
  if (m.result === which) {
    cls += ' win';
    tag = '<b class="adv" style="font-size:' + (f * .54) + 'vw">勝</b>';
  } else if (m.result && m.result !== 'draw' && m.result !== 'bye') {
    cls += ' lose';
  }
  /* BO 制的投影用數字而不是點點 —— 場地最後一排看不清楚兩個點的差別 */
  var bo = m.bo || 1, gm = '';
  if (bo > 1) {
    var g = E.tallyGames(E.gamesOf(m));
    gm = '<b class="gm" style="font-size:' + (f * .72) + 'vw">' +
         (which === 'a' ? g.a : g.b) + '</b>';
  }
  return '<div class="' + cls + '" style="font-size:' + f + 'vw">' +
         '<i style="font-size:' + (f * .74) + 'vw">' + numOf(st, id) + '</i>' +
         '<span class="nm2">' + esc(nameOf(st, id)) + '</span>' + gm + tag +
         '<span class="rec" style="font-size:' + (f * .6) + 'vw">' + (rank[id] || '') + '</span></div>';
}

/* 名次投影是頒獎跟散場前最後一個畫面，所以：
     · 全部的人都要上得去。切到前 16 名，第 17 名以後的人看不到自己。
     · 前四名要一眼認得出來 —— 那是有獎的名次。
   欄數跟對戰表一樣用試的：一到四欄各算一次，挑「字能最大」的那個。
   一列橫向大約放得下 20 個字寬（名次 + 編號 + 名字 + 戰績 + 積分）。 */
function paintPvRank(st) {
  var rows = E.standings(st.players, st.matches, st.config.rules);
  var cut = st.config.cut || 0;
  var played = rows.some(function (r) { return r.played > 0; });
  var live = rows.filter(function (r) { return !r.dropped; });
  var n = rows.length || 1;
  var vh = 100 * (window.innerHeight || 900) / (window.innerWidth || 1600);

  var best = { f: 0, cols: 1, rows: n };
  for (var c = 1; c <= Math.min(4, n); c++) {
    var rN = Math.ceil(n / c);
    var cw = 100 / c, ch = (vh * 0.74) / rN;
    var fit = Math.min(cw / 20, ch / 1.75);
    if (fit > best.f) best = { f: fit, cols: c, rows: rN };
  }
  var f = Math.max(.5, Math.min(2.6, best.f));

  var h = '<div class="pv-rank" style="grid-template-columns:repeat(' + best.cols +
          ',1fr);grid-template-rows:repeat(' + best.rows + ',1fr)">';
  rows.forEach(function (r) {
    var idx = live.indexOf(r);
    var podium = played && !r.dropped && idx > -1 && idx < 4;
    h += '<div class="pv-rk' + (cut && played && r.rank <= cut ? ' in' : '') +
         (podium ? ' top4' : '') + (r.dropped ? ' out' : '') +
         '" style="padding:' + (f * .16) + 'vw ' + (f * .6) + 'vw">' +
         '<b style="font-size:' + (f * 1.15) + 'vw;flex-basis:' + (f * 1.8) + 'vw">' + r.rank + '</b>' +
         '<i style="font-size:' + (f * .56) + 'vw">' + r.no + '</i>' +
         '<span style="font-size:' + f + 'vw">' + esc(r.name) + '</span>' +
         '<em style="font-size:' + (f * .62) + 'vw">' + r.w + '-' + r.l + (r.d ? '-' + r.d : '') + '</em>' +
         '<u style="font-size:' + (f * 1.05) + 'vw;flex-basis:' + (f * 1.9) + 'vw">' + r.pts + '</u></div>';
  });
  el('pvBody').innerHTML = h + '</div>';
}

/* ── 每 250ms 更新時鐘（資料變動由 Store 推）──────────── */
/* 時間到只有畫面轉紅，主辦通常正低頭處理別的事 —— 補一次明確的提示。
   只在「跑著跑著跨過零」的那一下講一次，不要每 250ms 洗版，
   也不要在暫停或重新排輪之後又叫一次。 */
/* 提示音自己合成，不載音檔 —— 現場常常沒有網路，而且一個 wav 檔
   比整包程式還大。三聲短音比一聲長音好認：長音容易被誤認成環境噪音。

   瀏覽器規定要有使用者互動過才准出聲，而「按開始計時」剛好就是那個
   互動 —— 所以時間到的時候一定播得出來，不會被擋。 */
var audio = null;
function beep(st) {
  if (st && st.config && st.config.sound === false) return;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio) audio = new AC();
    if (audio.state === 'suspended') audio.resume();
    [0, 0.26, 0.52].forEach(function (delay, i) {
      var o = audio.createOscillator(), g = audio.createGain();
      var t = audio.currentTime + delay;
      o.type = 'sine';
      o.frequency.setValueAtTime(i === 2 ? 660 : 880, t);
      /* 兩端都做淡入淡出，不然會有「喀」的爆音 */
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
      o.connect(g); g.connect(audio.destination);
      o.start(t); o.stop(t + 0.22);
    });
  } catch (e) { /* 出不了聲就算了，畫面已經轉紅了 */ }
}

var wasPositive = true;
function announceTimeUp(st, ms, has) {
  var running = has && st.timer.running;
  if (running && wasPositive && ms <= 0) {
    /* 投影視窗不講 —— 那句話是講給主辦聽的，橫在投影畫面上只會擋到全場。
       投影本來就已經把倒數轉紅了。選手畫面同理。
       但聲音要從投影那臺出來 —— 接電視的通常就是它，全場才聽得到。 */
    var isPresent = document.body.classList.contains('present');
    var isPlayer = document.body.classList.contains('player');
    if (!isPlayer) beep(st);
    if (!isPresent && !isPlayer) toast('時間到 —— 等大家確認完戰績再按「下一輪」', true);
  }
  wasPositive = !running || ms > 0;
}

function tick() {
  var st = store.get(), d = new Date();
  el('wallClock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());

  var ms = remainMs(st), has = st.timer.durMs > 0;
  announceTimeUp(st, ms, has);
  var txt = has ? fmtCount(ms) : '';
  el('roundClock').textContent = has ? (st.timer.running ? txt : txt + '（暫停）') : '不計時';
  el('btnTimer').textContent = st.timer.running ? '⏸　暫停計時' : '▶　開始計時';
  el('btnTimer').style.display = has ? '' : 'none';

  var c = el('pvCount');
  el('pvClock').textContent = has ? txt : '--:--';
  el('pvLabel').textContent = !has ? '不計時' : (ms < 0 ? '已　超　時' : (st.timer.running ? '本輪剩餘' : '暫停中'));
  c.classList.toggle('warn', has && ms > 30000 && ms <= 120000);
  c.classList.toggle('urgent', has && ms <= 30000);
}

var booted = false;
store.subscribe(function (st, remote) {
  if (!fillForm._once) { fillForm(st); fillForm._once = true; }
  render(st);

  /* 什麼時候才推：
     · remote 為真 —— 這份是別人推過來的，再推回去就變成互推迴圈
     · booted 為假 —— 這是訂閱當下的第一次呼叫，不是使用者改的。
       主控備援身分會讓新開的分頁一開場就以為自己是主控，
       這時候推出去的是它自己還沒載入的空白狀態，等於把房間洗掉。
       房間本來就是用開房當下那份狀態建的，開場不需要再推一次。 */
  if (booted && !remote && !applyingRemote && net.role === 'host') net.pushState(st);
  if (booted) autoWrite();          /* 有開自動存檔就順手寫一份 */
  booted = true;
});

/* 版本號。使用者回報問題時，第一件要問的就是「你在哪一版」——
   版本章本來就蓋在每個 script 的網址上，直接讀回來就好，不必另外維護一份。 */
function appVersion() {
  var s = document.querySelector('script[src*="ui.js"]');
  var m = s && s.src.match(/[?&]v=(\d+)/);
  if (!m) return '開發版';
  var v = m[1];
  return v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8) + ' ' +
         v.slice(8, 10) + ':' + v.slice(10, 12);
}
el('appVer').textContent = appVersion();
el('bookVer').textContent = appVersion();
paintUndo();
paintAuto();

/* Service Worker 抓到新版時由 index.html 呼叫進來。
   刻意不自動重整、也不擋畫面 —— 現場最不需要的就是比賽跑到一半被打斷。 */
window.NICEPLAY_NEWVER = function () {
  toast('已經下載好新版本，這一場照跑不受影響；等比賽結束再重新整理就會套用');
};

el('fServer').value = localStorage.getItem(SRV_KEY) || DEFAULT_SERVER;

/* 網址決定身分。有 #staff / #join= 就照網址走，
   否則接回上次的房間（重整、關掉再開都不會掉線）。 */
el('btnGoSetup').onclick = el('btnGoSetup2').onclick = function () { goTab('tSetup'); };
if (IS_PRESENT) { /* 投影視窗不連線，狀態靠 BroadcastChannel */ }
else if (!routeHash()) net.resume();
addEventListener('hashchange', function () {
  if (location.hash === '#present') return;
  routeHash();
});
/* fCut 也要進來 —— 有沒有淘汰賽決定「淘汰賽幾勝制」該不該出現 */
['fFormat', 'fNaming', 'fCut', 'fBo', 'fBoKO'].forEach(function (id) {
  el(id).onchange = syncFormatFields;
});

/* 賽事名稱／日期／主辦單位離開欄位就立刻寫進狀態。
   其餘設定要等「開始比賽」才生效（中途改賽制會把已打完的搞亂），
   但這三個純粹是抬頭文字，改了就該馬上出現在投影與選手手機上 ——
   不然填了主辦單位卻看不到任何變化，只會以為沒存到。
   用 change 而不是 input：一次編輯推一次，不必每個字都推伺服器。 */
/* ── 鍵盤操作 ─────────────────────────────────────────
   32 桌以上時，用滑鼠在長列表裡找桌號比想像中慢，而回報是整場重複
   最多次的動作。三個鍵就夠：

     數字／字母　跳到那一桌並把焦點放在左邊那位（連打兩位數也認得，
                 「1」再「2」是第 12 桌，不是先跳 1 再跳 2）
     ← →　　　　在同一張卡的「左 · 平手 · 右」之間移動
     Backspace　退這一桌的最後一局

   按 Enter／空白鍵回報是瀏覽器本來就有的 —— 那三格現在是真的按鈕，
   所以不必自己實作，也才不會跟輔助技術打架。 */
var jumpBuf = '', jumpTimer = null;

function focusTable(name) {
  var card = null;
  document.querySelectorAll('#matchList .mt').forEach(function (el2) {
    var b = el2.querySelector('[data-t]');
    if (b && b.dataset.t === name) card = el2;
  });
  if (!card) return false;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  var first = card.querySelector('button[data-r]');
  if (first) first.focus();
  return true;
}

document.addEventListener('keydown', function (e) {
  if (!el('tPlay').classList.contains('on')) return;
  if (document.body.classList.contains('present')) return;
  if (askOpen()) return;              /* 確認框開著的時候，鍵盤歸它 */
  var t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  var card = t && t.closest ? t.closest('.mt') : null;

  if (e.key === 'Backspace' && card) {
    var u = card.querySelector('.undo');
    e.preventDefault();
    if (u) reportGame(u.dataset.t, null);
    else toast('一勝制不用退局 —— 再點同一邊就是取消', true);
    return;
  }

  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && card) {
    var btns = [].slice.call(card.querySelectorAll('button[data-r]'));
    var i = btns.indexOf(t);
    if (i < 0) return;
    e.preventDefault();
    var next = btns[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) next.focus();
    return;
  }

  if (e.key === 'Escape') { jumpBuf = ''; return; }

  /* 桌號可能是數字，也可能是字母或自訂的 Q1，所以不限定字元集 */
  if (e.key.length !== 1 || !/[0-9A-Za-z]/.test(e.key)) return;
  e.preventDefault();
  jumpBuf += e.key.toUpperCase();
  clearTimeout(jumpTimer);
  jumpTimer = setTimeout(function () { jumpBuf = ''; }, 900);
  if (!focusTable(jumpBuf)) {
    /* 這一串沒有對應的桌，退回只用最後一個字再試一次 */
    if (jumpBuf.length > 1 && focusTable(e.key.toUpperCase())) jumpBuf = e.key.toUpperCase();
    else toast('沒有第 ' + jumpBuf + ' 桌', true);
  }
});

/* 搜尋與排序：只改看到的東西，不動狀態，所以直接重畫就好。
   搜尋用 input 即時反應 —— 現場是「有人站在旁邊等」的情境。 */
el('playFind').oninput = function () { render(store.get()); };
el('rankFind').oninput = function () { render(store.get()); };
el('fSort').onchange = function () {
  try { localStorage.setItem(SORT_KEY, el('fSort').value); } catch (e) {}
  render(store.get());
};
el('fSort').value = sortMode();

['fName', 'fDate', 'fHost'].forEach(function (id) {
  el(id).onchange = function () {
    store.commit(function (s) {
      s.event.name = el('fName').value.trim();
      s.event.date = el('fDate').value.trim();
      s.event.host = el('fHost').value.trim();
    });
  };
});
['fTables', 'fCustom'].forEach(function (id) { el(id).oninput = function () { updateTableHint(); }; });

addEventListener('resize', function () { render(store.get()); });
tick(); setInterval(tick, 250);
updateTableHint();
})();
