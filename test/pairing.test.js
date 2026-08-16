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

head('【9】蛇形分組：不能讓某一組拿走所有的單數順位');
{
  const ps = Array.from({ length: 16 }, (_, i) => P('p' + i, i + 1, 'P' + i));
  const g = E.assignGroups(ps, 2).map(p => p.group).join('');
  eq(g, 'ABBAABBAABBAABBA', '兩組的蛇形順序');
  const g3 = E.assignGroups(ps, 3).map(p => p.group).join('');
  eq(g3.slice(0, 6), 'ABCCBA', '三組的蛇形順序');
  /* 兩組各拿到一半的人 */
  const two = E.assignGroups(ps, 2);
  eq(E.inGroup(two, 'A').length, 8, 'A 組人數');
  eq(E.inGroup(two, 'B').length, 8, 'B 組人數');
  console.log('  蛇形分完人數平均，順位也不會偏向某一組 ✓');
}

head('【10】各組分開配對，桌號一路接下去');
{
  const ps = E.assignGroups(
    Array.from({ length: 16 }, (_, i) => P('p' + i, i + 1, 'P' + i)), 2);
  const st = { config: { format: 'swiss', rounds: 2, cut: 4, groups: 2,
                         bo: 1, boKO: 3, tableNaming: 'number' },
               players: ps, matches: [] };
  const r1 = E.nextRound(st);
  ok(!r1.error, '應該排得出來：' + r1.error);
  eq(r1.matches.length, 8, '16 人分兩組應該排 8 桌');
  eq(r1.matches.map(m => m.table).join(','), '1,2,3,4,5,6,7,8',
     '桌號應該連號，不能每組從 1 開始');
  ok(r1.matches.every(m => m.group), '每一場都要標出是哪一組的');

  /* 同一場的兩個人一定同組 */
  const gm = {}; ps.forEach(p => { gm[p.id] = p.group; });
  ok(r1.matches.every(m => !m.b || gm[m.a] === gm[m.b]),
     '預賽階段出現了跨組對戰');
  console.log('  各組自己打，桌號連號，沒有跨組 ✓');
}

head('【11】切進淘汰賽時交叉種子：第一輪一定跨組');
{
  const ps = E.assignGroups(
    Array.from({ length: 16 }, (_, i) => P('p' + i, i + 1, 'P' + i)), 2);
  const st = { config: { format: 'swiss', rounds: 2, cut: 4, groups: 2,
                         bo: 1, boKO: 3, tableNaming: 'number' },
               players: ps, matches: [] };
  for (let r = 1; r <= 2; r++) {
    const res = E.nextRound(st);
    res.matches.forEach(m => { m.round = r; m.result = m.b === null ? 'bye' : 'a'; });
    st.matches = st.matches.concat(res.matches);
  }
  const ko = E.nextRound(st);
  ok(!ko.error, '應該排得出淘汰賽：' + ko.error);
  eq(ko.matches.length, 2, '各組取前 2 名＝共 4 人＝2 場');
  const gm = {}; ps.forEach(p => { gm[p.id] = p.group; });
  ok(ko.matches.every(m => m.b && gm[m.a] !== gm[m.b]),
     '淘汰賽第一輪出現了同組對戰 —— 交叉種子沒生效');
  ok(ko.notes.some(n => n.indexOf('交叉') >= 0), '應該說明是交叉對戰');
  console.log('  各組前 2 名交叉，第一輪全是跨組 ✓');
}

head('【12】某一組人數不足時不整個失敗，跳過並講一聲');
{
  const ps = [P('p1', 1, 'A1'), P('p2', 2, 'A2'), P('p3', 3, 'A3')];
  ps[0].group = 'A'; ps[1].group = 'A'; ps[2].group = 'B';   /* B 組只有一個人 */
  const st = { config: { format: 'swiss', rounds: 2, cut: 0, groups: 2,
                         bo: 1, boKO: 1, tableNaming: 'number' },
               players: ps, matches: [] };
  const r = E.nextRound(st);
  ok(!r.error, '不該整個失敗：' + r.error);
  eq(r.matches.length, 1, 'A 組還是要排得出一桌');
  ok(r.notes.some(n => n.indexOf('B') >= 0 && n.indexOf('不足') >= 0),
     '應該講出是哪一組人數不足：' + JSON.stringify(r.notes));
  console.log('  一組不夠人不會拖垮整場，而且說得出是哪一組 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
