/* ============================================================
   NICEPLAY · 賽後成績單（選手手機上那張可以存下來轉發的圖）
   ------------------------------------------------------------
   從 ui.js 搬出來。draw 只碰傳進來的那張畫布，不找 DOM；
   每一輪要寫什麼由 roundRows 決定，那一段是純函式。
   Node 也跑得動（test/card.test.js 用假的 2D context 記下畫了什麼）。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('./fmt.js'));
  } else root.Card = factory(root.Engine, root.Fmt);
})(typeof self !== 'undefined' ? self : this, function (E, F) {
'use strict';

var nameOf = F.nameOf, roundLabel = F.roundLabel;

/* 選手會自己轉發的東西 —— 對店家等於免費宣傳，所以主辦單位要在上面。
   用 Canvas 畫而不是截圖：截圖會把手機的狀態列、瀏覽器網址列一起帶進去，
   而且每支手機的比例都不一樣。這裡固定 1080×1350（IG 直式），
   誰的手機畫出來都一樣。 */
function draw(cv, st, me) {
  var g = cv.getContext('2d');
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
  roundRows(st, me.id).forEach(function (row) {
    y += 62;
    g.fillStyle = dim; g.font = '34px ' + MO;
    g.fillText(row.round, 80, y);
    g.fillStyle = fg; g.font = '38px ' + CN;
    g.fillText(row.opp, 260, y);
    g.textAlign = 'right';
    if (row.score) {
      g.fillStyle = dim; g.font = '32px ' + MO;
      g.fillText(row.score, W - 200, y);
    }
    g.fillStyle = (row.tag === '勝') ? '#FF2ED1' : dim;
    g.font = '700 36px ' + CN;
    g.fillText(row.tag, W - 80, y);
    g.textAlign = 'left';
  });

  g.fillStyle = dim; g.font = '28px ' + MO;
  g.fillText('NICEPLAY · niceplay.transtation.org', 80, H - 60);
}

/* 每一輪打了誰：{ round, opp, score, tag }。最多 9 輪 —— 畫布只排得下這麼多。
   score 只有 BO 制才有（「2-1」，站在我這邊）；是空字串就不畫。 */
function roundRows(st, meId) {
  return st.matches.filter(function (m) { return m.a === meId || m.b === meId; })
    .slice(0, 9).map(function (m) {
      var bye = (m.b === null || m.b === undefined);
      var iAmA = (m.a === meId);
      var gm = E.tallyGames(E.gamesOf(m));
      return {
        round: String(roundLabel(m.round)),
        opp: bye ? '—' : nameOf(st, iAmA ? m.b : m.a),
        score: (!bye && (m.bo || 1) > 1) ? (iAmA ? gm.a + '-' + gm.b : gm.b + '-' + gm.a) : '',
        tag: bye ? (m.result === 'noshow' ? '未到' : '輪空')
           : !m.result ? '進行中'
           : m.result === 'draw' ? '平手'
           : (((m.result === 'a') === iAmA) ? '勝' : '敗')
      };
    });
}

return { draw: draw, roundRows: roundRows };
});
