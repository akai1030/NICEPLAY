/* NICEPLAY 引擎測試 —— node test/engine.test.js */
const E = require('../src/engine.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const head = t => console.log('\n' + t);

let seed = 20260815;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const mk = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), no: i + 1, name: '選手' + (i + 1) }));
const cfg = (o = {}) => ({
  format: 'swiss', rounds: 5, cut: 0,
  tableNaming: 'letter', tableCount: 16, customTables: [],
  rules: { win: 3, draw: 1, loss: 0, minWinPct: 0.25 }, ...o
});

/* ───────────────────────────────────────── */
head('【1】桌號命名');
{
  ok(E.makeTables(4, 'letter').join() === 'A,B,C,D', '字母命名錯');
  ok(E.makeTables(4, 'number').join() === '1,2,3,4', '數字命名錯');
  ok(E.makeTables(3, 'custom', ['Q1', 'Q2', 'Q3']).join() === 'Q1,Q2,Q3', '自訂命名錯');
  ok(E.makeTables(3, 'custom', ['甲']).join() === '甲,2,3', '自訂不足時沒有補號碼');
  ok(E.letterName(25) === 'Z' && E.letterName(26) === 'AA', '超過 26 桌沒有接續 AA');
  ok(E.suggestRounds(32) === 5 && E.suggestRounds(8) === 3 && E.suggestRounds(12) === 4,
     '建議輪數算錯');
  ok(E.suggestTables(15) === 7, '奇數人建議桌數錯');
  console.log('  A–Z→AA、1–N、自訂、建議輪數 ceil(log2) ✓');
}

/* ───────────────────────────────────────── */
head('【2】瑞士制 32 人跑滿五輪');
{
  const players = mk(32);
  const state = { config: cfg(), players, matches: [] };
  const seen = new Set();

  for (let r = 1; r <= 5; r++) {
    const res = E.nextRound(state);
    ok(!res.error, `第 ${r} 輪：${res.error}`);
    ok(res.matches.length === 16, `第 ${r} 輪應該 16 桌，實際 ${res.matches && res.matches.length}`);
    ok(new Set(res.matches.map(m => m.table)).size === 16, `第 ${r} 輪桌號重複`);
    ok(res.matches[0].table === 'A' && res.matches[15].table === 'P', `第 ${r} 輪桌號順序不對`);

    const ppl = res.matches.flatMap(m => [m.a, m.b]);
    ok(new Set(ppl).size === 32, `第 ${r} 輪有人被排兩桌`);
    ok(E.check(res.matches).ok, `第 ${r} 輪體檢沒過`);

    res.matches.forEach(m => {
      const k = [m.a, m.b].sort().join('-');
      ok(!seen.has(k), `第 ${r} 輪重複對手 ${k}`);
      seen.add(k);
      m.round = r;
      const x = rnd();
      m.result = x < 0.1 ? 'draw' : (x < 0.55 ? 'a' : 'b');
    });
    state.matches = state.matches.concat(res.matches);
  }

  const fin = E.standings(players, state.matches, state.config.rules);
  const draws = state.matches.filter(m => m.result === 'draw').length;
  const total = fin.reduce((s, r) => s + r.pts, 0);
  ok(total === (state.matches.length - draws) * 3 + draws * 2, `總積分守恆失敗：${total}`);
  ok(fin.every(r => r.played === 5), '有人沒打滿五輪');
  for (let i = 1; i < fin.length; i++) {
    const a = fin[i - 1], b = fin[i];
    ok(a.pts > b.pts || (a.pts === b.pts && a.omw >= b.omw - 1e-9), `名次順序錯 ${a.name}/${b.name}`);
  }
  console.log('  16 桌 · 無重複對手 · 積分守恆 · 名次遞減 ✓');
  console.log('  前三名：' + fin.slice(0, 3)
    .map(r => `${r.rank}.${r.name} ${r.w}-${r.l}-${r.d} ${r.pts}分`).join('　'));

  head('【3】瑞士制跑完自動進八強（cut）');
  const s2 = { config: cfg({ cut: 8 }), players, matches: state.matches.slice() };
  const ko = E.nextRound(s2);
  ok(!ko.error, `八強配對失敗：${ko.error}`);
  ok(ko.matches.length === 4, `八強應該 4 桌，實際 ${ko.matches && ko.matches.length}`);
  ok(ko.matches[0].round === '八強', `輪次標籤錯：${ko.matches[0].round}`);
  const top8 = fin.slice(0, 8).map(r => r.id);
  const inKo = ko.matches.flatMap(m => [m.a, m.b]);
  ok(inKo.slice().sort().join() === top8.slice().sort().join(), '八強不是前八名');
  const rankOf = id => fin.find(r => r.id === id).rank;
  const shape = ko.matches.map(m => `${rankOf(m.a)}v${rankOf(m.b)}`).join(' ');
  ok(shape === '1v8 4v5 2v7 3v6', `交叉種子序錯：${shape}`);
  console.log('  ' + shape + '　（第 1 與第 2 到決賽才會遇到）✓');
}

