/* NICEPLAY 狀態層測試 —— node test/store.test.js

   名單解析是整套的入口：貼進去的東西長什麼樣，後面全部跟著走。
   還原點是最後一道保險，兩者原本都沒有測試守著。 */
'use strict';

/* store.js 只用到 localStorage，補一個就能在 Node 跑 */
function memStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _clear: () => m.clear()
  };
}
global.localStorage = memStorage();

const S = require('../src/store.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);
const names = list => list.map(p => p.name).join('|');

head('【1】名單解析：一行一位，前面的號碼可有可無');
{
  eq(names(S.parsePlayers('王小明\n陳小美\n林阿明')), '王小明|陳小美|林阿明', '純名字');
  eq(names(S.parsePlayers('1 王小明\n2 陳小美')), '王小明|陳小美', '號碼加空白');
  eq(names(S.parsePlayers('1. 王小明\n2, 陳小美\n3、林阿明')), '王小明|陳小美|林阿明', '各種分隔符');
  eq(names(S.parsePlayers('01：王小明\n02）陳小美')), '王小明|陳小美', '全形冒號與括號');
  eq(names(S.parsePlayers('1．王小明\n2，陳小美\n3；林阿明')), '王小明|陳小美|林阿明',
     '全形句點、逗號、分號（Word／Excel 貼出來的樣子）');
  eq(names(S.parsePlayers('1】王小明')), '王小明', '全形方括號');
  console.log('  半形與全形的編號分隔符都解得出來 ✓');
}

head('【2】名字裡的空白不能被切掉');
{
  eq(names(S.parsePlayers('1 王 小明')), '王 小明', '中文名字中間的空白');
  eq(names(S.parsePlayers('John Smith')), 'John Smith', '英文姓名');
  eq(names(S.parsePlayers('3 Mary Jane Watson')), 'Mary Jane Watson', '號碼後面整串都是名字');
  /* 「-」刻意不當分隔符：有人的名字或隊名本來就長那樣 */
  eq(names(S.parsePlayers('3-Ply')), '3-Ply', '名字裡的連字號不能被當成編號分隔符');
  console.log('  只切掉開頭的號碼，名字本身完整保留 ✓');
}

head('【3】空行、重複、亂七八糟的輸入');
{
  eq(S.parsePlayers('').length, 0, '空字串');
  eq(S.parsePlayers('\n\n  \n').length, 0, '只有空行');
  eq(S.parsePlayers(null).length, 0, 'null 不該炸');
  eq(names(S.parsePlayers('王小明\n\n\n陳小美')), '王小明|陳小美', '中間的空行要略過');
  eq(names(S.parsePlayers('王小明\n王小明\n陳小美')), '王小明|陳小美', '同名只留一個');
  eq(names(S.parsePlayers('Amy\namy')), 'Amy', '同名不分大小寫');
  console.log('  空的、重複的都處理掉，不會炸 ✓');
}

head('【4】編號一定是從 1 開始連續的');
{
  const list = S.parsePlayers('7 王小明\n99 陳小美\n2 林阿明');
  eq(list.map(p => p.no).join(','), '1,2,3', '貼進來的號碼要重排');
  ok(list.every(p => p.id && p.id !== list[0].id || p === list[0]), 'id 應該各不相同');
  const ids = new Set(list.map(p => p.id));
  eq(ids.size, 3, 'id 撞號了');
  console.log('  號碼重排成 1..N，id 各自唯一 ✓');
}

head('【5】空白狀態的預設值');
{
  const b = S.blank();
  eq(b.v, 1, '版本');
  eq(b.config.format, 'swiss', '預設賽制');
  eq(b.config.bo, 1, '常規賽預設 BO1');
  eq(b.config.boKO, 3, '淘汰賽預設 BO3');
  eq(b.config.rules.win, 3, '勝 3 分');
  eq(b.room, null, '一開始沒有房間');
  eq(b.phase, 'setup', '一開始在設定階段');
  console.log('  預設值都對 ✓');
}

head('【6】匯出／匯入 JSON');
{
  const st = S.blank();
  st.event.name = '週三夜間賽';
  st.players = S.parsePlayers('王小明\n陳小美');
  const back = S.fromJSON(S.toJSON(st));
  eq(back.event.name, '週三夜間賽', '賽事名稱');
  eq(back.players.length, 2, '名單長度');
  eq(back.players[0].name, '王小明', '名字');

  let threw = false;
  try { S.fromJSON('{"v":99}'); } catch (e) { threw = true; }
  ok(threw, '不是這個系統的存檔應該要擋下來');
  threw = false;
  try { S.fromJSON('不是 JSON'); } catch (e) { threw = true; }
  ok(threw, '壞掉的 JSON 應該要擋下來');
  console.log('  轉出去再讀回來一致，壞檔會被擋 ✓');
}

head('【7】還原點：存得進、讀得回、清得掉');
{
  global.localStorage._clear();
  eq(S.loadUndo(), null, '一開始沒有還原點');

  const st = S.blank();
  st.event.name = '被我清掉的那一場';
  st.players = S.parsePlayers('王小明\n陳小美\n林阿明');
  S.saveUndo(st, '全部清除重來');

  const u = S.loadUndo();
  ok(u !== null, '存進去卻讀不回來');
  eq(u.what, '全部清除重來', '動作名稱');
  eq(u.state.event.name, '被我清掉的那一場', '賽事名稱');
  eq(u.state.players.length, 3, '名單');
  ok(typeof u.at === 'number' && u.at > 0, '應該帶時間戳');

  S.clearUndo();
  eq(S.loadUndo(), null, '清掉之後應該讀不到');
  console.log('  存 → 讀 → 清，一輪都對 ✓');
}

head('【8】還原點跟主狀態是分開的兩把 key');
{
  global.localStorage._clear();
  const st = S.blank();
  st.event.name = '救命的那一份';
  S.saveUndo(st, '重排第 1 輪');

  /* 主狀態被清掉（例如按了「全部清除重來」），還原點必須還在 ——
     兩個綁在一起的話，最需要它的時候剛好就是它不見的時候。 */
  global.localStorage.removeItem(S.KEY);
  const u = S.loadUndo();
  ok(u !== null, '主狀態被清掉，還原點跟著不見了');
  eq(u.state.event.name, '救命的那一份', '還原點的內容');
  console.log('  清掉主狀態不會連還原點一起清掉 ✓');
}

head('【9】壞掉的還原點只是失效，不會讓程式炸掉');
{
  global.localStorage._clear();
  global.localStorage.setItem('niceplay.undo.v1', '{壞掉的 JSON');
  eq(S.loadUndo(), null, '壞掉的還原點應該當成沒有');
  global.localStorage.setItem('niceplay.undo.v1', '{"at":1,"state":{"v":99}}');
  eq(S.loadUndo(), null, '版本不對的還原點應該當成沒有');
  console.log('  讀不懂就當沒有，不會丟例外 ✓');
}

head('【10】舊存檔（沒有 bo / boKO）讀得進來，而且維持一勝制');
{
  const oldSave = {
    v: 1, rev: 5,
    event: { name: '上個月那場', date: '2026-07-01' },
    config: { format: 'swiss', rounds: 4, cut: 0, minutes: 30,
              tableNaming: 'number', tableCount: 0, customTables: [],
              rules: { win: 3, draw: 1, loss: 0, minWinPct: 0.25 }, liveTable: '' },
    players: [{ id: 'p1', no: 1, name: '王小明', dropped: false }],
    matches: [{ round: 1, table: '1', a: 'p1', b: null, result: 'bye' }],
    timer: { running: false, endsAt: 0, remainMs: 0, durMs: 0, round: null },
    room: null, theme: 'dark', phase: 'running'
  };
  const back = S.fromJSON(JSON.stringify(oldSave));
  eq(back.config.bo, undefined, '舊存檔本來就沒有 bo');
  const E = require('../src/engine.js');
  eq(E.gamesOf(back.matches[0]).length, 0, '輪空不該補出小局');
  /* 沒有 bo 的場次，引擎一律當成一勝制 */
  const m = { round: 1, table: '1', a: 'p1', b: 'p2', result: 'a' };
  const next = E.playGame(m, 'a');
  ok(next && next.result === null, '沒有 bo 的舊場次應該照一勝制運作');
  console.log('  上個月的存檔今天打開不會壞 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
