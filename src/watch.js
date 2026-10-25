/* ============================================================
   NICEPLAY · 選手查詢畫面的內容
   ------------------------------------------------------------
   選手手機上那一頁要寫什麼，從 ui.js 搬出來的純函式：
   吃狀態與「我是誰」（meId），吐字串，不碰 DOM。
   選手要知道的只有三件事：我在第幾桌、本輪誰打誰、我現在第幾名。
   Node 也跑得動（test/watch.test.js）。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('./fmt.js'));
  } else root.Watch = factory(root.Engine, root.Fmt);
})(typeof self !== 'undefined' ? self : this, function (E, F) {
'use strict';

var esc = F.esc, nameOf = F.nameOf, roundLabel = F.roundLabel;

/* 這一頁的狀態是從主辦那臺經過房間伺服器傳過來的，不是這支手機自己算的。
   所以拼進 HTML 的東西一律過一手：字串（含 id）用 esc()，
   數字欄位（編號、名次、勝敗和、積分、BO、各局比數）用 Number() 轉過 ——
   正常的資料轉完一模一樣，被動過手腳的資料頂多變成 NaN，不會變成標籤。 */

/* 名單裡哪一位是我。找不到（還沒選、或主辦換了名單）就是 null */
function findMe(st, meId) {
  var me = null;
  st.players.forEach(function (p) { if (p.id === meId) me = p; });
  return me;
}

/* 還沒選自己是誰的時候，讓選手從名單點自己 */
function pickListHTML(players) {
  return players.map(function (p) {
    return '<div class="nm" data-id="' + esc(p.id) + '"><i>' + Number(p.no) + '</i>' +
           '<span>' + esc(p.name) + '</span></div>';
  }).join('') || '<div class="hint">主辦還沒讀入名單。</div>';
}

/* 畫面最上面那一大塊：「你在第 _ 桌」與對手。
   回傳 { lead, table, tail, small, opp }：lead／table／tail 是純文字，
   small＝桌號那格要不要縮小（放的是一句話、不是桌號的時候），opp 是 HTML。 */
function myTable(st, r, meId) {
  var mine = null;
  F.matchesOf(st, r).forEach(function (m) { if (m.a === meId || m.b === meId) mine = m; });

  if (!mine) {
    return { lead: '', tail: '', table: r === null ? '尚未開始' : '本輪沒有你的場次',
             small: true, opp: '' };
  }
  if (mine.b === null || mine.b === undefined) {
    return { lead: '本輪', tail: '', table: '輪空', small: false,
             opp: '這一輪不用打，直接算一勝。' };
  }
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
    var ga = Number(mg.a), gb = Number(mg.b);
    tail += '　<span class="sc">' + (mineIsA ? ga + '-' + gb : gb + '-' + ga) +
            (mg.draw ? '（平 ' + Number(mg.draw) + '）' : '') +
            '　BO' + Number(mbo) + '　先贏 ' + Number(E.winsNeeded(mbo)) + ' 局</span>';
  }
  return { lead: '你在第', tail: '桌', table: mine.table, small: false,
           opp: '對手　<b>' + esc(nameOf(st, oppId)) + '</b>' + tail };
}

/* 「目前第 3 名　2 勝 1 敗　6 分」。名單上找不到我就是空字串 */
function statText(st, meId) {
  var row = null;
  E.standings(st.players, st.matches, st.config.rules).forEach(function (x) {
    if (x.id === meId) row = x;
  });
  return row
    ? '目前第 ' + row.rank + ' 名　' + row.w + ' 勝 ' + row.l + ' 敗' +
      (row.d ? ' ' + row.d + ' 平' : '') + '　' + row.pts + ' 分'
    : '';
}

/* 成績單只在真的有成績之後才出現 —— 還沒打就給一張空的沒有意義 */
function hasPlayed(st, meId) {
  return st.matches.some(function (m) {
    return (m.a === meId || m.b === meId) && m.result;
  });
}

/* 我打過（或正在打）的每一場 */
function myMatches(st, meId) {
  return st.matches.filter(function (m) { return m.a === meId || m.b === meId; });
}

/* 我的每一輪：打過誰、幾比幾。輪空也要列出來，不然選手會以為漏了一輪。 */
function myRoundsHTML(st, mine, meId) {
  return mine.map(function (m) {
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
           ? '<span class="s sc">' + (iAmA ? Number(g.a) + '-' + Number(g.b) : Number(g.b) + '-' + Number(g.a)) + '</span>' : '';
    return '<div class="wr' + (win ? ' won' : lose ? ' lost' : '') + '">' +
      '<span class="t">' + esc(String(roundLabel(m.round)).replace('第 ', '').replace(' 輪', '')) + '</span>' +
      '<span class="p">' + (bye ? '—' : esc(nameOf(st, oppId))) + '</span>' + sc + tag +
      '</div>';
  }).join('');
}

function matchTitle(r) {
  return r === null ? '本輪對戰' : roundLabel(r) + '　對戰';
}

/* 本輪對戰（唯讀）。ms＝這一輪的場次 */
function roundMatchesHTML(st, ms, meId) {
  var wrm = F.recMap(st);
  var who = function (id, cls) {
    var rec = wrm[id];
    return '<span class="p' + cls + '">' + esc(nameOf(st, id)) +
           (rec ? '<em class="num">' + esc(rec.rec) + '</em>' : '') + '</span>';   /* rec 是「2-1」這種字串，所以用 esc */
  };
  return ms.length ? ms.map(function (m) {
    var isMine = (m.a === meId || m.b === meId);
    var bye = (m.b === null || m.b === undefined);
    var ca = m.result === 'a' ? ' win' : (m.result === 'b' ? ' lose' : '');
    var cb = m.result === 'b' ? ' win' : (m.result === 'a' ? ' lose' : '');
    var mg = E.tallyGames(E.gamesOf(m));
    var sc = (m.bo || 1) > 1 ? '<span class="x sc">' + Number(mg.a) + '-' + Number(mg.b) + '</span>' : '<span class="x">VS</span>';
    return '<div class="wr' + (isMine ? ' mine' : '') + '">' +
      '<span class="t">' + esc(m.table) + '</span>' + who(m.a, ca) +
      (bye ? '<span class="s">輪空</span>' : sc + who(m.b, cb)) +
      '</div>';
  }).join('') : '<div class="hint">還沒排對戰。</div>';
}

/* 名次（唯讀） */
function rankHTML(st, meId) {
  var rk = E.standings(st.players, st.matches, st.config.rules);
  return rk.length ? rk.map(function (x) {
    return '<div class="wr' + (x.id === meId ? ' mine' : '') + '">' +
      '<span class="n">' + Number(x.rank) + '</span>' +
      '<span class="p">' + esc(x.name) + (x.dropped ? '（退賽）' : '') + '</span>' +
      '<span class="s">' + Number(x.w) + '-' + Number(x.l) + (x.d ? '-' + Number(x.d) : '') + '</span>' +
      '<span class="s">' + Number(x.pts) + ' 分</span>' +
      '</div>';
  }).join('') : '<div class="hint">還沒有成績。</div>';
}

return {
  findMe: findMe, pickListHTML: pickListHTML, myTable: myTable, statText: statText,
  hasPlayed: hasPlayed, myMatches: myMatches, myRoundsHTML: myRoundsHTML,
  matchTitle: matchTitle, roundMatchesHTML: roundMatchesHTML, rankHTML: rankHTML
};
});
