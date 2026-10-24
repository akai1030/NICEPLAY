/* NICEPLAY 小工具測試 —— node test/fmt.test.js

   src/fmt.js 是從 ui.js 搬出來的純函式。它們本身不難，難的是一改就會
   同時出現在投影、選手手機、紙本、檔名好幾個地方 —— 這裡把現在的樣子釘住。 */
'use strict';

const F = require('../src/fmt.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);

head('【1】跳脫：名字是使用者貼進來的，四種字元都要擋');
{
  eq(F.esc('<b>周</b> & "王"'), '&lt;b&gt;周&lt;/b&gt; &amp; &quot;王&quot;', '角括號、&、雙引號');
  eq(F.esc(null), '', 'null 變空字串');
  eq(F.esc(undefined), '', 'undefined 變空字串');
  eq(F.esc(0), '0', '數字 0 不能被當成空的');
  console.log('  <、>、&、" 都跳脫，null 與 0 分得開 ✓');
}

head('【2】倒數：超時前面加 +，超過一小時才顯示小時');
{
  eq(F.fmtCount(65000), '01:05', '一分五秒');
  eq(F.fmtCount(999), '00:00', '不滿一秒捨去');
  eq(F.fmtCount(-5000), '+00:05', '超時五秒');
  eq(F.fmtCount(3723000), '1:02:03', '一小時以上');
  eq(F.pad(7) + F.pad(12), '0712', '補零');
  console.log('  分秒、超時、小時三種寫法都對 ✓');
}

head('【3】查名字與編號');
{
  const st = { players: [{ id: 'a', no: 1, name: '王小明' }, { id: 'b', no: 2, name: 'Amy Lee' }],
               matches: [{ round: 1, table: '7', a: 'a', b: 'b', result: 'a' },
                         { round: 2, table: '1', a: 'b', b: null, result: 'bye' }],
               config: { rules: { win: 3, draw: 1, loss: 0 } } };
  eq(F.nameOf(st, 'b'), 'Amy Lee', '找得到');
  eq(F.nameOf(st, null), '輪空', '對手是 null 就是輪空');
  eq(F.nameOf(st, undefined), '輪空', 'undefined 也是輪空');
  eq(F.nameOf(st, 'zz'), '？', '找不到的 id');
  eq(F.numOf(st, 'b'), 2, '編號');
  eq(F.numOf(st, 'zz'), '', '找不到就是空字串');
  eq(F.currentRound(st), 2, '目前這一輪是最後一場的輪次');
  eq(F.currentRound({ matches: [] }), null, '還沒排就是 null');
  eq(F.matchesOf(st, 1).length, 1, '只拿那一輪的');
  const rm = F.recMap(st);
  eq(rm.a.rec, '1-0', '戰績：勝-敗');
  eq(rm.b.rec, '1-1', '輪空算一勝');
  eq(F.recMap({ players: [], matches: [], config: {} }).constructor, Object, '算不出來就回空表，不丟錯');
  console.log('  名字、編號、目前輪次、戰績查表 ✓');
}

head('【4】輪次名稱：雙敗的代號翻成人話，其他照原樣');
{
  eq(F.roundLabel(3), '第 3 輪', '數字');
  eq(F.roundLabel('四強'), '四強', '單敗的中文名照原樣');
  eq(F.roundLabel('W1'), '勝部第 1 輪', '勝部');
  eq(F.roundLabel('L4'), '敗部第 4 輪', '敗部');
  eq(F.roundLabel('F'), '總決賽', '總決賽');
  eq(F.roundLabel('F2'), '加賽', '總決賽加賽');
  console.log('  數字、中文、W／L／F／F2 都對 ✓');
}

head('【5】賽制寫成人話（紙本、投影、檔名都用這一句）');
{
  eq(F.formatLabel({ format: 'swiss', rounds: 5, cut: 8, bo: 1, boKO: 3 }),
     '瑞士制 5 輪＋前 8 名淘汰賽　常規 BO1／淘汰 BO3', '瑞士制接淘汰賽、兩種幾勝制');
  eq(F.formatLabel({ format: 'swiss', rounds: 4, cut: 0, bo: 3, boKO: 1 }),
     '瑞士制 4 輪　BO3', '沒有淘汰賽就只講常規的幾勝制');
  eq(F.formatLabel({ format: 'double', bo: 1, boKO: 3 }), '雙敗淘汰　BO3', '純淘汰只講淘汰的幾勝制');
  eq(F.formatLabel({ format: 'roundrobin', bo: 2, boKO: 2, cut: 0 }), '循環賽　BO2', '循環賽');
  eq(F.formatLabel({ format: 'single' }), '單敗淘汰　BO1', '舊存檔沒有 bo 欄位 → BO1');
  console.log('  五種組合的寫法 ✓');
}

head('【6】檔名與賽事清單的標題');
{
  eq(F.fileStem({ event: { host: '桌遊記', name: '週三 夜間賽/決賽', date: '2026-10-25' } }),
     '桌遊記_週三_夜間賽_決賽_2026-10-25', '空白與斜線換成底線');
  eq(F.fileStem({ event: { host: '', name: '', date: '' } }), 'niceplay', '全空的退回 niceplay');
  eq(F.eventTitle({ host: '桌遊記', name: '', date: '2026-10-25', players: 16, rounds: 3 }),
     '桌遊記　（未命名）　2026-10-25　16 人 · 3 輪', '有人數有輪數');
  eq(F.eventTitle({ name: 'A' }), 'A', '只有名字');
  console.log('  檔名清掉非法字元、清單標題 ✓');
}

head('【7】幾勝制說明');
{
  eq(F.boWord(1), '<b>BO1</b>　一局定勝負', 'BO1');
  eq(F.boWord(2), '<b>BO2</b>　先贏 2 局，1-1 算平手', '偶數局會平手');
  eq(F.boWord(5), '<b>BO5</b>　先贏 3 局', 'BO5');
  eq(F.boHint(false, false, 1, 1, 'swiss'), '', '沒有任何一段就整個空白');
  const d = F.boHint(true, true, 3, 1, 'double');
  ok(d.indexOf('常規賽 <b>BO3</b>') === 0, '常規賽排第一：' + d.slice(0, 20));
  ok(d.indexOf('淘汰賽 <b>BO1</b>') > 0, '淘汰賽');
  ok(d.indexOf('雙敗：輸一場掉敗部') > 0, '雙敗要多講一句');
  ok(F.boHint(false, true, 1, 3, 'single').indexOf('雙敗') < 0, '單敗不講雙敗那句');
  ok(d.indexOf('<br>對戰卡上點誰贏') > 0, '後面接操作說明');
  console.log('  BO1／偶數／奇數、雙敗才多一句 ✓');
}

head('【8】桌號排序與搜尋');
{
  const order = ['10', '2', 'B', '1', 'A', 'Q1'].map(t => ({ table: t })).sort(F.byTableName)
    .map(x => x.table).join();
  eq(order, '1,2,10,A,B,Q1', '數字照數值、排在字母前面');
  eq(F.norm('  AmY '), 'amy', '去空白、轉小寫');
  eq(F.norm(null), '', 'null');
  const st = { players: [{ id: 'a', no: 1, name: '王小明' }, { id: 'b', no: 12, name: 'Amy Lee' }] };
  const m = { table: '7', a: 'a', b: 'b' };
  ok(F.matchMatches(st, m, 'amy'), '名字（不分大小寫）');
  ok(F.matchMatches(st, m, '7'), '桌號');
  ok(F.matchMatches(st, m, '12'), '編號要完全相同');
  ok(!F.matchMatches(st, m, '2'), '編號不做部分比對（2 不會配到 12）');
  ok(!F.matchMatches(st, { table: '1', a: 'a', b: null }, '輪空'), '輪空那一邊不算人');
  console.log('  桌號排序、名字／桌號／編號搜尋 ✓');
}

head('【9】版本號');
{
  eq(F.versionLabel('https://x/src/ui.js?v=202608170013'), '2026-08-17 00:13', '讀版本章');
  eq(F.versionLabel(null), '開發版', '找不到 script');
  eq(F.versionLabel('src/ui.js'), '開發版', '沒有版本章');
  console.log('  版本章讀得回來，沒有就是開發版 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
