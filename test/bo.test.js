/* NICEPLAY 幾勝制測試 —— node test/bo.test.js

   BO 的設計前提是「小局只是紀錄，整場的勝負仍然只寫在 m.result」，
   所以這裡除了驗小局本身，更要驗那條界線沒有被踩破：
   積分、OMW、配對、淘汰賽晉級全部只讀 m.result，一行都不必因為 BO 而改。 */
'use strict';
const E = require('../src/engine.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);

function players(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ id: 'p' + i, no: i, name: 'P' + i, dropped: false });
  return out;
}
/* 照使用者的點法把一場打完：依序按下每一局的贏家 */
function play(m, seq) {
  seq.forEach(v => {
    const next = E.playGame(m, v);
    if (next) { m.games = next.games; m.result = next.result; }
  });
  return m;
}
const mk = (bo) => ({ round: 1, table: '1', a: 'p1', b: 'p2', bo, games: [], result: null });

head('【1】要贏幾局');
{
  eq(E.winsNeeded(1), 1, 'BO1');
  eq(E.winsNeeded(2), 2, 'BO2');
  eq(E.winsNeeded(3), 2, 'BO3');
  eq(E.winsNeeded(5), 3, 'BO5');
  eq(E.winsNeeded(undefined), 1, '沒給就當 BO1');
  console.log('  BO1→1　BO2→2　BO3→2　BO5→3 ✓');
}

head('【2】小局推出整場勝負');
{
  eq(E.matchResult([], 3), null, 'BO3 還沒打');
  eq(E.matchResult(['a'], 3), null, 'BO3 一比零還沒結束');
  eq(E.matchResult(['a', 'a'], 3), 'a', 'BO3 二比零');
  eq(E.matchResult(['a', 'b', 'a'], 3), 'a', 'BO3 二比一');
  eq(E.matchResult(['b', 'b'], 3), 'b', 'BO3 對手二比零');
  eq(E.matchResult(['a', 'a'], 5), null, 'BO5 二比零還沒結束');
  eq(E.matchResult(['a', 'a', 'a'], 5), 'a', 'BO5 三比零就結束');
  eq(E.matchResult(['a', 'b', 'a', 'b', 'a'], 5), 'a', 'BO5 打滿五局三比二');
  console.log('  先過半就結束，沒過半就繼續 ✓');
}

head('【3】打滿還沒過半＝平手（接上原本就有的平手計分）');
{
  eq(E.matchResult(['a', 'b'], 2), 'draw', 'BO2 的 1-1');
  eq(E.matchResult(['a', 'a'], 2), 'a', 'BO2 的 2-0');
  eq(E.matchResult(['a', 'b', 'draw'], 3), 'draw', 'BO3 的 1-1-1');
  eq(E.matchResult(['draw', 'draw'], 2), 'draw', 'BO2 兩局都和');
  console.log('  BO2 的 1-1、BO3 的 1-1-1 都判平手 ✓');
}

head('【4】一勝制維持原本的點法');
{
  const m = mk(1);
  play(m, ['a']);        eq(m.result, 'a', '點一下就分勝負');
  play(m, ['a']);        eq(m.result, null, '點同一邊＝取消');
  play(m, ['a']);        play(m, ['b']);
  eq(m.result, 'b', '點另一邊＝直接改判');
  eq(m.games.length, 1, '一勝制只會留一局');
  console.log('  取消與改判都跟改版前一樣 ✓');
}

head('【5】BO3 勝負已定就不能再加局，要先退');
{
  const m = mk(3);
  play(m, ['a', 'a']);
  eq(m.result, 'a', '二比零拿下');
  eq(E.playGame(m, 'b'), null, '勝負已定時再點應該沒有作用');
  const back = E.playGame(m, null);
  ok(back && back.result === null, '退一局之後回到未定');
  eq(back.games.length, 1, '退一局只退一局');
  console.log('  分出勝負後鎖住，退一局才解開 ✓');
}

head('【6】沒有東西可以退的時候，退一局不做事');
{
  const m = mk(3);
  eq(E.playGame(m, null), null, '空的時候退一局應該沒有作用');
  console.log('  空盤按退一局不會壞 ✓');
}

head('【7】舊存檔（只有 result、沒有 games）接得上');
{
  const old = { round: 1, table: '1', a: 'p1', b: 'p2', result: 'a' };   /* 沒有 bo、沒有 games */
  const g = E.gamesOf(old);
  eq(g.length, 1, '舊的 result 補成一局');
  eq(g[0], 'a', '補出來的是原本的勝方');
  const next = E.playGame(old, 'a');
  ok(next && next.result === null, '舊場次照樣點得動（當 BO1）');
  eq(E.gamesOf({ result: 'bye' }).length, 0, '輪空不該補出小局');
  console.log('  沒有 games 欄位的舊資料不會炸 ✓');
}

