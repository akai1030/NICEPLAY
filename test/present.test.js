/* NICEPLAY 投影畫面測試 —— node test/present.test.js

   src/present.js 決定投影上寫什麼、字多大。投影是全場一起看的，
   排錯欄數會讓後排看不到字，預計結束時間算錯會讓整場的人白等。 */
'use strict';

const P = require('../src/present.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);

const rules = { win: 3, draw: 1, loss: 0 };
const players = [{ id: 'a', no: 1, name: '王<小明>' }, { id: 'b', no: 2, name: '陳' },
                 { id: 'c', no: 3, name: '林' }, { id: 'd', no: 4, name: '李', dropped: true }];

head('【1】小標與頁尾');
{
  eq(P.tagText(null), '—', '還沒開始');
  eq(P.tagText(3), 'R3', '數字輪次');
  eq(P.tagText('決賽'), '決', '中文輪次拿掉「賽」');
  eq(P.footText(null, []), '', '還沒開始沒有頁尾');
  const ms = [{ a: 'a', b: 'b', result: 'a' }, { a: 'c', b: 'd', result: null }, { a: 'e', b: null, result: 'bye' }];
  eq(P.footText(2, ms), '第 2 輪　已回報 1/2　·　尚有 1 桌未回報', '輪空不算一桌');
  ms[1].result = 'draw';
  eq(P.footText(2, ms), '第 2 輪　已回報 2/2　·　全部回報完畢', '全部回報');
  console.log('  R3、決、回報進度 ✓');
}

head('【2】賽程總覽：預計結束時間');
{
  const st = { event: { name: '週三<夜>', host: '桌遊記' }, players: players,
               matches: [{ round: 1 }, { round: 2 }],
               config: { format: 'swiss', rounds: 5, minutes: 50, cut: 0, bo: 1, boKO: 1, rules: rules } };
  const now = new Date(2026, 9, 25, 10, 0, 0).getTime();   /* 用本地時間，不管跑在哪個時區都一樣 */
  /* 第 2 輪還剩 10 分（9 分 1 秒進位成 10）＋ 後面 3 輪 ×（50＋5）＝ 175 分 → 12:55 */
  const h = P.planHTML(st, 2, { now: now, remainMs: 9 * 60000 + 1000, url: '', qr: '' });
  ok(h.indexOf('<i>ETA</i><b>12:55</b><span>預計結束（參考）</span>') > 0, '預計 12:55');
  ok(h.indexOf('<i>ROUND</i><b>2 / 5</b><span>第幾輪</span>') > 0, '第幾輪');
  ok(h.indexOf('<i>PLAYERS</i><b>3</b>') > 0, '退賽的人不算');
  ok(h.indexOf('<i>CLOCK</i><b>50 分</b>') > 0, '每輪時間');
  ok(h.indexOf('<b>週三&lt;夜&gt;</b><span>主辦　桌遊記</span><em>瑞士制 5 輪　BO1</em>') > 0, '表頭、跳脫、賽制');
  ok(h.indexOf('pv-plan-qr') < 0, '沒有房間就沒有 QR');

  const late = P.planHTML(st, 2, { now: now, remainMs: -60000, url: '', qr: '' });
  ok(late.indexOf('<b>12:45</b>') > 0, '超時不倒扣，當成這一輪剩 0 分');

  const q = P.planHTML(st, 2, { now: now, remainMs: 0, url: 'https://x/#join=AB', qr: '<svg/>' });
  ok(q.indexOf('<div class="pv-plan-qrimg"><svg/></div>') > 0, '有房間就放 QR');

  st.config.minutes = 0;
  ok(P.planHTML(st, 2, { now: now, remainMs: 0, url: '', qr: '' }).indexOf('<i>ETA</i><b>—</b><span>未設定時間</span>') > 0,
     '不計時就不估');
  st.config.format = 'single'; st.config.minutes = 50;
  const ko = P.planHTML(st, '四強', { now: now, remainMs: 0, url: '', qr: '' });
  ok(ko.indexOf('<i>ROUND</i><b>2</b><span>輪次</span>') > 0, '淘汰賽沒有總輪數，寫已經打了幾輪');
  ok(ko.indexOf('<b>—</b><span>未設定時間</span>') > 0, '淘汰賽不估結束時間');
  console.log('  ETA、超時、人數、QR、不計時、淘汰賽 ✓');
}

head('【3】欄數：挑字最大的那個');
{
  /* 16:9 的視窗 → vh＝56.25 */
  const vh = 56.25;
  const g1 = P.fitGrid(1, vh, 6, 13.5, 3.5);
  eq(g1.cols + 'x' + g1.rows, '1x1', '一桌就一欄');
  const g8 = P.fitGrid(8, vh, 6, 13.5, 3.5);
  eq(g8.cols + 'x' + g8.rows, '2x4', '八桌在 16:9 排兩欄四列');
  ok(Math.abs(g8.f - Math.min(50 / 13.5, vh * 0.74 / 4 / 3.5)) < 1e-9, '字級＝寬、高兩邊比較小的那個');
  eq(P.fitGrid(40, vh, 6, 13.5, 3.5).cols, 5, '四十桌排 5 欄（6 欄反而太窄）');
  eq(P.fitGrid(200, vh, 6, 13.5, 3.5).cols, 6, '再多也最多 6 欄');
  const g0 = P.fitGrid(0, vh, 6, 13.5, 3.5);
  eq(JSON.stringify(g0), '{"f":0,"cols":1,"rows":0}', '沒有場次不會除以零');
  console.log('  1 桌、8 桌、40 桌、0 桌 ✓');
}

head('【4】對戰表');
{
  const st = { players: players,
               matches: [{ round: 1, table: '1', a: 'a', b: 'b', result: 'a' },
                         { round: 2, table: '7', a: 'b', b: 'a', bo: 3, games: ['b', 'a'], result: null },
                         { round: 2, table: '8', a: 'c', b: null, result: 'bye' }],
               config: { liveTable: '7', rules: rules } };
  const ms = st.matches.slice(1);
  const h = P.matchesHTML(st, ms, 56.25);
  ok(h.indexOf('<div class="pv-grid" style="grid-template-columns:repeat(1,1fr);grid-template-rows:repeat(2,1fr)">') === 0,
     '兩桌在 16:9 上下排（並排的話字反而比較小）：' + h.slice(0, 100));
  ok(h.indexOf('<div class="pv-seat live"') > 0, '直播桌');
  ok(h.indexOf('<span class="nm2">王&lt;小明&gt;</span>') > 0, '名字有跳脫');
  ok(/<b class="gm" style="font-size:[\d.]+vw">1<\/b>/.test(h), 'BO3 寫局數');
  ok(h.indexOf('<span class="rec" style="font-size:') > 0 && h.indexOf('vw">1-0</span>') > 0, '名字旁邊的戰績');
  ok(h.indexOf('>BYE</div><div class="pv-p pv-empty"') > 0, '輪空');
  const f = P.matchesHTML(st, [], 56.25);
  eq(f, '<div class="pv-grid" style="grid-template-columns:repeat(1,1fr);grid-template-rows:repeat(0,1fr)"></div>', '沒有場次');

  const w = P.line(st, st.matches[0], 'a', 2, {});
  ok(w.indexOf('<div class="pv-p a win" style="font-size:2vw">') === 0 && w.indexOf('>勝</b>') > 0, '贏的那邊');
  ok(P.line(st, st.matches[0], 'b', 2, {}).indexOf('<div class="pv-p b lose"') === 0, '輸的那邊');
  ok(P.line(st, { a: 'a', b: 'b', result: 'draw' }, 'a', 2, {}).indexOf('<div class="pv-p a"') === 0, '平手兩邊都不標');
  console.log('  欄數、直播桌、跳脫、局數、戰績、輪空、勝負 ✓');
}

head('【5】名次投影');
{
  const st = { players: players,
               matches: [{ round: 1, table: '1', a: 'a', b: 'b', result: 'a' },
                         { round: 1, table: '2', a: 'c', b: 'd', result: 'a' }],
               config: { cut: 2, rules: rules } };
  const h = P.rankHTML(st, 56.25);
  eq((h.match(/<div class="pv-rk[^"]*"/g) || []).join(' '),
     '<div class="pv-rk in top4" <div class="pv-rk in top4" <div class="pv-rk top4" <div class="pv-rk out"',
     '晉級、前四名、退賽');
  ok(h.indexOf('王&lt;小明&gt;') > 0, '名字有跳脫');
  const none = P.rankHTML({ players: players, matches: [], config: { cut: 2, rules: rules } }, 56.25);
  ok(none.indexOf(' in') < 0 && none.indexOf('top4') < 0, '還沒打就不標晉級與前四名');
  ok(P.rankHTML({ players: [], matches: [], config: { rules: rules } }, 56.25)
       .indexOf('grid-template-columns:repeat(1,1fr);grid-template-rows:repeat(1,1fr)') > 0, '沒有人也排得出來');
  console.log('  晉級、前四名、退賽、空名單 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
