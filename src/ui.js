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
function roundLabel(r) { return typeof r === 'number' ? '第 ' + r + ' 輪' : r; }

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
  syncFormatFields();
}

function readForm(st) {
  st.event.name = el('fName').value.trim();
  st.event.date = el('fDate').value.trim();
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
}

/* 賽制不同，該問的東西也不同 —— 不相關的欄位直接收起來 */
function syncFormatFields() {
  var f = el('fFormat').value;
  el('wrapRounds').style.display = (f === 'swiss') ? '' : 'none';
  el('wrapCut').style.display = (f === 'swiss') ? '' : 'none';
  el('wrapCustom').style.display = (el('fNaming').value === 'custom') ? '' : 'none';

  /* 純單敗淘汰沒有「常規賽」，瑞士制不接淘汰賽就沒有「淘汰賽」——
     不相關的那個直接收起來，免得設了半天沒作用。 */
  var hasNormal = (f !== 'single');
  var hasKO = (f === 'single') || (f === 'swiss' && (parseInt(el('fCut').value, 10) || 0) >= 2);
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
  box.value = list.map(function (p) { return p.no + ' ' + p.name; }).join('\n');
}

el('btnParse').onclick = function () {
  var typed = S.parsePlayers(el('fPlayers').value);
  if (!typed.length) { toast('看不出名字，一行一位試試', true); return; }
  var st = store.get();

  if (!st.matches.length) {
    /* 還沒開賽：整份取代，編號重排 */
    drafting = typed.map(function (p, i) {
      return { id: p.id, no: i + 1, name: p.name, dropped: false };
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
  typed.forEach(function (p) { if (!byName[p.name]) added.push(p.name); });
  var typedNames = {};
  typed.forEach(function (p) { typedNames[p.name] = 1; });
  st.players.forEach(function (p) { if (!typedNames[p.name]) missing.push(p.name); });

  if (!added.length) {
    toast(missing.length ? '沒有新的人。要移除請用排名頁的「退賽」' : '名單沒有變動',
          missing.length > 0);
    syncPlayerBox(st);
    return;
  }
  store.commit(function (s) {
    added.forEach(function (nm) {
      s.players.push({ id: S.uid(), no: s.players.length + 1, name: nm, dropped: false });
    });
  });
  toast('已加入 ' + added.length + ' 位：' + added.join('、') +
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
  if (st.matches.length && !confirmOnce('btnStart', '已經有比賽在進行，重新開始會清掉所有配對與勝負 —— 再按一次確定')) return;

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

/* 需要按兩次的動作，統一用這個 */
var armed = {};
function confirmOnce(key, msg) {
  var now = Date.now();
  if (armed[key] && now - armed[key] < 6000) { armed[key] = 0; return true; }
  armed[key] = now;
  toast(msg, true);
  return false;
}

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
  if (r !== null) {
    var open = matchesOf(st, r).filter(function (m) { return !m.result; }).length;
    if (open && !confirmOnce('next', '還有 ' + open + ' 桌沒回報勝負，現在排下一輪會少算這些戰績 —— 再按一次確定')) return;
  }
  makeNextRound();
};

el('btnRepair').onclick = function () {
  var st = store.get();
  var r = currentRound(st);
  if (r === null) return;
  if (!confirmOnce('repair', '重排會清掉' + roundLabel(r) + '已經回報的勝負 —— 再按一次確定')) return;
  store.commit(function (s) {
    s.matches = s.matches.filter(function (m) { return m.round !== r; });
  });
  makeNextRound();
};

/* ── 回報勝負 ───────────────────────────────────────── */
el('matchList').addEventListener('click', function (e) {
  var u = e.target.closest('.undo');
  if (u) { reportGame(u.dataset.t, null); return; }
  var d = e.target.closest('.sd,.dw');
  if (!d || d.classList.contains('bye') || !d.dataset.t) return;
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
  var name = (st.event.name || 'niceplay') + '_' + (st.event.date || '') + '.json';
  var blob = new Blob([S.toJSON(st)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/\s+/g, '_');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  toast('已匯出 ' + a.download);
};
el('btnImport').onclick = function () { el('fileImport').click(); };
el('fileImport').onchange = function (e) {
  var f = e.target.files[0]; if (!f) return;
  var rd = new FileReader();
  rd.onload = function () {
    try {
      var next = S.fromJSON(rd.result);
      store.replace(next);
      drafting = null;
      toast('已匯入 ' + (next.event.name || '存檔'));
    } catch (err) { toast('讀不出來：' + err.message, true); }
  };
  rd.readAsText(f);
  e.target.value = '';
};
el('btnReset').onclick = function () {
  if (!confirmOnce('reset', '會刪掉名單與所有勝負，回到空白 —— 再按一次確定')) return;
  store.reset(); drafting = null;
  toast('已全部清除');
  goTab('tSetup');
};
/* ── 匯出 CSV ─────────────────────────────────────────
   店家事後要把成績貼進 Excel、或上傳到官方系統，所以給的是
   「打得開就能用」的檔：欄位固定、有 BOM（不然 Excel 會把中文變亂碼）、
   換行用 CRLF（Windows 的 Excel 才不會擠成一行）。 */
function csvCell(s) {
  s = String(s === null || s === undefined ? '' : s);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCSV(rows, suffix) {
  var st = store.get();
  var name = ((st.event.name || 'niceplay') + '_' + (st.event.date || '') + '_' + suffix + '.csv')
             .replace(/\s+/g, '_');
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
  pill.textContent = role === 'off' ? '' : ({
    host: '主控 ', guest: '副控 ', watch: '選手 '
  }[role] || '') + st.code + (st.online ? '' : ' · 斷線');

  el('netOff').hidden = (role !== 'off');
  el('netOn').hidden = (role !== 'host');

  if (role === 'host') {
    el('urlStaff').value = staffURL();
    el('pwStaff').value = net.code;
    el('urlView').value = viewURL(net.viewCode);
    el('roomCode').value = net.code;
    el('viewCode').value = net.viewCode;
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
  if (!confirmOnce('wtleave', '離開之後就查不到桌號了 —— 再按一次確定')) return;
  meId = ''; localStorage.removeItem(ME_KEY);
  net.leave();
  location.hash = '';
  location.reload();
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
el('btnLeave').onclick = function () {
  if (!confirmOnce('leave', '離線之後這臺就變回單機，其他裝置看不到你的操作 —— 再按一次確定')) return;
  net.leave();
  store.commit(function (s) { s.room = null; });
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

/* 比賽進行中誤按會直接讓全場失去畫面，所以要按兩次 */
el('btnClosePv').onclick = function () {
  if (!confirmOnce('closepv', '再按一次關閉投影 —— 全場就看不到畫面了')) return;
  closePresent();
};

addEventListener('keydown', function (e) {
  if (!document.body.classList.contains('present')) return;
  /* Esc 只做一件事：離開全螢幕。
     絕對不能順手把投影窗關掉 —— macOS 上退出全螢幕本來就是按 Esc，
     兩件事綁在一起等於「想縮小畫面結果整個投影不見了」。 */
  if (e.key === 'Escape') return;
  if (e.key === '1') { pvMode = 'matches'; render(store.get()); }
  if (e.key === '2') { pvMode = 'rank'; render(store.get()); }
  if (e.key === 'f' || e.key === 'F') el('btnFull').onclick();
});

/* 點畫面中央切換「對戰表 ⇄ 名次」，點頁尾的按鈕不算 */
el('pvBody').addEventListener('click', function () {
  pvMode = (pvMode === 'matches') ? 'rank' : 'matches';
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
  el('evtLabel').textContent = st.event.name
    ? st.event.name + (st.event.date ? '　' + st.event.date : '')
    : '尚未設定賽事';

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

  var rm = recMap(st);
  el('matchList').innerHTML = ms.map(function (m) {
    var live = st.config.liveTable && m.table === st.config.liveTable;
    var mine = net.role === 'watch' && meId && (m.a === meId || m.b === meId);
    var bo = m.bo || 1;
    var g = E.tallyGames(E.gamesOf(m));
    var h = '<div class="mt' + (m.result ? ' done' : '') + (live ? ' islive' : '') +
            (mine ? ' mine' : '') + (bo > 1 ? ' bo' : '') + '">' +
            '<div class="tb">' + esc(m.table) + '</div>';
    h += side(st, m, 'a', rm, bo, g);
    if (m.b === null || m.b === undefined) {
      h += '<div class="sd bye">輪空 · 視同勝</div>';
    } else {
      h += '<div class="dw' + (m.result === 'draw' ? ' on' : '') + '" data-t="' +
           esc(m.table) + '" data-r="draw">平手' +
           (g.draw ? '<b class="gn">×' + g.draw + '</b>' : '') + '</div>' +
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

function side(st, m, which, rm, bo, g) {
  var id = which === 'a' ? m.a : m.b;
  var cls = 'sd';
  if (m.result === which) cls += ' win';
  else if (m.result && m.result !== 'draw' && m.result !== 'bye') cls += ' lose';
  var r = rm && rm[id];
  return '<div class="' + cls + '" data-t="' + esc(m.table) + '" data-r="' + which + '">' +
         '<i>' + numOf(st, id) + '</i><span class="who">' + esc(nameOf(st, id)) + '</span>' +
         pipsOf(bo || 1, which === 'a' ? g.a : g.b) +
         (r ? '<span class="rec num">' + r.rec + '</span>' : '') + '</div>';
}

/* 排名表 */
function paintRank(st) {
  if (!st.players.length) { el('rankView').innerHTML =
    '<div class="hint">還沒有名單。</div>'; return; }
  var rows = E.standings(st.players, st.matches, st.config.rules);
  var live = rows.filter(function (r) { return !r.dropped; });
  var cut = st.config.cut || 0;
  el('rankTitle').textContent = cut ? '即時名次 · 前 ' + cut + ' 名晉級' : '即時名次';

  var h = '<table class="rank"><thead><tr><th>#</th><th class="l">選手</th>' +
          '<th>戰績</th><th>積分</th><th>OMW%</th><th>OOMW%</th><th></th></tr></thead><tbody>';
  /* 前四名另外標 —— 那是有獎的名次，跟「晉級線」是兩件事，
     所以就算沒有設定晉級人數也要看得出來。 */
  var played = rows.some(function (r) { return r.played > 0; });
  rows.forEach(function (r) {
    var idx = live.indexOf(r);
    var inCut = cut && !r.dropped && idx > -1 && idx < cut;
    var podium = played && !r.dropped && idx > -1 && idx < 4;
    h += '<tr class="' + (inCut ? 'cut ' : '') + (cut && idx === cut - 1 ? 'cutline ' : '') +
         (podium ? 'top4 ' : '') + (r.dropped ? 'out' : '') + '">' +
         '<td class="rk">' + r.rank + '</td>' +
         '<td class="l"><div class="nmcell"><i>' + r.no + '</i>' + esc(r.name) +
           (r.byes ? ' <span style="color:var(--dim);font-size:12px">輪空' + r.byes + '</span>' : '') +
         '</div></td>' +
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

  if (pvMode === 'rank' || r === null) paintPvRank(st);
  else paintPvMatches(st, ms);
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
var wasPositive = true;
function announceTimeUp(st, ms, has) {
  var running = has && st.timer.running;
  if (running && wasPositive && ms <= 0) {
    /* 投影視窗不講 —— 那句話是講給主辦聽的，橫在投影畫面上只會擋到全場。
       投影本來就已經把倒數轉紅了。選手畫面同理。 */
    var isConsole = !document.body.classList.contains('present')
                 && !document.body.classList.contains('player');
    if (isConsole) toast('時間到 —— 等大家確認完戰績再按「下一輪」', true);
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
  booted = true;
});

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
['fTables', 'fCustom'].forEach(function (id) { el(id).oninput = function () { updateTableHint(); }; });

addEventListener('resize', function () { render(store.get()); });
tick(); setInterval(tick, 250);
updateTableHint();
})();
