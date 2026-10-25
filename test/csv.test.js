/* NICEPLAY 匯出 CSV 測試 —— node test/csv.test.js

   CSV 是店家拿去貼 Excel、上傳官方系統的東西，壞了不會有任何錯誤訊息，
   只會在別人的電腦上打開變成亂碼、擠成一行、或被當成公式。 */
'use strict';

const C = require('../src/csv.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);

head('【1】一格：公式開頭補單引號，逗號、引號、換行用雙引號包');
{
  eq(C.csvCell('=1+1'), "'=1+1", '= 開頭');
  eq(C.csvCell('+886'), "'+886", '+ 開頭');
  eq(C.csvCell('-1'), "'-1", '- 開頭');
  eq(C.csvCell('@x'), "'@x", '@ 開頭');
  eq(C.csvCell('\tx'), "'\tx", 'Tab 開頭');
  eq(C.csvCell('陳, "小美"'), '"陳, ""小美"""', '逗號與雙引號');
  eq(C.csvCell('a\nb'), '"a\nb"', '換行');
  eq(C.csvCell('王小明'), '王小明', '一般文字不動');
  eq(C.csvCell(null), '', 'null');
  eq(C.csvCell(undefined), '', 'undefined');
  eq(C.csvCell(0), '0', '數字 0');
  console.log('  公式注入、跳脫、空值 ✓');
}

head('【2】整份：開頭有 BOM、換行是 CRLF');
{
  const t = C.csvText([['a', 'b'], ['=x', 'y\nz']]);
  eq(t.charCodeAt(0), 0xFEFF, '第一個字是 BOM（Excel 才認得 UTF-8）');
  eq(t.slice(1), "a,b\r\n'=x,\"y\nz\"", '逗號分欄、CRLF 分列，格子裡的換行不算');
  console.log('  BOM＋CRLF ✓');
}

const st = {
  players: [{ id: 'a', no: 1, name: '王小明' }, { id: 'b', no: 2, name: '=1+1' },
            { id: 'c', no: 3, name: '陳小美', dropped: true }],
  matches: [
    { round: 1, table: '1', a: 'a', b: 'b', bo: 3, games: ['a', 'b', 'a'], result: 'a' },
    { round: 1, table: '輪空', a: 'c', b: null, result: 'bye' },
    { round: '四強', table: '2', a: 'b', b: 'a', bo: 1, games: [], result: null },
    { round: 'W1', table: '3', a: 'a', b: 'c', bo: 2, games: ['a', 'b'], result: 'draw' }
  ],
  config: { rules: { win: 3, draw: 1, loss: 0 } }
};

head('【3】名次表');
{
  const r = C.rankRows(st);
  eq(r[0].join(), '名次,編號,選手,勝,敗,平手,輪空,積分,OMW%,OOMW%,狀態', '欄位固定');
  eq(r.length, 4, '標題＋三位');
  const c = r.filter(x => x[2] === '陳小美')[0];
  eq(c[10], '退賽', '退賽的人標出來');
  ok(/^\d+\.\d$/.test(r[1][8]), 'OMW% 一位小數：' + r[1][8]);
  console.log('  欄位、退賽、百分比格式 ✓');
}

head('【4】對戰紀錄：一場一列，含小局比分');
{
  const r = C.logRows(st);
  eq(r[0].join(), '輪次,桌號,幾勝制,選手A編號,選手A,選手B編號,選手B,結果,A小局,B小局,和局,逐局', '欄位固定');
  eq(r[1].join('|'), '第 1 輪|1|BO3|1|王小明|2|=1+1|王小明 勝|2|1|0|ABA', 'BO3 打成 2-1');
  eq(r[2].join('|'), '第 1 輪|輪空|BO1||陳小美|||輪空（視同勝）||||', '輪空那一列只留 A 選手');
  eq(r[3][7], '未回報', '還沒打完');
  eq(r[3][0], '四強', '淘汰賽輪次照原樣');
  eq(r[4][0], '勝部第 1 輪', '雙敗的代號翻成人話');
  eq(r[4][7], '平手', 'BO2 打成 1-1');
  eq(r[4][11], 'AB', '逐局');
  ok(C.csvText(r).indexOf(",'=1+1,") > 0, '名字是公式的，寫進檔案時有補單引號');
  console.log('  勝負、輪空、未回報、平手、逐局 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
