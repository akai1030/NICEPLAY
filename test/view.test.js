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
  /* 以前提示只產到第 60 個桌名：寫著「80 桌」，尾巴卻是 60。引擎本身沒有 60 的限制 */
  eq(V.tableHintHTML(120, 80, 'number', []),
     '120 人 → 需要 <b>60</b> 桌，目前設定 <b>80</b> 桌：1、2、3、4、5、6、7、8 …… 80', '設 80 桌，最後一桌要是第 80 桌');
  ok(V.tableHintHTML(120, 80, 'letter', []).endsWith('…… CB'), '字母命名的第 80 桌是 CB');

  /* 上限只有一個：Engine.MAX_TABLES，桌數欄的 max 也是它。超過的在提示裡講清楚會照上限算 */
  const E = require('../src/engine.js');
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  eq(Number((html.match(/id="fTables"[^>]*\bmax="(\d+)"/) || [])[1]), E.MAX_TABLES, '桌數欄的 max 跟 Engine.MAX_TABLES 不一樣');
  eq(V.tableHintHTML(600, 300, 'number', []),
     '600 人 → 需要 <b>300</b> 桌，目前設定 <b>256</b> 桌：1、2、3、4、5、6、7、8 …… 256' +
     '。桌數最多 <b>256</b>，填 300 會照 256 算', '超過上限：照上限算，而且要講');
  console.log('  建議桌數、自訂桌名、80 桌產到第 80 個、上限 ✓');
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

head('【5】名次表');
{
  const E = require('../src/engine.js');
  const P = [{ id: 'p0', no: 1, name: '王<1>' }, { id: 'p1', no: 2, name: '陳' },
             { id: 'p2', no: 3, name: '林' }, { id: 'p3', no: 4, name: '李' }];
  const st = { players: P,
               matches: [{ round: 1, table: '1', a: 'p0', b: 'p1', result: 'a' },
                         { round: 1, table: '2', a: 'p2', b: 'p3', result: 'b' }],
               config: { cut: 2, rules: { win: 3, draw: 1, loss: 0 } } };

  eq(JSON.stringify(V.rankView({ players: [], matches: [], config: {} }, '', '')),
     JSON.stringify({ html: '<div class="hint">還沒有名單。</div>', title: null }), '還沒有名單：標題不動');
  eq(V.rankView(st, '', '').title, '即時名次 · 前 2 名晉級', '有晉級人數');
  eq(V.rankTitle(0), '即時名次', '沒有晉級人數');

  const h = V.rankView(st, '', '').html;
  eq((h.match(/<tr class="[^"]*">/g) || []).join(' '),
     '<tr class="cut top4 "> <tr class="cut cutline top4 "> <tr class="top4 "> <tr class="top4 ">',
     '晉級、晉級線、前四名');
  ok(h.indexOf('王&lt;1&gt;') > 0, '名字有跳脫');
  ok(h.indexOf('<div class="tbk">OMW ') > 0, '打過才掛手機版的 OMW 那一行');

  const none = V.rankView({ players: P, matches: [], config: { cut: 0, rules: st.config.rules } }, '', '');
  ok(none.html.indexOf('tbk') < 0 && none.html.indexOf('top4') < 0, '還沒打就沒有前四名、沒有 OMW 那一行');

  const f = V.rankView(st, '林', '林');
  eq((f.html.match(/<tr /g) || []).length, 1, '搜尋只留符合的那一列');
  ok(f.html.indexOf('<td class="rk">4</td>') > 0, '名次照全體算：林輸了、只剩他一列也還是第 4');
  eq(f.title, '即時名次 · 前 2 名晉級', '搜尋時標題照樣更新');
  eq(V.rankView(st, 'zz', ' zz< ').html, '<div class="hint">找不到「zz&lt;」。這一份名單上共 4 人。</div>',
     '找不到：原本打的字去空白、有跳脫');
  eq((V.rankView(st, '3', '3').html.match(/<tr /g) || []).length, 1, '打編號也找得到');

  const d = JSON.parse(JSON.stringify(st)); d.players[0].dropped = true;
  const dh = V.rankView(d, '', '').html;
  ok(dh.indexOf('<tr class="out">') > 0, '退賽的人那一列灰掉、不算晉級');
  ok(dh.indexOf('<button class="dropb on" data-id="p0">已退賽</button>') > 0, '退賽鈕變「已退賽」');

  const b = JSON.parse(JSON.stringify(st));
  b.matches.push({ round: 2, table: '1', a: 'p0', b: null, result: 'bye' });
  ok(V.rankView(b, '', '').html.indexOf('輪空1</span>') > 0, '輪空次數');

  const g = JSON.parse(JSON.stringify(st));
  g.config.groups = 2; g.config.cut = 4; g.players = E.assignGroups(g.players, 2);
  const gv = V.rankView(g, '', '');
  eq(gv.title, '分組名次 · 各組前 2 名晉級', '分組：每組晉級人數＝總數÷組數');
  eq((gv.html.match(/<h3 class="grp">[^<]*<span>[^<]*<\/span><\/h3>/g) || []).join(''),
     '<h3 class="grp">A 組　<span>2 人</span></h3><h3 class="grp">B 組　<span>2 人</span></h3>', '各組一個標題');
  eq((gv.html.match(/<table class="rank">/g) || []).length, 2, '各組一張表');
  g.config.cut = 0;
  eq(V.rankView(g, '', '').title, '分組名次', '分組、沒有晉級人數');
  console.log('  空名單、晉級線、前四名、搜尋、退賽、輪空、分組 ✓');
}

head('【6】桌卡');
{
  const st = { event: { host: '桌遊記', name: '' },
               players: [{ id: 'a', no: 1, name: '王<小明>' }, { id: 'b', no: 2, name: '陳' },
                         { id: 'c', no: 3, name: '林' }, { id: 'd', no: 4, name: '李' }, { id: 'e', no: 5, name: '吳' }],
               matches: [{ round: 1, table: '1', a: 'e', b: 'd', result: 'a' },
                         { round: 2, table: '10', a: 'a', b: 'b', bo: 3 },
                         { round: 2, table: '輪空', a: 'e', b: null, result: 'bye' },
                         { round: 2, table: '2', a: 'c', b: 'd' }] };
  const ms = V.tentMatches(st, 2);
  eq(ms.map(m => m.table).join(), '2,10', '只印那一輪、輪空不印、照桌號排');
  const h = V.tentsHTML(st, ms);
  eq((h.match(/<div class="tent">/g) || []).length, 2, '一場一張');
  ok(h.indexOf('<div class="tent-hd">桌遊記<b>第 2 輪</b></div>') > 0, '沒有賽事名稱就只放主辦');
  ok(h.indexOf('<i>1</i>王&lt;小明&gt;') > 0, '名字有跳脫');
  ok(h.indexOf('<div class="tent-vs">VS　·　BO3　先贏 2 局</div>') > 0, 'BO3 寫先贏幾局');
  ok(h.indexOf('<div class="tent-vs">VS</div>') > 0, 'BO1 只寫 VS');
  ok(V.tentsHTML({ event: { host: 'A', name: 'B' }, players: [], matches: [] },
                 [{ round: 'W1', table: '3', a: 'x', b: 'y' }]).indexOf('A　·　B<b>勝部第 1 輪</b>') > 0, '主辦與名稱都有、雙敗輪次');
  console.log('  場次篩選、排序、表頭、BO 說明 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
