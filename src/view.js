/* ============================================================
   NICEPLAY · 控制台的畫面片段
   ------------------------------------------------------------
   設定、對戰、排名三頁要畫的 HTML，從 ui.js 搬出來的純函式：
   吃狀態、吐字串，不碰 DOM、不讀輸入框（輸入框的值由 ui.js 讀好傳進來）。
   Node 也跑得動（test/view.test.js）。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('./fmt.js'));
  } else root.View = factory(root.Engine, root.Fmt);
})(typeof self !== 'undefined' ? self : this, function (E, F) {
'use strict';

var esc = F.esc, eventTitle = F.eventTitle, nameOf = F.nameOf, numOf = F.numOf,
    byTableName = F.byTableName, matchMatches = F.matchMatches, norm = F.norm;

/* ── 設定頁 ─────────────────────────────────────────── */

/* 名單一人一格。設定頁的「名單」與對戰頁還沒開賽時的那一份長得一樣 */
function rosterHTML(list) {
  return list.map(function (p) {
    return '<div class="nm' + (p.dropped ? ' out' : '') + '"><i>' + p.no + '</i>' +
           '<span>' + esc(p.name) + '</span></div>';
  }).join('');
}

/* 桌數提示。n＝還在場上的人數；typed＝桌數欄填的數字（沒填是 NaN，就照人數建議） */
function tableHintHTML(n, typed, naming, custom) {
  var count = typed || E.suggestTables(n);
  var names = E.makeTables(Math.min(count, 60), naming, custom);
  var head = names.slice(0, 8).join('、') + (count > 8 ? ' …… ' + names[Math.min(count, 60) - 1] : '');
  return n + ' 人 → 需要 <b>' + E.suggestTables(n) + '</b> 桌，' +
    '目前設定 <b>' + count + '</b> 桌：' + esc(head);
}

/* 賽事清單的選項：現在這一場排第一，後面是收起來的那幾場 */
function eventOptionsHTML(st, lib) {
  var opts = ['<option value="' + esc(st.id) + '">' +
              esc(eventTitle({ host: st.event.host, name: st.event.name, date: st.event.date,
                               players: st.players.length,
                               rounds: E.countRounds(st.matches) })) +
              '　←　現在</option>'];
  lib.forEach(function (e) {
    opts.push('<option value="' + esc(e.id) + '">' + esc(eventTitle(e)) + '</option>');
  });
  return opts.join('');
}

function eventHintHTML(others) {
  return others
    ? '另外還有 <b>' + others + '</b> 場存在這臺電腦裡。切換不會動到任何一場的成績。'
    : '目前只有這一場。按「新增一場」會把現在這場收起來，開一個全新的。';
}

/* ── 對戰頁 ─────────────────────────────────────────── */

/* 排序與搜尋只影響「看到什麼」。byTable＝依桌號排；q＝搜尋框的字（已經 norm 過） */
function visibleMatches(st, ms, byTable, q) {
  var view = ms.slice();
  if (byTable) view.sort(byTableName);
  if (q) view = view.filter(function (m) { return matchMatches(st, m, q); });
  return view;
}

/* 搜尋框底下那一行。raw 是搜尋框原本的字（找不到的時候照打的樣子講回去） */
function findMsg(q, raw, shown, total) {
  return q
    ? (shown ? '符合的 ' + shown + ' 桌（共 ' + total + ' 桌）'
             : '找不到「' + raw.trim() + '」')
    : '';
}

/* 一桌一張對戰卡。rm＝戰績查表（recMap）；me＝選手查詢模式下「我」的 id，
   其他身分傳空字串（主控與副控不需要標出自己）。 */
function matchCardHTML(st, m, rm, me) {
  var live = st.config.liveTable && m.table === st.config.liveTable;
  var mine = me && (m.a === me || m.b === me);
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
}