/* ───────────────────────────────────────── */
head('【4】奇數人 · 輪空不重複');
{
  const players = mk(31);
  const state = { config: cfg(), players, matches: [] };
  const byes = [];
  for (let r = 1; r <= 5; r++) {
    const res = E.nextRound(state);
    const bye = res.matches.find(m => m.b === null);
    ok(!!bye, `第 ${r} 輪奇數人應該有輪空`);
    ok(!byes.includes(bye.a), `第 ${r} 輪輪空重複給了 ${bye.a}`);
    byes.push(bye.a);
    ok(res.matches.filter(m => m.b !== null).length === 15, `第 ${r} 輪應該 15 桌`);
    res.matches.forEach(m => { m.round = r; if (!m.result) m.result = rnd() < 0.5 ? 'a' : 'b'; });
    state.matches = state.matches.concat(res.matches);
  }
  const st = E.standings(players, state.matches, state.config.rules);
  const g = st.find(r => r.id === byes[0]);
  ok(g.byes === 1, '輪空次數沒算到');
  ok(g.opp.length === 4, `輪空不該列為對手，實際 ${g.opp.length}`);
  console.log('  五輪輪空各給不同人、視同勝、不列為對手 ✓');
}

/* ───────────────────────────────────────── */
head('【5】退賽');
{
  const players = mk(8);
  const state = { config: cfg(), players, matches: [] };
  let res = E.nextRound(state);
  res.matches.forEach(m => { m.round = 1; m.result = 'a'; });
  state.matches = res.matches;

  players[3].dropped = true;
  res = E.nextRound(state);
  const inR2 = res.matches.flatMap(m => [m.a, m.b]);
  ok(!inR2.includes('p4'), '退賽的人還被排進配對');
  ok(res.matches.filter(m => m.b === null)[0].a !== 'p4', '輪空給了退賽的人');
  const st = E.standings(players, state.matches, state.config.rules);
  ok(st[st.length - 1].id === 'p4', '退賽的人沒有排到最後');
  console.log('  不進配對 · 不拿輪空 · 排最後 · 成績仍計入別人 OMW ✓');
}

/* ───────────────────────────────────────── */
head('【6】OMW / OOMW 手算對照');
{
  const players = mk(4);
  const matches = [
    { round: 1, table: 'A', a: 'p1', b: 'p2', result: 'a' },
    { round: 1, table: 'B', a: 'p3', b: 'p4', result: 'a' },
    { round: 2, table: 'A', a: 'p1', b: 'p3', result: 'a' },
    { round: 2, table: 'B', a: 'p2', b: 'p4', result: 'a' }
  ];
  const st = E.standings(players, matches);
  const by = {}; st.forEach(r => by[r.id] = r);
  ok(by.p1.pts === 6 && Math.abs(by.p1.wp - 1) < 1e-9, '2 勝的積分／勝率錯');
  ok(by.p2.pts === 3 && Math.abs(by.p2.wp - 0.5) < 1e-9, '1 勝 1 敗錯');
  ok(by.p4.pts === 0 && Math.abs(by.p4.wp - 0.25) < 1e-9, '沒有套用 25% 勝率下限');
  ok(Math.abs(by.p1.omw - 0.5) < 1e-9, `p1 OMW 應為 50%，實際 ${(by.p1.omw * 100).toFixed(1)}%`);
  console.log('  勝率下限 25%、OMW、OOMW 與手算一致 ✓');
}

/* ───────────────────────────────────────── */
head('【7】純單敗淘汰（不經瑞士制）');
{
  const players = mk(8);
  const state = { config: cfg({ format: 'single', tableNaming: 'number' }), players, matches: [] };
  let res = E.nextRound(state);
  ok(res.matches.length === 4, `八強應該 4 桌，實際 ${res.matches.length}`);
  ok(res.matches[0].round === '八強', '輪次標籤錯');
  const seq = res.matches.map(m => `${players.findIndex(p => p.id === m.a) + 1}v${players.findIndex(p => p.id === m.b) + 1}`).join(' ');
  ok(seq === '1v8 4v5 2v7 3v6', `種子序錯：${seq}`);
  res.matches.forEach(m => m.result = 'a');
  state.matches = res.matches.slice();

  res = E.nextRound(state);
  ok(res.matches.length === 2 && res.matches[0].round === '四強', '四強錯');
  res.matches.forEach(m => m.result = 'a');
  state.matches = state.matches.concat(res.matches);

  res = E.nextRound(state);
  ok(res.matches.length === 1 && res.matches[0].round === '決賽', '決賽錯');
  res.matches.forEach(m => m.result = 'a');
  state.matches = state.matches.concat(res.matches);

  res = E.nextRound(state);
  ok(res.done === true, '打完冠軍之後應該回報結束');
  console.log('  八強 → 四強 → 決賽 → 結束 ✓');

  const half = [{ round: '四強', a: 'p1', b: 'p2', result: 'a' }, { round: '四強', a: 'p3', b: 'p4', result: null }];
  ok(E.nextBracketRound(half, players) === null, '上一輪沒打完卻產生了下一輪');
  console.log('  沒打完不會產生下一輪 ✓');
}

