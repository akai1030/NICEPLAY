/* NICEPLAY 選手查詢畫面測試 —— node test/watch.test.js

   src/watch.js 決定選手手機上看到什麼。這一頁選手是自己看、沒有人在旁邊解釋，
   所以「你在第幾桌」「你贏了還是輸了」「幾比幾」任何一個寫反都會直接走錯桌、報錯分。 */
'use strict';

const W = require('../src/watch.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);

const rules = { win: 3, draw: 1, loss: 0 };
const st = {
  players: [{ id: 'a', no: 1, name: '王<小明>' }, { id: 'b', no: 2, name: '陳' },
            { id: 'c', no: 3, name: '林' }, { id: 'd', no: 4, name: '李', dropped: true },
            { id: 'e', no: 5, name: '吳' }],
  matches: [
    { round: 1, table: '1', a: 'a', b: 'b', result: 'a' },
    { round: 1, table: '2', a: 'c', b: 'd', result: 'draw' },
    { round: 1, table: '3', a: 'e', b: null, result: 'bye' },
    { round: 2, table: '1', a: 'c', b: 'a', bo: 3, games: ['a', 'draw'], result: null },
    { round: 2, table: '2', a: 'b', b: null, result: 'bye' }
  ],
  config: { rules: rules }
};

head('【1】選自己是誰');
{
  eq(W.findMe(st, 'c').name, '林', '找得到');
  eq(W.findMe(st, ''), null, '還沒選');
  eq(W.findMe(st, 'zz'), null, '主辦換了名單，舊的 id 找不到');
  eq(W.pickListHTML(st.players.slice(0, 1)), '<div class="nm" data-id="a"><i>1</i><span>王&lt;小明&gt;</span></div>',
     '一人一格，名字有跳脫');
  eq(W.pickListHTML([]), '<div class="hint">主辦還沒讀入名單。</div>', '沒有名單');
  console.log('  找人、名單 ✓');
}

head('【2】最上面那一塊：我在第幾桌、對手、幾比幾');
{
  /* a 在第 2 輪是 B 方：games 的 'a' 是對手 c 贏的那一局，所以 a 這邊要寫 0-1 */
  const t = W.myTable(st, 2, 'a');
  eq([t.lead, t.table, t.tail, t.small].join('|'), '你在第|1|桌|false', '桌號');
  eq(t.opp, '對手　<b>林</b>　<span class="sc">0-1（平 1）　BO3　先贏 2 局</span>', 'B 方看到的比分要翻過來');
  eq(W.myTable(st, 2, 'c').opp, '對手　<b>王&lt;小明&gt;</b>　<span class="sc">1-0（平 1）　BO3　先贏 2 局</span>',
     'A 方、對手名字有跳脫');

  eq(W.myTable(st, 1, 'a').opp, '對手　<b>陳</b>　<b>你贏了</b>', '贏');
  eq(W.myTable(st, 1, 'b').opp, '對手　<b>王&lt;小明&gt;</b>　你輸了', '輸');
  eq(W.myTable(st, 1, 'c').opp, '對手　<b>李</b>　<b>平手</b>', '平手');

  const bye = W.myTable(st, 2, 'b');
  eq([bye.lead, bye.table, bye.tail, bye.small, bye.opp].join('|'), '本輪|輪空||false|這一輪不用打，直接算一勝。', '輪空');

  const none = W.myTable(st, 2, 'e');
  eq([none.lead, none.table, none.tail, none.small, none.opp].join('|'), '|本輪沒有你的場次||true|', '這一輪沒有我');
  eq(W.myTable({ players: st.players, matches: [] }, null, 'a').table, '尚未開始', '還沒排第一輪');
  console.log('  桌號、勝負、BO 比分（A／B 方）、輪空、沒有場次、尚未開始 ✓');
}

head('【3】我的戰績那一行、成績單出不出現');
{
  ok(/^目前第 \d 名　1 勝 0 敗　\d+ 分$/.test(W.statText(st, 'a')), '勝敗與積分：' + W.statText(st, 'a'));
  ok(W.statText(st, 'c').indexOf('0 勝 0 敗 1 平') > 0, '有平手才寫平：' + W.statText(st, 'c'));
  eq(W.statText(st, 'zz'), '', '名單上沒有我');
  ok(W.hasPlayed(st, 'a'), '有打完的場次');
  ok(!W.hasPlayed({ matches: [{ a: 'a', b: 'b', result: null }] }, 'a'), '還在打就還沒有成績單');
  console.log('  戰績、成績單時機 ✓');
}

head('【4】我的每一輪');
{
  const mine = W.myMatches(st, 'a');
  eq(mine.length, 2, '兩輪都有我');
  const h = W.myRoundsHTML(st, mine, 'a');
  eq(h, '<div class="wr won"><span class="t">1</span><span class="p">陳</span><span class="s">勝</span></div>' +
        '<div class="wr"><span class="t">2</span><span class="p">林</span><span class="s sc">0-1</span><span class="s">進行中</span></div>',
     '「第 1 輪」縮成 1、BO 比分站在我這邊');
  const b = W.myRoundsHTML(st, W.myMatches(st, 'b'), 'b');
  ok(b.indexOf('<div class="wr lost">') === 0, '輸的那一輪');
  ok(b.indexOf('<span class="p">—</span><span class="s">輪空 · 視同勝</span>') > 0, '輪空也列出來');
  ok(W.myRoundsHTML(st, W.myMatches(st, 'c'), 'c').indexOf('<span class="s">平手</span>') > 0, '平手');
  ok(W.myRoundsHTML(st, [{ round: '四強', table: '1', a: 'a', b: 'b', result: 'b' }], 'a')
       .indexOf('<span class="t">四強</span>') > 0, '淘汰賽輪次照原樣');
  console.log('  勝、敗、平、進行中、輪空、輪次縮寫 ✓');
}

head('【5】本輪對戰與名次（唯讀）');
{
  eq(W.matchTitle(null), '本輪對戰', '還沒開始');
  eq(W.matchTitle('W1'), '勝部第 1 輪　對戰', '有輪次');
  const r1 = W.roundMatchesHTML(st, st.matches.filter(m => m.round === 1), 'b');
  ok(r1.indexOf('<div class="wr mine"><span class="t">1</span><span class="p win">王&lt;小明&gt;<em class="num">') === 0,
     '我的那桌標出來、贏的那邊、名字跳脫');
  ok(r1.indexOf('<span class="x">VS</span><span class="p lose">陳') > 0, 'BO1 寫 VS、輸的那邊');
  ok(r1.indexOf('<span class="p">吳<em class="num">1-0</em></span><span class="s">輪空</span>') > 0, '輪空沒有對手、戰績照算');
  ok(W.roundMatchesHTML(st, st.matches.filter(m => m.round === 2), '').indexOf('<span class="x sc">1-0</span>') > 0, 'BO3 寫局數');
  eq(W.roundMatchesHTML(st, [], ''), '<div class="hint">還沒排對戰。</div>', '還沒排');

  const rk = W.rankHTML(st, 'a');
  ok(/<div class="wr mine"><span class="n">\d<\/span><span class="p">王&lt;小明&gt;<\/span>/.test(rk), '我那一列標出來');
  ok(rk.indexOf('李（退賽）') > 0, '退賽');
  ok(rk.indexOf('<span class="s">0-0-1</span>') > 0, '有平手才多一段');
  eq(W.rankHTML({ players: [], matches: [], config: { rules: rules } }, ''), '<div class="hint">還沒有成績。</div>', '沒有名單');
  console.log('  本輪對戰、名次 ✓');
}

head('【6】從別臺傳來的狀態被動過手腳，也拼不出標籤');
{
  const bad = '"><img src=x onerror=alert(1)>';
  const evil = { players: [{ id: bad, no: '<b>1</b>', name: bad }, { id: 'b', no: 2, name: '陳' }],
                 matches: [{ round: 1, table: bad, a: bad, b: 'b', bo: '3<img>', games: ['a'], result: null }],
                 config: { rules: { win: '<s>', draw: 1, loss: 0 } } };
  const all = [W.pickListHTML(evil.players), W.myTable(evil, 1, 'b').opp,
               W.myRoundsHTML(evil, W.myMatches(evil, 'b'), 'b'),
               W.roundMatchesHTML(evil, evil.matches, 'b'), W.rankHTML(evil, 'b')].join('');
  ok(all.indexOf('<img') < 0 && all.indexOf('<b>1</b>') < 0 && all.indexOf('<s>') < 0, '沒有任何一段原封不動進到 HTML');
  ok(W.pickListHTML(evil.players).indexOf('data-id="&quot;&gt;&lt;img') > 0, 'id 有跳脫');
  ok(W.pickListHTML(evil.players).indexOf('<i>NaN</i>') > 0, '編號不是數字就變 NaN');
  /* 正常的資料轉完跟原本一模一樣 —— 上面【1】到【5】的期望值一個都沒改 */
  console.log('  id、編號、BO、積分規則被塞標籤都擋得住 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
