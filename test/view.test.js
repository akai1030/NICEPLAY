/* NICEPLAY 控制台畫面片段測試 —— node test/view.test.js

   src/view.js 吐出來的是 HTML 字串，ui.js 直接塞進畫面。
   這裡守兩件事：使用者打的字一定有跳脫，以及現場看得到的那幾句話沒有走樣。 */
'use strict';

const V = require('../src/view.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);

head('【1】名單：一人一格，退賽的灰掉，名字有跳脫');
{
  eq(V.rosterHTML([{ no: 1, name: '<b>王</b>' }, { no: 2, name: '陳', dropped: true }]),
     '<div class="nm"><i>1</i><span>&lt;b&gt;王&lt;/b&gt;</span></div>' +
     '<div class="nm out"><i>2</i><span>陳</span></div>', '兩格');
  eq(V.rosterHTML([]), '', '沒有人就是空的');
  console.log('  名單格子 ✓');
}

head('【2】桌數提示');
{
  eq(V.tableHintHTML(10, NaN, 'number', []),
     '10 人 → 需要 <b>5</b> 桌，目前設定 <b>5</b> 桌：1、2、3、4、5', '沒填桌數就照人數建議');
  eq(V.tableHintHTML(30, 0, 'letter', []),
     '30 人 → 需要 <b>15</b> 桌，目前設定 <b>15</b> 桌：A、B、C、D、E、F、G、H …… O', '超過 8 桌只列前 8 跟最後一桌');
  eq(V.tableHintHTML(10, 3, 'custom', ['A', 'B<']),
     '10 人 → 需要 <b>5</b> 桌，目前設定 <b>3</b> 桌：A、B&lt;、3', '自訂名稱有跳脫、不夠的用數字補');
  ok(V.tableHintHTML(200, 80, 'number', []).indexOf('…… 60') > 0, '桌名最多產 60 個');
  console.log('  建議桌數、自訂桌名、上限 ✓');
}

head('【3】賽事清單');
{
  const st = { id: 'e1', event: { host: '桌遊記', name: '週三', date: '2026-10-25' },
               players: [{}, {}], matches: [{ round: 1 }, { round: 2 }] };
  eq(V.eventOptionsHTML(st, [{ id: 'e"2', name: '舊的', players: 8, rounds: 3 }]),
     '<option value="e1">桌遊記　週三　2026-10-25　2 人 · 2 輪　←　現在</option>' +
     '<option value="e&quot;2">舊的　8 人 · 3 輪</option>', '現在這場在第一個，id 有跳脫');
  ok(V.eventHintHTML(0).indexOf('目前只有這一場') === 0, '只有一場');
  eq(V.eventHintHTML(2), '另外還有 <b>2</b> 場存在這臺電腦裡。切換不會動到任何一場的成績。', '還有別場');
  console.log('  選項與提示 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
