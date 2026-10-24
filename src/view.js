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

var esc = F.esc, eventTitle = F.eventTitle;

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

return {
  rosterHTML: rosterHTML, tableHintHTML: tableHintHTML,
  eventOptionsHTML: eventOptionsHTML, eventHintHTML: eventHintHTML
};
});
