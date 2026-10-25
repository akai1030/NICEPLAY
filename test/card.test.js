/* NICEPLAY 賽後成績單測試 —— node test/card.test.js

   成績單是選手自己存下來轉發的圖，畫錯了沒有人會回報，只會在別人的限動上看到。
   這裡用一個假的 2D context 記下每一次 fillText，檢查寫上去的字與位置。 */
'use strict';

const K = require('../src/card.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);

/* 假畫布：只記下 fillText／fillRect 與當下的 fillStyle、textAlign */
function fakeCanvas() {
  const calls = [];
  const g = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'start',
    fillRect(x, y, w, h) { calls.push({ op: 'rect', x, y, w, h, fill: g.fillStyle }); },
    fillText(t, x, y) { calls.push({ op: 'text', t, x, y, fill: g.fillStyle, align: g.textAlign, font: g.font }); },
    measureText(t) { return { width: String(t).length * 100 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}
  };
  return { cv: { width: 1080, height: 1350, getContext: () => g }, calls };
}
const texts = calls => calls.filter(c => c.op === 'text').map(c => c.t);

const rules = { win: 3, draw: 1, loss: 0 };
const st = {
  theme: 'dark',
  event: { host: '桌遊記', name: '週三夜間賽', date: '2026-10-25' },
  players: [{ id: 'a', no: 1, name: '王小明', team: '台東隊' }, { id: 'b', no: 2, name: '陳' },
            { id: 'c', no: 3, name: '林' }],
  matches: [
    { round: 1, table: '1', a: 'a', b: 'b', result: 'a' },
    { round: 1, table: '輪空', a: 'c', b: null, result: 'bye' },
    { round: 2, table: '1', a: 'c', b: 'a', bo: 3, games: ['b', 'a', 'b'], result: 'b' },
    { round: 2, table: '輪空', a: 'b', b: null, result: 'bye' },
    { round: '決賽', table: '1', a: 'b', b: 'a', result: null }
  ],
  config: { rules: rules }
};

head('【1】每一輪那幾行');
{
  const r = K.roundRows(st, 'a');
  eq(r.map(x => [x.round, x.opp, x.score, x.tag].join('|')).join(' / '),
     '第 1 輪|陳||勝 / 第 2 輪|林|2-1|勝 / 決賽|陳||進行中', 'B 方的 BO3 比分要翻成自己這邊');
  eq(K.roundRows(st, 'b').map(x => x.tag).join(), '敗,輪空,進行中', '敗與輪空');
  eq(K.roundRows({ matches: [{ round: 1, a: 'a', b: null, result: 'noshow' }], players: [] }, 'a')[0].tag, '未到', '沒到場的輪空');
  eq(K.roundRows({ matches: [{ round: 1, a: 'a', b: 'b', result: 'draw' }], players: [] }, 'a')[0].tag, '平手', '平手');
  const many = { players: [], matches: Array.from({ length: 12 }, (_, i) => ({ round: i + 1, a: 'a', b: null, result: 'bye' })) };
  eq(K.roundRows(many, 'a').length, 9, '畫布只排得下 9 輪');
  console.log('  勝、敗、平、輪空、未到、進行中、BO 比分方向、最多 9 輪 ✓');
}

head('【2】整張圖');
{
  const { cv, calls } = fakeCanvas();
  K.draw(cv, st, st.players[0]);
  const t = texts(calls);
  eq(t[0], '桌遊記　·　週三夜間賽', '主辦與賽事名稱在最上面');
  eq(t[1], '2026-10-25', '日期');
  eq(t[2], '1', '名次是第一個大數字');
  eq(calls.filter(c => c.t === '名')[0].x, 80 + 100 + 20, '「名」緊接在名次數字後面');
  ok(t.indexOf('王小明') > 0 && t.indexOf('台東隊') === t.indexOf('王小明') + 1, '名字底下是隊名');
  ok(t.indexOf('2-0') > 0 && t.indexOf('6') > 0, '戰績與積分');
  const tags = calls.filter(c => c.t === '勝');
  eq(tags.length, 2, '兩輪勝');
  ok(tags.every(c => c.fill === '#FF2ED1' && c.align === 'right' && c.x === 1080 - 80), '勝是品牌粉紅、靠右');
  eq(calls.filter(c => c.t === '2-1')[0].x, 1080 - 200, 'BO 比分在勝負左邊');
  eq(calls.filter(c => c.t === '進行中')[0].fill, 'rgba(255,255,255,.62)', '其他狀態用淡色');
  eq(t[t.length - 1], 'NICEPLAY · niceplay.transtation.org', '最底下是網址');
  eq(calls[0].fill, '#0B0D12', '深色主題的底色');
  console.log('  表頭、名次、名字、隊名、三個數字、每一輪、頁尾 ✓');
}

head('【3】淺色主題、沒有隊名、名單上找不到我');
{
  const light = Object.assign({}, st, { theme: 'light', event: { host: '', name: '', date: '' } });
  const { cv, calls } = fakeCanvas();
  K.draw(cv, light, st.players[1]);
  eq(calls[0].fill, '#FFFFFF', '淺色主題的底色');
  eq(texts(calls)[0], 'NICEPLAY', '沒有主辦也沒有名稱就寫 NICEPLAY');
  ok(texts(calls).indexOf('台東隊') < 0, '沒有隊名就不畫那一行');

  const gone = fakeCanvas();
  K.draw(gone.cv, st, { id: 'zz', name: '不在名單上' });
  eq(texts(gone.calls).length, 0, '找不到我：只畫底色與漸層條，不寫字');
  eq(gone.calls.filter(c => c.op === 'rect').length, 2, '底色＋漸層條');
  console.log('  淺色、預設標題、沒有隊名、找不到人 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
