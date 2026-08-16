/* NICEPLAY 配對規則測試 —— node test/pairing.test.js

   兩件會直接影響名次公正性的事：
     遲到補分　不補的話，中途加入的人分母裡少了幾場，OMW% 會偏高，
               同分時排在有打滿的人前面。
     同隊避開　「盡量」不是「一定」—— 排不出來要自己放寬並講一聲，
               不能安靜地失敗，也不能安靜地照排。 */
'use strict';
const E = require('../src/engine.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);

const P = (id, no, name, team) => ({ id, no, name, team: team || '', dropped: false });
const row = (rows, id) => rows.filter(r => r.id === id)[0];

head('【1】遲到補記為敗：算一場、記一敗、拿敗方分數');
{
  const ps = [P('p1', 1, 'A'), P('p2', 2, 'B')];
  const ms = [{ round: 1, table: '未到', a: 'p2', b: null, bo: 1, games: [], result: 'noshow' }];
  const rows = E.standings(ps, ms);
  const b = row(rows, 'p2');
  eq(b.l, 1, '應該記一敗');
  eq(b.w, 0, '不該記勝');
  eq(b.byes, 0, '不該被當成輪空');
  eq(b.played, 1, '應該算一場（分母要有它）');
  eq(b.pts, 0, '預設敗 0 分');
  console.log('  未到那一輪算一場敗，不是輪空 ✓');
}

head('【2】補記為敗不會被當成對手，也不影響別人的 OMW');
{
  const ps = [P('p1', 1, 'A'), P('p2', 2, 'B'), P('p3', 3, 'C')];
  const withNoshow = [
    { round: 1, table: '1', a: 'p1', b: 'p2', bo: 1, games: ['a'], result: 'a' },
    { round: 1, table: '未到', a: 'p3', b: null, bo: 1, games: [], result: 'noshow' }
  ];
  const without = [withNoshow[0]];
  const a1 = row(E.standings(ps, withNoshow), 'p1');
  const a2 = row(E.standings(ps, without), 'p1');
  eq(a1.opp.length, 1, 'A 的對手數不該被 noshow 影響');
  ok(Math.abs(a1.omw - a2.omw) < 1e-9, '別人的 OMW 被 noshow 動到了');
  console.log('  noshow 不列為對手，別人的 OMW 不受影響 ✓');
}

head('【3】補記為輪空仍然視同勝（另一個選項）');
{
  const ps = [P('p1', 1, 'A')];
  const ms = [{ round: 1, table: '輪空', a: 'p1', b: null, bo: 1, games: [], result: 'bye' }];
  const r = row(E.standings(ps, ms), 'p1');
  eq(r.w, 1, '輪空應該記一勝');
  eq(r.byes, 1, '應該記成輪空');
  eq(r.pts, 3, '預設勝 3 分');
  console.log('  補記輪空的路徑沒有被 noshow 改壞 ✓');
}

head('【4】瑞士制第一輪盡量避開同隊');
{
  /* 四個人分兩隊，一定排得出跨隊的組合 */
  const ps = [P('p1', 1, 'A1', '桌遊記'), P('p2', 2, 'A2', '桌遊記'),
              P('p3', 3, 'B1', '轉駅'), P('p4', 4, 'B2', '轉駅')];
  const res = E.pairSwiss(ps, [], {});
  ok(!res.error, '應該排得出來：' + res.error);
  const sameTeam = res.pairs.filter(([x, y]) => x.team && x.team === y.team);
  eq(sameTeam.length, 0, '排出了同隊內戰');
  eq(res.notes.length, 0, '排得出來就不該有放寬的提醒');
  console.log('  兩隊各兩人 → 全部跨隊對戰，沒有放寬 ✓');
}

head('【5】真的避不開的時候要放寬，而且要講');
{
  /* 全部同一隊 —— 怎麼排都是內戰 */
  const ps = [P('p1', 1, 'A1', '桌遊記'), P('p2', 2, 'A2', '桌遊記'),
              P('p3', 3, 'A3', '桌遊記'), P('p4', 4, 'A4', '桌遊記')];
  const res = E.pairSwiss(ps, [], {});
  ok(!res.error, '避不開也應該排得出來，不能整個失敗');
  eq(res.pairs.length, 2, '四個人應該排兩桌');
  ok(res.notes.some(n => n.indexOf('同隊') >= 0),
     '放寬了卻沒有講：' + JSON.stringify(res.notes));
  console.log('  避不開就放寬並回報，不會安靜地失敗 ✓');
}

head('【6】沒填隊伍的人不受影響');
{
  const ps = [P('p1', 1, 'A'), P('p2', 2, 'B'), P('p3', 3, 'C'), P('p4', 4, 'D')];
  const res = E.pairSwiss(ps, [], {});
  ok(!res.error, '應該排得出來');
  eq(res.notes.length, 0, '沒有隊伍資訊時不該出現放寬提醒');
  eq(res.pairs.length, 2, '應該排兩桌');
  /* 空字串不能被當成「同一隊」 */
  const one = [P('p1', 1, 'A', ''), P('p2', 2, 'B', '')];
  ok(!E.pairSwiss(one, [], {}).notes.length, '空白隊名被當成同隊了');
  console.log('  空的隊伍欄位不會互相認親 ✓');
}

head('【7】避開重複對手仍然優先於避開同隊');
{
  /* 兩隊各兩人，但跨隊的兩組都打過了 —— 只能在「重複對手」與
     「同隊內戰」之間選一個，設計上先放寬同隊。 */
  const ps = [P('p1', 1, 'A1', 'X'), P('p2', 2, 'A2', 'X'),
              P('p3', 3, 'B1', 'Y'), P('p4', 4, 'B2', 'Y')];
  const played = [
    { round: 1, table: '1', a: 'p1', b: 'p3', bo: 1, games: ['a'], result: 'a' },
    { round: 1, table: '2', a: 'p2', b: 'p4', bo: 1, games: ['a'], result: 'a' },
    { round: 2, table: '1', a: 'p1', b: 'p4', bo: 1, games: ['a'], result: 'a' },
    { round: 2, table: '2', a: 'p2', b: 'p3', bo: 1, games: ['a'], result: 'a' }
  ];
  const res = E.pairSwiss(ps, played, {});
  ok(!res.error, '應該排得出來：' + res.error);
  const rematch = res.pairs.filter(([x, y]) =>
    played.some(m => (m.a === x.id && m.b === y.id) || (m.a === y.id && m.b === x.id)));
  eq(rematch.length, 0, '不該出現重複對手 —— 應該先放寬同隊那一條');
  ok(res.notes.some(n => n.indexOf('同隊') >= 0), '放寬同隊卻沒有講');
  console.log('  先放寬同隊、後放寬重複對手，順序正確 ✓');
}

head('【8】名單解析：隊伍寫法');
{
  global.localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); }
  };
  const S = require('../src/store.js');
  const one = S.parsePlayers('1 王小明 @桌遊記');
  eq(one[0].name, '王小明', '@ 前面是名字');
  eq(one[0].team, '桌遊記', '@ 後面是隊伍');

  const two = S.parsePlayers('陳小美（轉駅創研）');
  eq(two[0].name, '陳小美', '全形括號前面是名字');
  eq(two[0].team, '轉駅創研', '全形括號裡面是隊伍');

  const none = S.parsePlayers('林阿明');
  eq(none[0].team, '', '沒寫隊伍就是空字串');

  /* 名字本身就有括號的人不該被誤切成空名字 */
  const tricky = S.parsePlayers('（匿名）');
  eq(tricky.length, 1, '整個名字都是括號時應該原樣保留');
  eq(tricky[0].name, '（匿名）', '不該被切成空名字：' + tricky[0].name);
  console.log('  @ 與全形括號都認得，邊界情況不會切壞 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