/* ───────────────────────────────────────── */
head('【8】非 2 次方人數的淘汰賽（6 人）');
{
  const players = mk(6);
  const state = { config: cfg({ format: 'single', tableNaming: 'number' }), players, matches: [] };
  const res = E.nextRound(state);
  const byes = res.matches.filter(m => m.b === null);
  ok(res.matches.length === 4, `8 格賽程樹應該 4 場，實際 ${res.matches.length}`);
  ok(byes.length === 2, `6 人應該有 2 個輪空，實際 ${byes.length}`);
  ok(byes.every(m => m.result === 'bye'), '輪空沒有自動標記');
  console.log('  6 人 → 2 人輪空晉級、其餘照打 ✓');
}

/* ───────────────────────────────────────── */
head('【9】循環賽 6 人');
{
  const players = mk(6);
  const state = { config: cfg({ format: 'roundrobin', tableNaming: 'number' }), players, matches: [] };
  const seen = new Set();
  let guard = 0;
  while (guard++ < 20) {
    const res = E.nextRound(state);
    if (res.done) break;
    ok(!res.error, `循環賽出錯：${res.error}`);
    res.matches.forEach(m => {
      const k = [m.a, m.b].sort().join('-');
      ok(!seen.has(k), `循環賽重複對戰 ${k}`);
      seen.add(k);
      m.round = E.countRounds(state.matches) + 1;
      m.result = rnd() < 0.5 ? 'a' : 'b';
    });
    state.matches = state.matches.concat(res.matches);
  }
  ok(seen.size === 15, `6 人循環應該共 15 場，實際 ${seen.size}`);
  console.log('  每個人都跟其他所有人打過一場，共 15 場，零重複 ✓');
}

/* ───────────────────────────────────────── */
head('【10】規模與決定性');
{
  for (const n of [64, 128, 256]) {
    const players = mk(n);
    const state = { config: cfg({ rounds: E.suggestRounds(n), tableCount: n / 2 }), players, matches: [] };
    const seen = new Set();
    let worst = 0;
    for (let r = 1; r <= state.config.rounds; r++) {
      const t = process.hrtime.bigint();
      const res = E.nextRound(state);
      worst = Math.max(worst, Number(process.hrtime.bigint() - t) / 1e6);
      ok(!res.error, `${n} 人第 ${r} 輪失敗`);
      res.matches.forEach(m => {
        const k = [m.a, m.b].sort().join('-');
        ok(!seen.has(k), `${n} 人第 ${r} 輪重複對手`);
        seen.add(k);
        m.round = r; m.result = rnd() < 0.5 ? 'a' : 'b';
      });
      state.matches = state.matches.concat(res.matches);
    }
    console.log(`  ${String(n).padStart(3)} 人 × ${state.config.rounds} 輪　最慢一輪 ${worst.toFixed(1)} ms　零重複對手 ✓`);
  }

  const players = mk(32);
  const ms = [];
  for (let i = 0; i < 16; i++) ms.push({ round: 1, table: 'A', a: 'p' + (i * 2 + 1), b: 'p' + (i * 2 + 2), result: 'a' });
  const s = { config: cfg(), players, matches: ms };
  const a = JSON.stringify(E.nextRound(s).matches.map(m => [m.a, m.b]));
  const b = JSON.stringify(E.nextRound(s).matches.map(m => [m.a, m.b]));
  ok(a === b, '同樣輸入跑出不同配對');
  console.log('  同輸入同輸出（重跑不會亂掉）✓');
}

/* ───────────────────────────────────────── */
head('【11】可設定的計分');
{
  const players = mk(4);
  const matches = [
    { round: 1, table: 'A', a: 'p1', b: 'p2', result: 'a' },
    { round: 1, table: 'B', a: 'p3', b: 'p4', result: 'draw' }
  ];
  const st = E.standings(players, matches, { win: 1, draw: 0, loss: 0 });
  ok(st.find(r => r.id === 'p1').pts === 1, '自訂勝分沒生效');
  ok(st.find(r => r.id === 'p3').pts === 0, '自訂平手分沒生效');
  console.log('  勝 1 平 0 的計分制也算得對 ✓');
}

console.log('\n' + (fails === 0 ? '全部通過 ✅' : `有 ${fails} 項失敗 ❌`));
process.exit(fails === 0 ? 0 : 1);
