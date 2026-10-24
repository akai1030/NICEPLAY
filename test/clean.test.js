/* NICEPLAY 外來狀態整理測試 —— node test/clean.test.js

   副控、選手手機、投影窗畫的都是別臺推過來的狀態。這裡模擬那份狀態被動過手腳：
   id 與編號塞了標籤，丟進 store.replace（房間伺服器推來、匯入存檔都走這裡），
   再用控制台、選手、投影三個畫面實際畫一次，HTML 裡不能出現那段標籤。
   另外確認正常的狀態經過整理之後一個字都沒變。 */
'use strict';

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k) };
}
global.localStorage = memStorage();

const S = require('../src/store.js');
const F = require('../src/fmt.js');
const V = require('../src/view.js');
const W = require('../src/watch.js');
const P = require('../src/present.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);

const BAD = '"><img src=x onerror=alert(1)>';

/* 三個畫面會畫的每一塊都畫一次，接成一整串 */
function everything(st, meId) {
  const r = F.currentRound(st);
  const ms = r === null ? [] : F.matchesOf(st, r);
  const rm = F.recMap(st);
  return [
    V.rosterHTML(st.players), V.matchListHTML(st, ms, rm, meId), V.rankView(st, '', '').html,
    V.tentsHTML(st, V.tentMatches(st, r)), V.eventOptionsHTML(st, []),
    W.pickListHTML(st.players), W.myTable(st, r, meId).opp, W.myRoundsHTML(st, W.myMatches(st, meId), meId),
    W.roundMatchesHTML(st, ms, meId), W.rankHTML(st, meId),
    P.matchesHTML(st, ms, 56.25), P.rankHTML(st, 56.25),
    P.planHTML(st, r, { now: 0, remainMs: 0, url: '', qr: '' })
  ].join('\n');
}

function goodState() {
  const st = S.blank();
  st.id = 'evt1';
  st.event = { name: '週三', date: '2026-10-25', host: '桌遊記' };
  st.config.bo = 3;
  st.players = [{ id: 'pa', no: 1, name: '王<小明>', team: '', dropped: false },
                { id: 'pb', no: 2, name: '陳', team: '台東', dropped: false },
                { id: 'pc', no: 3, name: '林', team: '', dropped: true }];
  st.matches = [{ round: 1, table: '1', a: 'pa', b: 'pb', bo: 3, games: ['a', 'draw', 'a'], result: 'a' },
                { round: 1, table: '輪空', a: 'pc', b: null, bo: 1, games: [], result: 'bye' },
                { round: '決賽', table: 'A', a: 'pb', b: 'pa', bo: 1, games: [], result: null }];
  st.room = { view: 'T4ADCA', srv: '' };
  return st;
}

head('【1】id 與編號塞了標籤，丟進 store.replace 之後三個畫面都畫不出來');
{
  const st = goodState();
  st.players.push({ id: BAD, no: BAD, name: '壞人', team: '' });
  st.players[1].no = BAD;
  st.matches.push({ round: 1, table: '9', a: BAD, b: 'pa', bo: BAD, games: [BAD], result: BAD });
  st.matches[2].bo = '3' + BAD;
  st.matches[2].games = ['a', BAD];
  st.config.rules.win = BAD;
  st.config.cut = BAD;

  const store = S.create();
  store.replace(st);
  const got = store.get();
  const html = everything(got, 'pb');
  /* 連跳脫過的「&lt;img … onerror」都不該有 —— 入口就整筆丟掉或轉成數字了 */
  ok(html.indexOf('<img') < 0 && html.indexOf('onerror') < 0, '三個畫面的 HTML 裡連那段字都沒有');
  eq(got.players.map(p => p.id).join(), 'pa,pb,pc', 'id 不合格的那位整筆丟掉');
  eq(got.players[1].no, 2, '編號不是數字就照順序補回來');
  eq(got.matches.length, 3, '牽涉到壞 id 的那場也丟掉');
  eq(got.matches[2].bo, 1, '幾勝制轉成整數，轉不了就是 BO1');
  eq(got.matches[2].games.join(), 'a', '逐局只留 a／b／draw');
  eq(got.config.rules.win, 3, '積分規則轉成數字，轉不了就用預設');
  eq(got.config.cut, 0, '晉級人數轉成整數');
  console.log('  控制台、選手、投影都擋住 ✓');
}

head('【2】其他欄位被動過手腳');
{
  const st = goodState();
  st.id = BAD;
  st.room = { view: BAD, srv: 'x' };
  st.players[0].name = { toString: () => '物件' };
  st.matches[0].table = 7;
  st.matches[0].result = 'win';
  st.matches[1].games = 'aaa';
  const c = S.clean(st);
  ok(/^[\w-]+$/.test(c.id) && c.id !== BAD, '這一場的 id 不合格就換一個新的');
  eq(c.room, null, '選手查詢碼不合格就當成沒開房（那段會進網址與 QR）');
  eq(c.players[0].name, '物件', '名字維持字串');
  eq(c.matches[0].table, '7', '桌號維持字串');
  eq(c.matches[0].result, null, '不認得的勝負當成還沒回報');
  eq(JSON.stringify(c.matches[1].games), '[]', '逐局不是陣列就清空');
  eq(S.clean(null), null, '不是物件就原樣還回去');
  console.log('  event id、查詢碼、名字、桌號、勝負、逐局 ✓');
}

head('【3】正常的狀態整理完一個字都沒變（匯出的存檔不會因此改變）');
{
  const st = goodState();
  const before = JSON.stringify(st);
  const c = S.clean(st);
  ok(c === st, '同一個物件');
  eq(JSON.stringify(c), before, '內容完全相同');
  const old = goodState();
  delete old.players[0].team; delete old.matches[0].bo; delete old.matches[0].games;
  const b2 = JSON.stringify(old);
  eq(JSON.stringify(S.clean(old)), b2, '舊存檔缺的欄位不會被補上');
  console.log('  不改正常資料、不補欄位 ✓');
}

head('【4】第二道：就算繞過 store 直接把髒狀態丟給畫面，也拼不出標籤');
{
  const st = goodState();
  st.players.push({ id: BAD, no: BAD, name: BAD, team: BAD });
  st.players[1].no = BAD;
  st.matches.push({ round: 1, table: BAD, a: BAD, b: 'pa', bo: '3' + BAD, games: ['a'], result: null });
  st.config.rules.win = BAD;
  const html = everything(st, BAD);
  ok(html.indexOf('<img') < 0, '控制台、選手、投影的輸出端都有 esc()／Number()，拼出來沒有 <img');
  console.log('  輸出端也擋得住 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
