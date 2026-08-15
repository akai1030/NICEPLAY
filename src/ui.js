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

var pvMode = 'matches';        /* 投影顯示：matches | rank */
var drafting = null;           /* 名單暫存，還沒按「開始比賽」 */
var applyingRemote = false;    /* 正在套用伺服器來的狀態，這時候不要再推回去 */

var SRV_KEY = 'niceplay.server';
var ME_KEY = 'niceplay.me';

/* 官方房間伺服器。自己架的話改這一行，或在設定頁直接改欄位（會記在瀏覽器裡）。 */
var DEFAULT_SERVER = 'https://niceplayroom.transtation.org';

var net = window.Net.create({
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
  if (b && !b.disabled) b.click();
}

/* ── 設定：表單 ⇄ 狀態 ──────────────────────────────── */
function fillForm(st) {
  el('fName').value = st.event.name;
  el('fDate').value = st.event.date;
  el('fFormat').value = st.config.format;
  el('fRounds').value = st.config.rounds;
  el('fCut').value = String(st.config.cut || 0);
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
  updateTableHint();
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
el('btnStart').onclick = function () {
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
};

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
  var d = e.target.closest('.sd,.dw');
  if (!d || d.classList.contains('bye') || !d.dataset.t) return;
  var table = d.dataset.t, want = d.dataset.r;
  var st = store.get(), r = currentRound(st);

  if (net.role === 'watch') { toast('查詢模式只能看，回報請找店員', true); return; }
  if (net.role === 'guest') {
    /* 加入者不改本機，送給伺服器；伺服器套用完會把新狀態推回來 */
    net.sendResult(r, table, want).catch(function () {});
    return;
  }
  store.commit(function (s) {
    s.matches.forEach(function (m) {
      if (m.round === r && m.table === table) m.result = (m.result === want) ? null : want;
    });
  });
});

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
   開房＝這臺當主控，配對與下一輪都在這裡算；
   加入＝只能回報勝負。房號即權限，不需要帳號。      */
function paintNet(st) {
  var pill = el('netPill');
  var role = st.role;
  pill.hidden = (role === 'off');
  pill.className = 'netpill ' + (st.bad ? 'bad' : role);
  pill.textContent = role === 'off' ? '' : ({
    host: '主控 ', guest: '加入 ', watch: '查詢 '
  }[role] || '') + st.code + (st.online ? '' : ' · 斷線');

  el('netOff').hidden = (role !== 'off');
  el('netOn').hidden = (role === 'off');
  el('roomCode').textContent = role === 'host' ? net.code : st.code;
  el('viewBox').hidden = (role !== 'host');
  el('viewCode').textContent = net.viewCode || '——';

  el('roomHint').innerHTML =
    role === 'host'
      ? '<b>店員房號</b>唸給要幫忙回報的人；<b>選手查詢碼</b>可以公開貼出來，' +
        '拿到的人只能看，改不了任何東西。'
      : role === 'watch'
        ? '<b>查詢模式</b>：可以看對戰表與名次，不能修改。'
        : '<b>你是加入者</b>：可以回報勝負，配對與下一輪由主控那臺決定。';

  document.body.classList.toggle('guest', role === 'guest');
  document.body.classList.toggle('watch', role === 'watch');
  if (st.msg) toast(st.msg, st.bad);
}

/* ── 選手查詢模式：我是誰、我在第幾桌 ─────────────── */
var meId = localStorage.getItem(ME_KEY) || '';

