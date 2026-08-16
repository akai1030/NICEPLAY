/* NICEPLAY 雙敗淘汰測試 —— node test/double.test.js

   雙敗最容易做壞的地方不是配對，是「順序」與「什麼時候該結束」：
     · 敗部要等勝部掉人下來，兩邊的相依關係一錯就會卡住或跳過一輪
     · 總決賽如果是敗部冠軍贏，兩邊都只輸一場 —— 不加賽就不是雙敗
     · 非 2 次方人數要靠輪空補齊，補錯就會有人憑空消失

   所以這裡不只驗一次流程，而是把整個賽程跑到底，再檢查
   「每個人到底輸了幾場」這個唯一不會騙人的數字。 */
'use strict';
const E = require('../src/engine.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);

const P = n => Array.from({ length: n }, (_, i) =>
  ({ id: 'p' + (i + 1), no: i + 1, name: 'P' + (i + 1), dropped: false }));

/* 把一整場雙敗跑到底。pick 決定每一場誰贏。 */
function play(n, pick) {
  const st = { config: { format: 'double', boKO: 1, tableNaming: 'number' },
               players: P(n), matches: [] };
  const seq = [];
  for (let guard = 0; guard < 60; guard++) {
    const r = E.nextRound(st);
    if (r.done) { seq.push('DONE'); return { seq, st, notes: r.notes || [] }; }
    if (r.error) { seq.push('ERR:' + r.error); return { seq, st, notes: [] }; }
    seq.push(r.matches[0].round + '(' + r.matches.length + ')');
    r.matches.forEach(m => { m.result = (m.b === null) ? 'bye' : pick(m); });
    st.matches = st.matches.concat(r.matches);
  }
  seq.push('LOOP');
  return { seq, st, notes: [] };
}

/* 每個人輸了幾場（輪空不算） */
function losses(st) {
  const out = {};
  st.players.forEach(p => { out[p.id] = 0; });
  st.matches.forEach(m => {
    if (m.b === null || m.b === undefined || !m.result || m.result === 'bye') return;
    out[m.result === 'a' ? m.b : m.a]++;
  });
  return out;
}

head('【1】排程長度與相依順序');
{
  eq(E.doubleSchedule(2).join(' '), 'W1 L1 W2 L2 F', '4 人的排程');
  eq(E.doubleSchedule(3).join(' '), 'W1 L1 W2 L2 L3 W3 L4 F', '8 人的排程');
  eq(E.doubleSchedule(4).join(' '), 'W1 L1 W2 L2 L3 W3 L4 L5 W4 L6 F', '16 人的排程');
  /* 敗部輪數應該是 2n-2 */
  [2, 3, 4, 5].forEach(n => {
    const L = E.doubleSchedule(n).filter(x => x[0] === 'L').length;
    eq(L, 2 * n - 2, n * 2 + ' 人的敗部輪數');
  });
  console.log('  4 / 8 / 16 / 32 人的排程與敗部輪數都對 ✓');
}

head('【2】8 人跑完整場：每一輪的場次數要對');
{
  const { seq } = play(8, () => 'a');
  eq(seq.join(' '), 'W1(4) L1(2) W2(2) L2(2) L3(1) W3(1) L4(1) F(1) DONE',
     '8 人的完整流程');
  console.log('  W1→L1→W2→L2→L3→W3→L4→F，場次數 4-2-2-2-1-1-1-1 ✓');
}

/* 雙敗真正的不變式：結束時剛好一個人「還沒輸滿兩場」，那就是冠軍；
   其他每一個人都剛好輸兩場，不多也不少。

   冠軍身上的敗數可能是 0 也可能是 1 —— 一路從勝部贏到底是 0，
   從敗部殺回來、再贏下加賽的是 1。所以不能寫成「一定有人零敗」。 */
function champCheck(st, label) {
  const L = losses(st);
  const ids = Object.keys(L);
  const alive = ids.filter(k => L[k] < 2);
  const others = ids.filter(k => L[k] >= 2);
  if (alive.length !== 1) return label + '：沒有唯一的冠軍　' + JSON.stringify(L);
  if (!others.every(k => L[k] === 2)) return label + '：有人輸超過兩場　' + JSON.stringify(L);
  return null;
}

head('【3】結束時剛好一人未滿兩敗（冠軍），其餘全部剛好兩敗');
{
  const { st, seq } = play(8, () => 'a');
  eq(seq[seq.length - 1], 'DONE', '應該跑得完');
  ok(!champCheck(st, '8 人'), champCheck(st, '8 人') || '');
  eq(losses(st)[Object.keys(losses(st)).find(k => losses(st)[k] === 0)] , 0,
     '一路贏到底的冠軍應該是零敗');
  console.log('  一個冠軍、其餘每個人都真的輸滿兩場才出局 ✓');
}

head('【4】敗部冠軍拿下總決賽 → 一定要加賽');
{
  /* 一路都讓 b side 贏：從勝部掉下去的人會一路殺回來 */
  const { seq, notes } = play(8, () => 'b');
  ok(seq.indexOf('F2(1)') >= 0, '沒有出現加賽：' + seq.join(' '));
  eq(seq[seq.length - 1], 'DONE', '加賽之後應該結束');
  console.log('  敗部冠軍贏總決賽就加賽一場，加完才結束 ✓');
}

head('【5】勝部冠軍守住總決賽 → 不加賽，直接結束');
{
  const { seq } = play(8, () => 'a');
  eq(seq.indexOf('F2(1)'), -1, '不該有加賽');
  eq(seq[seq.length - 1], 'DONE', '總決賽打完就結束');
  console.log('  勝部冠軍贏就直接收工 ✓');
}

head('【6】非 2 次方人數靠輪空補齊，沒有人憑空消失');
{
  [3, 5, 6, 7, 9, 11, 13].forEach(n => {
    const { seq, st } = play(n, () => 'a');
    eq(seq[seq.length - 1], 'DONE', n + ' 人應該跑得完：' + seq.join(' '));
    /* 每個人至少要上場一次 —— 補輪空補錯的話會有人整場沒出現 */
    const appeared = {};
    st.matches.forEach(m => { appeared[m.a] = 1; if (m.b) appeared[m.b] = 1; });
    eq(Object.keys(appeared).length, n, n + ' 人裡有人整場沒上場');
  });
  console.log('  3 / 5 / 6 / 7 / 9 / 11 / 13 人都跑得完，沒有人被漏掉 ✓');
}

head('【7】隨機勝負跑三百次，不能卡住也不能無限迴圈');
{
  let stuck = 0, bad = 0, firstBad = '';
  for (let i = 0; i < 300; i++) {
    let k = i;
    const n = 6 + (i % 11);
    const { seq, st } = play(n, () => ((k++ % 3) ? 'a' : 'b'));
    if (seq[seq.length - 1] !== 'DONE') { stuck++; if (stuck < 3) console.log('  ✗ ' + seq.join(' ')); continue; }
    const why = champCheck(st, n + ' 人');
    if (why) { bad++; if (!firstBad) firstBad = why; }
  }
  eq(stuck, 0, '有跑不完的情況');
  eq(bad, 0, '敗數對不上：' + firstBad);
  console.log('  300 場隨機推演全部跑完，每一場的敗數都收得乾淨 ✓');
}

head('【8】上一輪沒回報完就不給排下一輪');
{
  const st = { config: { format: 'double', boKO: 1, tableNaming: 'number' },
               players: P(8), matches: [] };
  const r1 = E.nextRound(st);
  r1.matches.forEach((m, i) => { m.result = i === 0 ? null : 'a'; });  /* 留一桌沒回報 */
  st.matches = r1.matches;
  const r2 = E.nextRound(st);
  ok(!!r2.error, '沒回報完卻排出了下一輪');
  ok(r2.error.indexOf('回報') >= 0, '錯誤訊息應該講清楚是還沒回報：' + r2.error);
  console.log('  沒回報完會擋下來，而且說得出原因 ✓');
}

head('【9】輪次名稱要是人話');
{
  eq(E.koName('W1'), '勝部第 1 輪', 'W1');
  eq(E.koName('L4'), '敗部第 4 輪', 'L4');
  eq(E.koName('F'), '總決賽', 'F');
  eq(E.koName('F2'), '加賽', 'F2');
  console.log('  W1 / L4 / F / F2 都翻得出來 ✓');
}

head('【10】幾勝制照淘汰賽的設定蓋在場次上');
{
  const st = { config: { format: 'double', boKO: 3, tableNaming: 'number' },
               players: P(8), matches: [] };
  const r = E.nextRound(st);
  ok(r.matches.every(m => m.b === null || m.bo === 3), '雙敗的場次應該吃 boKO');
  ok(r.matches.every(m => Array.isArray(m.games)), '每一場都要有 games');
  console.log('  雙敗的每一場都是 BO3 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
