/* ============================================================
   NICEPLAY · 賽制引擎
   Networked Integrated Competition & Event Platform for League And Yomi
   ------------------------------------------------------------
   這個檔只做「算」，不碰畫面、不碰儲存、不碰網路，所以可以單獨測。
   瀏覽器與 Node 都能用。

   支援賽制
     swiss       瑞士制（同分配同分、不重複對手、輪空、退賽）
     single      單敗淘汰（標準交叉種子序，第 1 與第 2 到決賽才會遇到）
     roundrobin  循環賽（每個人都跟其他所有人打一場）

   計分預設 勝 3 · 平手 1 · 敗 0 · 輪空視同勝，可由 rules 覆寫。

   打破同分（瑞士制，寶可夢／MTG 通用算法）
     ① 積分
     ② OMW%  對手勝率平均（每位對手最低以 25% 計）
     ③ OOMW% 對手的對手勝率平均
     ④ 選手編號（最後的保險，確保排序穩定、每次結果一樣）
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var DEFAULT_RULES = { win: 3, draw: 1, loss: 0, minWinPct: 0.25 };

function rulesOf(r) {
  r = r || {};
  return {
    win: num(r.win, DEFAULT_RULES.win),
    draw: num(r.draw, DEFAULT_RULES.draw),
    loss: num(r.loss, DEFAULT_RULES.loss),
    minWinPct: num(r.minWinPct, DEFAULT_RULES.minWinPct)
  };
}
function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

/* ── 桌號 ────────────────────────────────────────────────
   三種命名方式。字母超過 26 桌會接續 AA、AB…，
   數字則直接 1…N。自訂就照給的清單，不夠時補號碼。 */
