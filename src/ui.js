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

/* ── 名單 ───────────────────────────────────────────── */
el('btnParse').onclick = function () {
  var list = S.parsePlayers(el('fPlayers').value);
  if (!list.length) { toast('看不出名字，一行一位試試', true); return; }
  drafting = list;
  paintRoster(list);
  el('playerMsg').innerHTML = '<span class="ok">讀到 ' + list.length + ' 位</span>';
  if (el('fFormat').value === 'swiss') el('fRounds').value = E.suggestRounds(list.length);
  updateTableHint();
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

/* ── 投影模式 ───────────────────────────────────────── */
function setPresent(on) {
  document.body.classList.toggle('present', on);
  if (on && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(function () {});
  } else if (!on && document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(function () {});
  }
  if (on) location.hash = 'present'; else if (location.hash === '#present') history.replaceState(null, '', location.pathname);
  render(store.get());
}
el('btnPresent').onclick = function () { setPresent(true); };
addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && document.body.classList.contains('present')) setPresent(false);
  if (!document.body.classList.contains('present')) return;
  if (e.key === '1') { pvMode = 'matches'; render(store.get()); }
  if (e.key === '2') { pvMode = 'rank'; render(store.get()); }
});
el('present').addEventListener('click', function (e) {
  if (e.target.closest('.pv-ft')) return;
  pvMode = (pvMode === 'matches') ? 'rank' : 'matches';
  render(store.get());
});
if (location.hash === '#present') setPresent(true);

/* ── 畫面 ───────────────────────────────────────────── */
function render(st) {
  el('evtLabel').textContent = st.event.name
    ? st.event.name + (st.event.date ? '　' + st.event.date : '')
    : '尚未設定賽事';

  var has = st.matches.length > 0;
  el('tabPlay').disabled = !has;
  el('tabRank').disabled = !st.players.length;

  if (!drafting) paintRoster(st.players);
  el('hintWin').textContent = st.config.rules.win;
  el('hintDraw').textContent = st.config.rules.draw;
  el('hintLoss').textContent = st.config.rules.loss;

  paintMatches(st);
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
    var h = '<div class="mt' + (m.result ? ' done' : '') + (live ? ' islive' : '') + '">' +
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
});
['fFormat', 'fNaming'].forEach(function (id) { el(id).onchange = syncFormatFields; });
['fTables', 'fCustom'].forEach(function (id) { el(id).oninput = function () { updateTableHint(); }; });

addEventListener('resize', function () { render(store.get()); });
tick(); setInterval(tick, 250);
updateTableHint();
})();
