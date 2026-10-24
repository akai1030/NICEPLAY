/* ============================================================
   NICEPLAY · 匯出 CSV
   ------------------------------------------------------------
   名次表與對戰紀錄要寫成哪幾欄、每一格怎麼跳脫 —— 從 ui.js 搬出來，
   不碰畫面，Node 也跑得動（test/csv.test.js）。下載那一步留在 ui.js。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('./fmt.js'));
  } else root.Csv = factory(root.Engine, root.Fmt);
})(typeof self !== 'undefined' ? self : this, function (E, F) {
'use strict';

var nameOf = F.nameOf, numOf = F.numOf, roundLabel = F.roundLabel;

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

/* 整份檔案：開頭的 BOM（\uFEFF）讓 Excel 認得是 UTF-8，換行用 CRLF */
function csvText(rows) {
  return '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
}

function rankRows(st) {
  var out = [['名次', '編號', '選手', '勝', '敗', '平手', '輪空', '積分',
              'OMW%', 'OOMW%', '狀態']];
  E.standings(st.players, st.matches, st.config.rules).forEach(function (r) {
    out.push([r.rank, r.no, r.name, r.w, r.l, r.d, r.byes, r.pts,
              (r.omw * 100).toFixed(1), (r.oomw * 100).toFixed(1),
              r.dropped ? '退賽' : '']);
  });
  return out;
}

/* 對戰紀錄：一場一列，含小局比分 —— BO3 打成 2-1 的話兩邊都看得到。 */
function logRows(st) {
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
  return out;
}

return { csvCell: csvCell, csvText: csvText, rankRows: rankRows, logRows: logRows };
});