function paintMe(st) {
  var panel = el('mePanel');
  if (net.role !== 'watch') { panel.hidden = true; return; }
  panel.hidden = false;

  var me = null;
  st.players.forEach(function (p) { if (p.id === meId) me = p; });

  if (!me) {
    el('meBar').hidden = true;
    el('mePick').hidden = false;
    el('meList').innerHTML = st.players.map(function (p) {
      return '<div class="nm" data-id="' + p.id + '"><i>' + p.no + '</i>' +
             '<span>' + esc(p.name) + '</span></div>';
    }).join('');
    return;
  }

  el('mePick').hidden = true;
  el('meBar').hidden = false;

  var r = currentRound(st);
  var mine = null;
  matchesOf(st, r).forEach(function (m) {
    if (m.a === meId || m.b === meId) mine = m;
  });
  var rows = E.standings(st.players, st.matches, st.config.rules);
  var row = null;
  rows.forEach(function (x) { if (x.id === meId) row = x; });

  var at = mine
    ? (mine.b === null || mine.b === undefined
        ? '<span>本輪</span><b>輪空</b>'
        : '<span>你在第</span><b>' + esc(mine.table) + '</b><span>桌</span>')
    : '<span>本輪</span><b>—</b>';

  var opp = '';
  if (mine && mine.b !== null && mine.b !== undefined) {
    opp = '對手　' + esc(nameOf(st, mine.a === meId ? mine.b : mine.a));
  }

  el('meBar').innerHTML =
    '<span class="who">' + esc(me.name) + '</span>' +
    '<span class="rec">' + (row ? '第 ' + row.rank + ' 名　' + row.w + '-' + row.l +
      (row.d ? '-' + row.d : '') + '　' + row.pts + ' 分' : '') + '</span>' +
    '<span class="rec">' + opp + '</span>' +
    '<button class="sm" id="btnNotMe">不是我</button>' +
    '<span class="at">' + at + '</span>';

  var b = el('btnNotMe');
  if (b) b.onclick = function () {
    meId = ''; localStorage.removeItem(ME_KEY); render(store.get());
  };
}

el('meList').addEventListener('click', function (e) {
  var d = e.target.closest('.nm'); if (!d) return;
  meId = d.dataset.id;
  localStorage.setItem(ME_KEY, meId);
  render(store.get());
});

el('fServer').oninput = function () {
  var v = el('fServer').value.trim();
  localStorage.setItem(SRV_KEY, v);
  net.setServer(v);
};

