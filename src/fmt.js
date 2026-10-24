/* ============================================================
   NICEPLAY · 共用的小工具
   ------------------------------------------------------------
   從 ui.js 搬出來的純函式：跳脫、時間、查名字與編號、輪次名稱、
   賽制寫成人話、檔名、幾勝制說明、桌號排序、搜尋比對、版本號。
   不碰畫面、不碰 localStorage，Node 也跑得動（test/fmt.test.js）。

   介面那邊用同名的區域變數接過去（var esc = F.esc …），
   所以 ui.js 裡呼叫的寫法一個字都不用改。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Fmt = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {
'use strict';

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

function nameOf(st, id) {
  if (id === null || id === undefined) return '輪空';
  for (var i = 0; i < st.players.length; i++) if (st.players[i].id === id) return st.players[i].name;
  return '？';
}

function numOf(st, id) {
  for (var i = 0; i < st.players.length; i++) if (st.players[i].id === id) return st.players[i].no;
  return '';
}

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

function eventTitle(e) {
  var bits = [e.host, e.name || '（未命名）', e.date].filter(Boolean).join('　');
  var tail = e.players ? '　' + e.players + ' 人' : '';
  if (e.rounds) tail += ' · ' + e.rounds + ' 輪';
  return bits + tail;
}

/* 幾勝制講清楚兩件現場一定會問的事：要贏幾局、平手怎麼算。
   bo / boKO 是設定頁目前選的值，format 是賽制（雙敗要多講一句）。 */
function boHint(hasNormal, hasKO, bo, boKO, format) {
  var parts = [];
  if (hasNormal) parts.push('常規賽 ' + boWord(bo));
  if (hasKO) parts.push('淘汰賽 ' + boWord(boKO));
  if (format === 'double') {
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

/* 版本號從 script 網址上的版本章讀回來（tools/stamp.sh 蓋的 ?v=YYYYMMDDHHmm）。
   沒有版本章就是本機直接開的開發版。 */
function versionLabel(src) {
  var m = src && src.match(/[?&]v=(\d+)/);
  if (!m) return '開發版';
  var v = m[1];
  return v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8) + ' ' +
         v.slice(8, 10) + ':' + v.slice(10, 12);
}

return {
  esc: esc, pad: pad, fmtCount: fmtCount, nameOf: nameOf, numOf: numOf, recMap: recMap,
  currentRound: currentRound, matchesOf: matchesOf, roundLabel: roundLabel,
  formatLabel: formatLabel, fileStem: fileStem, eventTitle: eventTitle,
  boHint: boHint, boWord: boWord, byTableName: byTableName, norm: norm,
  matchMatches: matchMatches, versionLabel: versionLabel
};
});