head('【8】排輪次時把 bo 蓋在場次上：常規走 bo、淘汰走 boKO');
{
  const st = {
    config: { format: 'swiss', rounds: 1, cut: 4, bo: 1, boKO: 3, tableNaming: 'number' },
    players: players(8), matches: []
  };
  const r1 = E.nextRound(st);
  ok(r1.matches.every(m => m.b === null || m.bo === 1), '瑞士制這一輪應該是 BO1');
  ok(r1.matches.every(m => Array.isArray(m.games)), '每一場都要有 games 陣列');

  /* 把第一輪打完，然後切進淘汰賽 */
  r1.matches.forEach((m, i) => { m.round = 1; if (m.b !== null) { m.games = ['a']; m.result = 'a'; } });
  st.matches = r1.matches;
  const ko = E.nextRound(st);
  ok(!ko.error, '應該排得出淘汰賽：' + (ko.error || ''));
  ok(ko.matches.every(m => m.b === null || m.bo === 3), '淘汰賽這一輪應該是 BO3');
  console.log('  瑞士 BO1 → 淘汰 BO3，各自蓋在場次上 ✓');
}

head('【9】中途改設定不會改寫已經排好的場次');
{
  const st = {
    config: { format: 'swiss', rounds: 3, cut: 0, bo: 1, boKO: 1, tableNaming: 'number' },
    players: players(4), matches: []
  };
  const r1 = E.nextRound(st);
  r1.matches.forEach(m => { m.round = 1; });
  st.matches = r1.matches;
  const before = st.matches.map(m => m.bo);

  st.config.bo = 3;                     /* 現場臨時改成 BO3 */
  const r2 = E.nextRound(st);
  r2.matches.forEach(m => { m.round = 2; });

  ok(st.matches.every((m, i) => m.bo === before[i]), '第一輪的 bo 被改寫了');
  ok(r2.matches.every(m => m.b === null || m.bo === 3), '第二輪應該套用新的 BO3');
  console.log('  改設定只影響之後排的輪次 ✓');
}

head('【10】BO 完全不影響名次計算（那條界線沒被踩破）');
{
  const ps = players(4);
  /* 同一組勝負，一次用 BO1 記、一次用 BO3 記，名次必須一模一樣 */
  const asBo1 = [
    { round: 1, table: '1', a: 'p1', b: 'p2', bo: 1, games: ['a'], result: 'a' },
    { round: 1, table: '2', a: 'p3', b: 'p4', bo: 1, games: ['b'], result: 'b' }
  ];
  const asBo3 = [
    { round: 1, table: '1', a: 'p1', b: 'p2', bo: 3, games: ['a', 'b', 'a'], result: 'a' },
    { round: 1, table: '2', a: 'p3', b: 'p4', bo: 3, games: ['b', 'a', 'b'], result: 'b' }
  ];
  const one = E.standings(ps, asBo1).map(r => r.id + ':' + r.pts + ':' + r.rank).join('|');
  const three = E.standings(ps, asBo3).map(r => r.id + ':' + r.pts + ':' + r.rank).join('|');
  eq(three, one, 'BO3 記的成績算出來的名次跟 BO1 不一樣');

  /* 平手也要照原本的平手分數算 */
  const drawn = [{ round: 1, table: '1', a: 'p1', b: 'p2', bo: 2, games: ['a', 'b'], result: 'draw' }];
  const rows = E.standings(ps, drawn);
  const p1 = rows.filter(r => r.id === 'p1')[0];
  eq(p1.pts, 1, 'BO2 的 1-1 應該各拿一分平手分');
  eq(p1.d, 1, '應該記成一次平手');
  console.log('  積分與名次只看 m.result，跟幾勝制無關 ✓');
}

head('【11】BO3 的淘汰賽打得完，晉級照 m.result 走');
{
  const st = {
    config: { format: 'single', bo: 1, boKO: 3, tableNaming: 'number' },
    players: players(4), matches: []
  };
  let r = E.nextRound(st);
  ok(r.matches.every(m => m.bo === 3), '第一輪淘汰賽應該是 BO3');
  r.matches.forEach(m => play(m, ['a', 'a']));            /* 兩場都是 a 二比零 */
  st.matches = r.matches;

  r = E.nextRound(st);
  ok(!r.error, '應該排得出決賽：' + (r.error || ''));
  eq(r.matches.length, 1, '四人打完第一輪應該剩一場決賽');
  eq(r.matches[0].bo, 3, '決賽也應該是 BO3');

  r.matches.forEach(m => play(m, ['b', 'a', 'a']));       /* 決賽 2-1 */
  eq(r.matches[0].result, 'a', '決賽 2-1 應該由 a 拿下');
  st.matches = st.matches.concat(r.matches);
  const done = E.nextRound(st);
  ok(done.done, '打到冠軍就該結束');
  console.log('  BO3 淘汰賽 八強→決賽→冠軍 走得完 ✓');
}

head('【12】不合法的小局值不會混進來');
{
  eq(E.matchResult(['a', 'x', 'b'], 3), null, '看不懂的值應該直接忽略，不能當成一勝');
  eq(E.matchResult(null, 3), null, 'null 不該炸');
  eq(E.matchResult(undefined, 1), null, 'undefined 不該炸');
  const t = E.tallyGames(['a', 'a', 'draw', 'zzz']);
  eq(t.a + t.b + t.draw, 3, '無效值不該被計入');
  console.log('  壞值只是被忽略，不會變成勝場 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
