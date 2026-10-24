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

head('【4】對戰卡');
{
  const F = require('../src/fmt.js');
  const st = { players: [{ id: 'a', no: 1, name: '王<小明>' }, { id: 'b', no: 2, name: '陳小美' }, { id: 'c', no: 3, name: '林' }],
               matches: [{ round: 1, table: '2', a: 'a', b: 'b', bo: 3, games: ['a', 'draw'], result: null },
                         { round: 1, table: '1', a: 'c', b: null, result: 'bye' }],
               config: { liveTable: '2', rules: { win: 3, draw: 1, loss: 0 } } };
  const rm = F.recMap(st);
  const bo3 = V.matchCardHTML(st, st.matches[0], rm, 'b');
  ok(bo3.indexOf('<div class="mt islive mine bo">') === 0, '直播桌、我的桌、BO 制三個標記：' + bo3.slice(0, 40));
  ok(bo3.indexOf('aria-label="第 2 桌　王&lt;小明&gt;　記他贏一局"') > 0, '名字在 aria-label 裡也有跳脫');
  ok(bo3.indexOf('<span class="pips"><i class="on"></i><i></i></span>') > 0, 'BO3 畫兩個點，贏一局亮一個');
  ok(bo3.indexOf('平手<b class="gn">×1</b>') > 0, '平手的局數');
  ok(bo3.indexOf('<button class="undo" data-t="2"') > 0, '打過局才有「退一局」');
  ok(V.matchCardHTML(st, st.matches[0], rm, '').indexOf('mine') < 0, '不是選手查詢模式就不標「我的」');

  const bye = V.matchCardHTML(st, st.matches[1], rm, '');
  ok(bye.indexOf('<div class="sd bye">輪空 · 視同勝</div>') > 0, '輪空那一邊是 div，不是按鈕');
  ok(bye.indexOf('data-r="draw"') < 0, '輪空沒有平手鈕');

  const bo1 = V.matchCardHTML(st, { round: 1, table: '3', a: 'a', b: 'b', bo: 1, games: ['b'], result: 'b' }, {}, '');
  ok(bo1.indexOf('class="sd lose" data-t="3" data-r="a"') > 0, '輸的那邊');
  ok(bo1.indexOf('class="sd win" data-t="3" data-r="b" data-id="b" aria-pressed="true"') > 0, '贏的那邊 aria-pressed');
  ok(bo1.indexOf('undo') < 0, '一勝制沒有退一局');
  ok(bo1.indexOf('記他贏"') > 0 && bo1.indexOf('記他贏一局') < 0, '一勝制的說法是「記他贏」');
  eq(V.matchListHTML(st, st.matches, rm, ''),
     V.matchCardHTML(st, st.matches[0], rm, '') + V.matchCardHTML(st, st.matches[1], rm, ''), '列表就是卡片接起來');
  eq(V.pipsOf(1, 0), '', 'BO1 沒有點點');
  console.log('  標記、跳脫、點點、平手、退一局、輪空 ✓');

  eq(V.visibleMatches(st, st.matches, true, '').map(m => m.table).join(), '1,2', '依桌號排');
  eq(V.visibleMatches(st, st.matches, false, '').map(m => m.table).join(), '2,1', '不排序就照原本');
  eq(V.visibleMatches(st, st.matches, false, '陳').map(m => m.table).join(), '2', '搜尋');
  ok(st.matches[0].table === '2', '排序不會動到原本的陣列');
  eq(V.findMsg('陳', '陳 ', 1, 2), '符合的 1 桌（共 2 桌）', '找到幾桌');
  eq(V.findMsg('zz', ' zz ', 0, 2), '找不到「zz」', '找不到');
  eq(V.findMsg('', '', 2, 2), '', '沒搜尋就不顯示');
  console.log('  排序、搜尋、搜尋結果那一行 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