function matchListHTML(st, view, rm, me) {
  return view.map(function (m) { return matchCardHTML(st, m, rm, me); }).join('');
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

/* ── 排名頁 ─────────────────────────────────────────── */

function rankTitle(cut) {
  return cut ? '即時名次 · 前 ' + cut + ' 名晉級' : '即時名次';
}

/* 排名頁整頁要放什麼。q＝搜尋框的字（已經 norm 過），raw＝原本打的字。
   回傳 { html, title }；title 是 null 表示標題不用動（還沒有名單的時候，原本就不碰它）。 */
function rankView(st, q, raw) {
  if (!st.players.length) return { html: '<div class="hint">還沒有名單。</div>', title: null };

  /* 分組賽的名次一定要分組看。把各組混在一起排，數字就沒有意義了 ——
     A 組第 1 跟 B 組第 1 打的是完全不同的一批人，積分不可比。 */
  var gids = E.groupIds(st.config);
  if (gids.length >= 2 && st.players.some(function (p) { return p.group; })) {
    var html = gids.map(function (g) {
      var gp = E.inGroup(st.players, g);
      if (!gp.length) return '';
      var gm = E.groupMatches(st.matches, gp.map(function (p) { return p.id; }));
      return '<h3 class="grp">' + g + ' 組　<span>' + gp.length + ' 人</span></h3>' +
             rankTableHTML(st, gp, gm, q, raw);
    }).join('');
    var per = Math.max(1, Math.floor((st.config.cut || 0) / gids.length));
    return { html: html,
             title: st.config.cut ? '分組名次 · 各組前 ' + per + ' 名晉級' : '分組名次' };
  }
  return { html: rankTableHTML(st, st.players, st.matches, q, raw), title: rankTitle(st.config.cut || 0) };
}

function rankTableHTML(st, players, matches, q, raw) {
  var rows = E.standings(players, matches, st.config.rules);
  var live = rows.filter(function (r) { return !r.dropped; });
  var cut = st.config.cut || 0;

  /* 搜尋只藏列，名次照原本算 —— 篩出來的那個人旁邊還是他真正的名次，
     不會因為只剩他一列就變成第 1 名。 */
  var shown = q ? rows.filter(function (r) {
    return norm(r.name).indexOf(q) >= 0 || String(r.no) === q;
  }) : rows;
  if (q && !shown.length) {
    return '<div class="hint">找不到「' + esc(raw.trim()) +
           '」。這一份名單上共 ' + rows.length + ' 人。</div>';
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
  return h + '</tbody></table>';
}

/* ── 桌卡 ─────────────────────────────────────────── */

/* 要印桌卡的場次：輪空的人沒有桌子要坐，所以不印；照桌號排，印出來才好發。 */
function tentMatches(st, r) {
  return F.matchesOf(st, r).filter(function (m) { return m.b !== null && m.b !== undefined; })
                           .sort(byTableName);
}

function tentsHTML(st, ms) {
  var head = [st.event.host, st.event.name].filter(Boolean).join('　·　');
  return ms.map(function (m) {
    var bo = m.bo || 1;
    return '<div class="tent">' +
      '<div class="tent-hd">' + esc(head) + '<b>' + esc(F.roundLabel(m.round)) + '</b></div>' +
      '<div class="tent-no">' + esc(m.table) + '</div>' +
      '<div class="tent-p"><i>' + numOf(st, m.a) + '</i>' + esc(nameOf(st, m.a)) + '</div>' +
      '<div class="tent-vs">VS' + (bo > 1 ? '　·　BO' + bo + '　先贏 ' + E.winsNeeded(bo) + ' 局' : '') + '</div>' +
      '<div class="tent-p"><i>' + numOf(st, m.b) + '</i>' + esc(nameOf(st, m.b)) + '</div>' +
      '</div>';
  }).join('');
}

return {
  rosterHTML: rosterHTML, tableHintHTML: tableHintHTML,
  eventOptionsHTML: eventOptionsHTML, eventHintHTML: eventHintHTML,
  visibleMatches: visibleMatches, findMsg: findMsg,
  matchCardHTML: matchCardHTML, matchListHTML: matchListHTML, side: side, pipsOf: pipsOf,
  rankTitle: rankTitle, rankView: rankView, rankTableHTML: rankTableHTML,
  tentMatches: tentMatches, tentsHTML: tentsHTML
};
});
