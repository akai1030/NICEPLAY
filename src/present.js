/* ============================================================
   NICEPLAY · 投影畫面的內容
   ------------------------------------------------------------
   投影那一層要寫什麼、字要多大，從 ui.js 搬出來的純函式。
   視窗大小、現在幾點、倒數還剩多久、QR 圖，都由 ui.js 量好傳進來，
   這裡不碰 DOM、不看時鐘 —— 所以 Node 也跑得動（test/present.test.js）。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('./fmt.js'));
  } else root.Present = factory(root.Engine, root.Fmt);
})(typeof self !== 'undefined' ? self : this, function (E, F) {
'use strict';

var esc = F.esc, pad = F.pad, nameOf = F.nameOf, numOf = F.numOf, roundLabel = F.roundLabel;

/* 左上角那個小標：R3、四強 */
function tagText(r) {
  return r === null ? '—' : (typeof r === 'number' ? 'R' + r : r.replace('賽', ''));
}

/* 頁尾：這一輪回報到哪裡了。ms＝這一輪的場次 */
function footText(r, ms) {
  if (r === null) return '';
  /* 只比 null，跟原本一樣：輪空的 b 存的是 null */
  var playable = ms.filter(function (m) { return m.b !== null; });
  var done = playable.filter(function (m) { return m.result; }).length;
  return roundLabel(r) + '　已回報 ' + done + '/' + playable.length +
         (done < playable.length ? '　·　尚有 ' + (playable.length - done) + ' 桌未回報' : '　·　全部回報完畢');
}

/* ── 賽程總覽 ─────────────────────────────────────────
   選手第三常問的是「還要打多久」。開場與換輪的空檔投這一頁，
   等於自動回答，主辦不用一直被同一句話打斷。

   預計結束時間是「參考值」不是「狀態」—— 換輪永遠是主辦按下去才發生，
   這個數字不會去推動任何東西，只是照現在的設定算給大家看。
   所以標題直接寫「預計」，而且時間到了也不會自己往下跑。

   o.now＝現在的時間（毫秒）、o.remainMs＝這一輪倒數還剩多久、
   o.url＝選手查詢網址（沒開房間就是空的）、o.qr＝那條網址的 QR（SVG 字串）。 */
function planHTML(st, r, o) {
  var cfg = st.config;
  var total = cfg.format === 'swiss' ? cfg.rounds : 0;
  var doneR = E.countRounds(st.matches);
  var nowR = (typeof r === 'number') ? r : doneR;
  var left = total ? Math.max(0, total - nowR) : 0;
  var alivePlayers = st.players.filter(function (p) { return !p.dropped; }).length;

  var mins = cfg.minutes || 0;
  var remainNow = Math.max(0, Math.ceil(o.remainMs / 60000));
  var eta = '';
  if (mins && total) {
    /* 這一輪剩下的 + 之後每一輪，各多留五分鐘給回報與換位 */
    var totalMin = remainNow + left * (mins + 5);
    var d = new Date(o.now + totalMin * 60000);
    eta = pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  var cells = [
    ['ROUND', total ? nowR + ' / ' + total : String(nowR || '—'), total ? '第幾輪' : '輪次'],
    ['PLAYERS', String(alivePlayers), '目前人數'],
    ['CLOCK', mins ? mins + ' 分' : '不計時', '每輪時間'],
    ['ETA', eta || '—', eta ? '預計結束（參考）' : '未設定時間']
  ];

  var h = '<div class="pv-plan">' +
    '<div class="pv-plan-hd">' +
      '<b>' + esc(st.event.name || 'NICEPLAY') + '</b>' +
      (st.event.host ? '<span>主辦　' + esc(st.event.host) + '</span>' : '') +
      '<em>' + esc(F.formatLabel(cfg)) + '</em>' +
    '</div>' +
    '<div class="pv-plan-grid">' +
      cells.map(function (c) {
        return '<div class="pv-cell"><i>' + c[0] + '</i><b>' + esc(c[1]) +
               '</b><span>' + esc(c[2]) + '</span></div>';
      }).join('') +
    '</div>';

  if (o.url) {
    h += '<div class="pv-plan-qr"><div class="pv-plan-qrimg">' + o.qr + '</div>' +
         '<div class="pv-plan-qrcap"><b>掃我查自己的桌號與名次</b>' +
         '<span>不用註冊、不用安裝，掃了就看得到</span></div></div>';
  }
  return h + '</div>';
}

/* 欄數不用公式猜 —— 1 到 maxCols 欄各試一次，挑「字能最大」的那個。
   n＝要排幾格；vh＝視窗高度換算成 vw（寬 100）；
   wPer／hPer＝一格橫向、縱向各要幾個字寬。只用畫面高度的 74%（上下留給標題與頁尾）。
   回傳 { f, cols, rows }，f 是還沒夾上下限的字級（vw）。 */
function fitGrid(n, vh, maxCols, wPer, hPer) {
  var best = { f: 0, cols: 1, rows: n };
  for (var c = 1; c <= Math.min(maxCols, n); c++) {
    var rN = Math.ceil(n / c);
    var cw = 100 / c, ch = (vh * 0.74) / rN;
    var fit = Math.min(cw / wPer, ch / hPer);
    if (fit > best.f) best = { f: fit, cols: c, rows: rN };
  }
  return best;
}

/* ── 對戰表 ───────────────────────────────────────────
   一張卡橫向要放：桌號圈 + 編號籤 + 名字 + 勝 + 戰績 + 間距 ≈ 13.5 個字寬；
   縱向要放：兩行 + VS + 內距 ≈ 3.5 個字高。最多 6 欄。 */
function matchesHTML(st, ms, vh) {
  var best = fitGrid(ms.length, vh, 6, 13.5, 3.5);
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
    h += line(st, m, 'a', f, rank);
    if (m.b === null || m.b === undefined) {
      h += '<div class="pv-vs" style="font-size:' + (f * .5) + 'vw">BYE</div>' +
           '<div class="pv-p pv-empty" style="font-size:' + (f * .92) + 'vw">輪空 · 視同勝</div>';
    } else {
      h += '<div class="pv-vs" style="font-size:' + (f * .5) + 'vw">VS</div>' +
           line(st, m, 'b', f, rank);
    }
    h += '</div></div>';
  });
  return h + '</div>';
}

/* 對戰卡裡的一個人。rank＝{ id: '2-1' }，戰績那一小段 */
function line(st, m, which, f, rank) {
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

/* ── 名次 ─────────────────────────────────────────────
   名次投影是頒獎跟散場前最後一個畫面，所以：
     · 全部的人都要上得去。切到前 16 名，第 17 名以後的人看不到自己。
     · 前四名要一眼認得出來 —— 那是有獎的名次。
   欄數跟對戰表一樣用試的：一到四欄各算一次，挑「字能最大」的那個。
   一列橫向大約放得下 20 個字寬（名次 + 編號 + 名字 + 戰績 + 積分）。 */
function rankHTML(st, vh) {
  var rows = E.standings(st.players, st.matches, st.config.rules);
  var cut = st.config.cut || 0;
  var played = rows.some(function (r) { return r.played > 0; });
  var live = rows.filter(function (r) { return !r.dropped; });

  var best = fitGrid(rows.length || 1, vh, 4, 20, 1.75);
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
  return h + '</div>';
}

return {
  tagText: tagText, footText: footText, planHTML: planHTML, fitGrid: fitGrid,
  matchesHTML: matchesHTML, line: line, rankHTML: rankHTML
};
});