el('btnHost').onclick = function () {
  if (!el('fServer').value.trim()) { toast('先填房間伺服器位址', true); return; }
  net.host(store.get()).catch(function (e) { toast('開房失敗：' + e.message, true); });
};
el('btnJoin').onclick = function () {
  if (!el('fServer').value.trim()) { toast('先填房間伺服器位址', true); return; }
  net.join(el('fJoin').value).then(function () {
    goTab('tPlay');
  }).catch(function (e) { toast('加入失敗：' + e.message, true); });
};
el('btnLeave').onclick = function () {
  if (!confirmOnce('leave', '離線之後這臺就變回單機，其他裝置看不到你的操作 —— 再按一次確定')) return;
  net.leave();
};

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

  var has = st.matches.length > 0;
  el('tabPlay').disabled = !has;
  el('tabRank').disabled = !st.players.length;

  if (!drafting) paintRoster(st.players);
  syncPlayerBox(st);
  el('hintWin').textContent = st.config.rules.win;
  el('hintDraw').textContent = st.config.rules.draw;
  el('hintLoss').textContent = st.config.rules.loss;

  applyTheme(st);
  paintMatches(st);
  paintMe(st);
  paintRank(st);
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

  el('matchList').innerHTML = ms.map(function (m) {
    var live = st.config.liveTable && m.table === st.config.liveTable;
    var mine = net.role === 'watch' && meId && (m.a === meId || m.b === meId);
    var h = '<div class="mt' + (m.result ? ' done' : '') + (live ? ' islive' : '') +
            (mine ? ' mine' : '') + '">' +
            '<div class="tb">' + esc(m.table) + '</div>';
    h += side(st, m, 'a');
    if (m.b === null || m.b === undefined) {
      h += '<div class="sd bye">輪空 · 視同勝</div>';
    } else {
      h += '<div class="dw' + (m.result === 'draw' ? ' on' : '') + '" data-t="' +
           esc(m.table) + '" data-r="draw">平手</div>' + side(st, m, 'b');
    }
    return h + '</div>';
  }).join('');
}
function side(st, m, which) {
  var id = which === 'a' ? m.a : m.b;
  var cls = 'sd';
  if (m.result === which) cls += ' win';
  else if (m.result && m.result !== 'draw' && m.result !== 'bye') cls += ' lose';
  return '<div class="' + cls + '" data-t="' + esc(m.table) + '" data-r="' + which + '">' +
         '<i>' + numOf(st, id) + '</i><span class="who">' + esc(nameOf(st, id)) + '</span></div>';
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
  rows.forEach(function (r) {
    var idx = live.indexOf(r);
    var inCut = cut && !r.dropped && idx > -1 && idx < cut;
    h += '<tr class="' + (inCut ? 'cut ' : '') + (cut && idx === cut - 1 ? 'cutline ' : '') +
         (r.dropped ? 'out' : '') + '">' +
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
  return '<div class="' + cls + '" style="font-size:' + f + 'vw">' +
         '<i style="font-size:' + (f * .74) + 'vw">' + numOf(st, id) + '</i>' +
         '<span class="nm2">' + esc(nameOf(st, id)) + '</span>' + tag +
         '<span class="rec" style="font-size:' + (f * .6) + 'vw">' + (rank[id] || '') + '</span></div>';
}

function paintPvRank(st) {
  var rows = E.standings(st.players, st.matches, st.config.rules).slice(0, 16);
  var cut = st.config.cut || 0;
  var played = rows.some(function (r) { return r.played > 0; });
  var rowsN = Math.ceil(rows.length / 2) || 1;
  var vh = 100 * (window.innerHeight || 900) / (window.innerWidth || 1600);
  var f = Math.max(.8, Math.min(2.6, (vh * 0.74) / rowsN * 0.42));

  var h = '<div class="pv-rank" style="grid-template-rows:repeat(' + rowsN + ',1fr)">';
  rows.forEach(function (r) {
    h += '<div class="pv-rk' + (cut && played && r.rank <= cut ? ' in' : '') +
         (r.dropped ? ' out' : '') + '" style="padding:' + (f * .16) + 'vw ' + (f * .6) + 'vw">' +
         '<b style="font-size:' + (f * 1.15) + 'vw;flex-basis:' + (f * 1.8) + 'vw">' + r.rank + '</b>' +
         '<i style="font-size:' + (f * .56) + 'vw">' + r.no + '</i>' +
         '<span style="font-size:' + f + 'vw">' + esc(r.name) + '</span>' +
         '<em style="font-size:' + (f * .62) + 'vw">' + r.w + '-' + r.l + (r.d ? '-' + r.d : '') + '</em>' +
         '<u style="font-size:' + (f * 1.05) + 'vw;flex-basis:' + (f * 1.9) + 'vw">' + r.pts + '</u></div>';
  });
  el('pvBody').innerHTML = h + '</div>';
}

/* ── 每 250ms 更新時鐘（資料變動由 Store 推）──────────── */
function tick() {
  var st = store.get(), d = new Date();
  el('wallClock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());

  var ms = remainMs(st), has = st.timer.durMs > 0;
  var txt = has ? fmtCount(ms) : '';
  el('roundClock').textContent = has ? (st.timer.running ? txt : txt + '（暫停）') : '不計時';
  el('btnTimer').textContent = st.timer.running ? '暫停計時' : '開始計時';
  el('btnTimer').style.display = has ? '' : 'none';

  var c = el('pvCount');
  el('pvClock').textContent = has ? txt : '--:--';
  el('pvLabel').textContent = !has ? '不計時' : (ms < 0 ? '已　超　時' : (st.timer.running ? '本輪剩餘' : '暫停中'));
  c.classList.toggle('warn', has && ms > 30000 && ms <= 120000);
  c.classList.toggle('urgent', has && ms <= 30000);
}

store.subscribe(function (st) {
  if (!fillForm._once) { fillForm(st); fillForm._once = true; }
  render(st);
  /* 主控端：本機一有變動就把整份狀態推上去。
     applyingRemote 擋掉「收到推送 → 套用 → 又推回去」的迴圈。 */
  if (!applyingRemote && net.role === 'host') net.pushState(st);
});

el('fServer').value = localStorage.getItem(SRV_KEY) || DEFAULT_SERVER;
net.resume();
['fFormat', 'fNaming'].forEach(function (id) { el(id).onchange = syncFormatFields; });
['fTables', 'fCustom'].forEach(function (id) { el(id).oninput = function () { updateTableHint(); }; });

addEventListener('resize', function () { render(store.get()); });
tick(); setInterval(tick, 250);
updateTableHint();
})();