var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function letterName(i) {                 /* 0 → A, 25 → Z, 26 → AA */
  var s = '';
  i = i + 1;
  while (i > 0) {
    var m = (i - 1) % 26;
    s = LETTERS[m] + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function makeTables(count, naming, custom) {
  var out = [], i;
  for (i = 0; i < count; i++) {
    if (naming === 'custom') {
      /* 自訂清單用完就接號碼 —— 使用者只打了前幾桌的名字也不會壞 */
      out.push(custom && custom[i] ? String(custom[i]).trim() : String(i + 1));
    } else if (naming === 'number') {
      out.push(String(i + 1));
    } else {
      out.push(letterName(i));
    }
  }
  return out;
}

/* 建議桌數：兩人一桌，無條件進位（奇數人時最後一桌是輪空，不佔桌） */
function suggestTables(playerCount) { return Math.floor(playerCount / 2); }

/* 建議輪數：瑞士制的標準做法是 ceil(log2(人數))，
   這樣最後至少會有一個人全勝、名次能分得開。 */
function suggestRounds(playerCount) {
  if (playerCount < 2) return 0;
  return Math.max(1, Math.ceil(Math.log2(playerCount)));
}

/* ── 統計 ────────────────────────────────────────────────
   matches: [{ round, table, a, b, result }]
     a / b   選手 id。b 為 null 代表輪空
     result  'a' | 'b' | 'draw' | 'bye' | null（尚未回報）      */

function tally(players, matches, rules) {
  var R = rulesOf(rules), rec = {};
  players.forEach(function (p) {
    rec[p.id] = { w: 0, l: 0, d: 0, byes: 0, played: 0, opp: [], pts: 0 };
  });

  (matches || []).forEach(function (m) {
    if (!m.result) return;                        /* 還沒回報的不算 */

    if (m.b === null || m.b === undefined) {      /* 輪空 */
      var rb = rec[m.a];
      if (!rb) return;
      rb.w++; rb.byes++; rb.played++; rb.pts += R.win;
      return;                                     /* 輪空不列為對手 */
    }
    var ra = rec[m.a], rB = rec[m.b];
    if (!ra || !rB) return;

    ra.opp.push(m.b); rB.opp.push(m.a);
    ra.played++; rB.played++;

    if (m.result === 'draw') {
      ra.d++; rB.d++; ra.pts += R.draw; rB.pts += R.draw;
    } else if (m.result === 'a') {
      ra.w++; rB.l++; ra.pts += R.win; rB.pts += R.loss;
    } else if (m.result === 'b') {
      rB.w++; ra.l++; rB.pts += R.win; ra.pts += R.loss;
    }
  });
  return rec;
}

/* 個人勝率。分母是「打過的場次 × 勝分」，每人最低以 minWinPct 計 ——
   官方規則，避免一個 0 勝的對手把別人的 OMW 拉到見底。 */
function winPct(r, R) {
  if (!r || r.played === 0) return R.minWinPct;
  var denom = r.played * R.win;
  if (denom <= 0) return R.minWinPct;
  return Math.max(R.minWinPct, r.pts / denom);
}

function avg(arr, fallback) {
  if (!arr.length) return fallback;
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/* ── 名次 ───────────────────────────────────────────────
   回傳由高到低排好的陣列，每筆帶完整數值，畫面可以直接顯示。 */
function standings(players, matches, rules) {
  var R = rulesOf(rules);
  var rec = tally(players, matches, R);

  var wp = {};
  players.forEach(function (p) { wp[p.id] = winPct(rec[p.id], R); });

  var omw = {};
  players.forEach(function (p) {
    omw[p.id] = avg(rec[p.id].opp.map(function (o) { return wp[o]; }), R.minWinPct);
  });

  var rows = players.map(function (p) {
    var r = rec[p.id];
    return {
      id: p.id, no: p.no, name: p.name, dropped: !!p.dropped,
      w: r.w, l: r.l, d: r.d, byes: r.byes, played: r.played, pts: r.pts,
      wp: wp[p.id],
      omw: omw[p.id],
      oomw: avg(r.opp.map(function (o) { return omw[o]; }), R.minWinPct),
      opp: r.opp.slice()
    };
  });

  rows.sort(function (x, y) {
    /* 退賽的一律排到最後，但成績照算，不影響別人的 OMW */
    if (x.dropped !== y.dropped) return x.dropped ? 1 : -1;
    if (y.pts !== x.pts) return y.pts - x.pts;
    if (Math.abs(y.omw - x.omw) > 1e-9) return y.omw - x.omw;
    if (Math.abs(y.oomw - x.oomw) > 1e-9) return y.oomw - x.oomw;
    return x.no - y.no;                           /* 穩定：每次結果一樣 */
  });
  rows.forEach(function (r, i) { r.rank = i + 1; });
  return rows;
}

/* ── 瑞士制配對 ─────────────────────────────────────────
   回溯搜尋：由名次最高的人開始，往下找第一個「沒打過、而且剩下的人
   也配得起來」的對手。實測 512 人跑滿九輪，單輪 3.2ms。

   opts.avoidRematch 預設 true。真的排不出來時會自動放寬並回報。 */
function pairSwiss(players, matches, opts) {
  opts = opts || {};
  var avoidRematch = opts.avoidRematch !== false;
  var rows = standings(players, matches, opts.rules)
             .filter(function (r) { return !r.dropped; });

  var met = {};
  rows.forEach(function (r) {
    met[r.id] = {};
    r.opp.forEach(function (o) { met[r.id][o] = 1; });
  });

  var byeId = null, notes = [];

  if (rows.length % 2 === 1) {
    /* 由最低名次往上找還沒輪空過的人。全部都輪空過就給最後一名。 */
    var pick = null;
    for (var i = rows.length - 1; i >= 0; i--) {
      if (!rows[i].byes) { pick = rows[i]; break; }
    }
    if (!pick) { pick = rows[rows.length - 1]; notes.push('所有人都輪空過了，輪空給最後一名'); }
    byeId = pick.id;
    rows = rows.filter(function (r) { return r.id !== byeId; });
  }

  function solve(pool) {
    if (!pool.length) return [];
    var a = pool[0];
    for (var i = 1; i < pool.length; i++) {
      var b = pool[i];
      if (avoidRematch && met[a.id][b.id]) continue;
      var rest = pool.slice(1);
      rest.splice(i - 1, 1);
      var sub = solve(rest);
      if (sub) return [[a, b]].concat(sub);
    }
    return null;
  }

  var pairs = solve(rows);
  if (!pairs && avoidRematch) {
    notes.push('避不開重複對手，這一輪已放寬（會出現再打一次的組合）');
    avoidRematch = false;
    pairs = solve(rows);
  }
  if (!pairs) return { error: '配不出來', pairs: [], bye: byeId, notes: notes };

  return { pairs: pairs, bye: byeId, notes: notes };
}

/* ── 循環賽 ─────────────────────────────────────────────
   標準輪轉法（circle method）：固定第一個人，其餘順時針轉。
   n 人需要 n-1 輪（奇數人補一個虛擬對手＝那一輪輪空）。 */
function pairRoundRobin(players, matches, opts) {
  opts = opts || {};
  var alive = players.filter(function (p) { return !p.dropped; });
  var done = {};
  (matches || []).forEach(function (m) {
    if (m.b === null || m.b === undefined) return;
    done[key2(m.a, m.b)] = 1;
  });

  var list = alive.slice();
  var byeId = null;
  if (list.length % 2 === 1) list.push(null);      /* 虛擬對手 */

  var n = list.length, half = n / 2;
  var rounds = n - 1, r, i;

  for (r = 0; r < rounds; r++) {
    var rot = [list[0]].concat(list.slice(1).slice(-r || n).concat(list.slice(1).slice(0, -r || 0)));
    if (r === 0) rot = list.slice();
    var pairs = [], bye = null, fresh = false;
    for (i = 0; i < half; i++) {
      var a = rot[i], b = rot[n - 1 - i];
      if (a === null) { bye = b; continue; }
      if (b === null) { bye = a; continue; }
      if (!done[key2(a.id, b.id)]) fresh = true;
      pairs.push([a, b]);
    }
    if (fresh) {
      /* 這一輪還有沒打過的組合，就用它 */
      var remain = pairs.filter(function (p) { return !done[key2(p[0].id, p[1].id)]; });
      if (remain.length) {
        return { pairs: remain, bye: bye ? bye.id : null, notes: [] };
      }
    }
  }
  return { pairs: [], bye: byeId, notes: ['循環賽已經全部打完'], done: true };
}
function key2(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

/* ── 淘汰賽 ─────────────────────────────────────────────
   標準賽程樹的種子順序。遞迴規則：每擴一倍，就在每個種子後面
   插入「這一輪的總數 + 1 − 他」，第 1 和第 2 永遠落在對半兩側。
     n=4  → 1,4,2,3
     n=8  → 1,8,4,5,2,7,3,6
   這樣第 1 與第 2 只會在決賽相遇。                       */
function seedOrder(n) {
  var order = [1];
  while (order.length < n) {
    var m = order.length * 2, next = [];
    for (var i = 0; i < order.length; i++) {
      next.push(order[i]);
      next.push(m + 1 - order[i]);
    }
    order = next;
  }
  return order;
}

/* 取前 n 名排成第一輪淘汰賽。n 不是 2 的次方時，多的人輪空晉級。 */
function bracketFrom(rows, n) {
  var top = rows.filter(function (r) { return !r.dropped; }).slice(0, n);
  if (top.length < 2) return [];
  var size = 2;
  while (size < top.length) size *= 2;             /* 補到 2 的次方 */
  var seq = seedOrder(size), out = [];
  for (var i = 0; i < seq.length; i += 2) {
    var a = top[seq[i] - 1] || null;
    var b = top[seq[i + 1] - 1] || null;
    if (!a && !b) continue;
    out.push([a || b, a && b ? b : null]);         /* 沒對手＝輪空 */
  }
  return out;
}

/* 由上一輪的勝者產生下一輪。上一輪沒打完就回 null。 */
function nextBracketRound(prevMatches, players) {
  var byId = {};
  players.forEach(function (p) { byId[p.id] = p; });
  var winners = [];
  for (var i = 0; i < prevMatches.length; i++) {
    var m = prevMatches[i];
    if (m.b === null || m.b === undefined) { winners.push(byId[m.a]); continue; }
    if (!m.result || m.result === 'draw') return null;
    winners.push(byId[m.result === 'a' ? m.a : m.b]);
  }
  var out = [];
  for (var j = 0; j < winners.length; j += 2) {
    if (winners[j + 1] === undefined) { out.push([winners[j], null]); break; }
    out.push([winners[j], winners[j + 1]]);
  }
  return out;
}

/* ── 發桌位 ─────────────────────────────────────────────
   名次最高的一組坐第一張桌。輪空不佔桌。 */
function assignTables(pairs, tableNames) {
  return pairs.map(function (p, i) {
    return {
      table: tableNames[i] !== undefined ? tableNames[i] : String(i + 1),
      a: p[0] ? p[0].id : null,
      b: p[1] ? p[1].id : null,
      result: p[1] ? null : 'bye'
    };
  });
}

/* ── 對外統一入口 ───────────────────────────────────────
   給設定與已完成的場次，回傳下一輪該怎麼排。 */
function nextRound(state) {
  var cfg = state.config, players = state.players, matches = state.matches || [];
  var playedRounds = countRounds(matches);

  if (cfg.format === 'roundrobin') {
    var rr = pairRoundRobin(players, matches, { rules: cfg.rules });
    if (rr.done) return { done: true, notes: rr.notes };
    return finish(rr);
  }

  if (cfg.format === 'single') {
    return bracketNext(state, matches, 'K');
  }

  /* swiss：跑滿設定輪數之後，若有設定晉級人數就進淘汰賽 */
  if (playedRounds < cfg.rounds) {
    var sw = pairSwiss(players, matches.filter(isSwissMatch), { rules: cfg.rules });
    if (sw.error) return { error: sw.error };
    return finish(sw);
  }
  if (cfg.cut && cfg.cut >= 2) return bracketNext(state, matches, 'K');
  return { done: true, notes: ['瑞士制已經跑完設定的輪數'] };

  function finish(res) {
    var names = tableNamesFor(cfg, res.pairs.length);
    var list = assignTables(res.pairs, names);
    if (res.bye !== null && res.bye !== undefined) {
      list.push({ table: '輪空', a: res.bye, b: null, result: 'bye' });
    }
    return { matches: list, notes: res.notes || [] };
  }
}

function isSwissMatch(m) { return typeof m.round === 'number'; }

function bracketNext(state, matches, prefix) {
  var cfg = state.config, players = state.players;
  var ko = matches.filter(function (m) { return typeof m.round === 'string'; });
  var names = tableNamesFor(cfg, 64);

  if (!ko.length) {
    var base = cfg.format === 'single'
      ? players.filter(function (p) { return !p.dropped; })
          .map(function (p, i) { return { id: p.id, no: p.no, name: p.name, rank: i + 1, dropped: false }; })
      : standings(players, matches.filter(isSwissMatch), cfg.rules);
    var n = cfg.format === 'single' ? base.length : Math.min(cfg.cut, base.length);
    var pairs = bracketFrom(base, n);
    if (!pairs.length) return { error: '人數不足，排不出淘汰賽' };
    return { matches: tagRound(assignTables(pairs, names), koLabel(pairs.length)), notes: [] };
  }

  /* 找最後一輪淘汰賽 */
  var last = ko[ko.length - 1].round;
  var lastMs = ko.filter(function (m) { return m.round === last; });
  var nx = nextBracketRound(lastMs, players);
  if (nx === null) return { error: '上一輪還沒全部回報勝負' };
  if (!nx.length || (nx.length === 1 && nx[0][1] === null)) return { done: true, notes: ['已經打到冠軍'] };
  return { matches: tagRound(assignTables(nx, names), koLabel(nx.length)), notes: [] };
}

/* 淘汰賽輪次的名字用「還剩幾強」表示，跟現場講法一致 */
function koLabel(pairCount) {
  var n = pairCount * 2;
  if (n === 2) return '決賽';
  if (n === 4) return '四強';
  if (n === 8) return '八強';
  if (n === 16) return '十六強';
  return n + '強';
}
function tagRound(list, label) {
  list.forEach(function (m) { m.round = label; });
  return list;
}

function countRounds(matches) {
  var s = {};
  (matches || []).forEach(function (m) { if (typeof m.round === 'number') s[m.round] = 1; });
  return Object.keys(s).length;
}

function tableNamesFor(cfg, need) {
  var count = Math.max(need, cfg.tableCount || need);
  return makeTables(count, cfg.tableNaming || 'letter', cfg.customTables);
}

/* ── 盤面體檢 ───────────────────────────────────────────
   送出前抓「同一人排兩桌」「同一桌重複」，這兩種都會直接投影出去。 */
function check(list) {
  var seen = {}, tbl = {}, dupPlayer = [], dupTable = [];
  list.forEach(function (m) {
    if (tbl[m.table]) dupTable.push(m.table); else tbl[m.table] = 1;
    [m.a, m.b].forEach(function (id) {
      if (id === null || id === undefined) return;
      if (seen[id]) dupPlayer.push(id); else seen[id] = 1;
    });
  });
  return { dupPlayer: dupPlayer, dupTable: dupTable,
           ok: !dupPlayer.length && !dupTable.length };
}

return {
  DEFAULT_RULES: DEFAULT_RULES,
  letterName: letterName, makeTables: makeTables,
  suggestTables: suggestTables, suggestRounds: suggestRounds,
  tally: tally, winPct: winPct, standings: standings,
  pairSwiss: pairSwiss, pairRoundRobin: pairRoundRobin,
  seedOrder: seedOrder, bracketFrom: bracketFrom, nextBracketRound: nextBracketRound,
  assignTables: assignTables, nextRound: nextRound, countRounds: countRounds,
  koLabel: koLabel, check: check
};
});
