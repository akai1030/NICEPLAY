/* NICEPLAY 房間伺服器測試 —— node server/test.js
   會自己起一個伺服器在 8799，跑完關掉。 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const BASE = 'http://127.0.0.1:8799';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const head = t => console.log('\n' + t);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(pathname, opts) {
  const r = await fetch(BASE + pathname, opts);
  let body = null;
  try { body = await r.json(); } catch (e) {}
  return { status: r.status, body };
}
const post = (p, obj) => api(p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj)
});

function sampleState() {
  return {
    v: 1, rev: 0,
    event: { name: '週三夜間賽', date: '2026-08-16' },
    players: [
      { id: 'p1', no: 1, name: '王小明', dropped: false },
      { id: 'p2', no: 2, name: '陳小美', dropped: false },
      { id: 'p3', no: 3, name: '林阿明', dropped: false },
      { id: 'p4', no: 4, name: '李大華', dropped: false }
    ],
    matches: [
      { round: 1, table: '1', a: 'p1', b: 'p2', result: null },
      { round: 1, table: '2', a: 'p3', b: 'p4', result: null }
    ]
  };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: { ...process.env, PORT: '8799', DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stdout.on('data', () => {});
  await sleep(900);

  try {
    head('【1】健康檢查');
    {
      const r = await api('/health');
      ok(r.status === 200 && r.body.ok, '健康檢查沒過');
      ok(r.body.store === 'memory', '應該用記憶體儲存');
      console.log('  伺服器起得來 · 儲存 = ' + r.body.store + ' ✓');
    }

    head('【2】開房');
    let code, hostToken;
    {
      const r = await post('/api/rooms', { state: sampleState() });
      ok(r.status === 200, '開房失敗 ' + r.status);
      code = r.body.code; hostToken = r.body.hostToken;
      ok(/^[23456789A-HJKMNP-Z]{6}$/.test(code), '房號格式不對：' + code);
      ok(!!hostToken && hostToken.length > 20, 'hostToken 太短');
      ok(r.body.rev === 1, 'rev 應該從 1 開始');
      console.log('  房號 ' + code + ' · rev 1 ✓');
    }

    head('【3】另一臺裝置用房號取狀態');
    {
      const r = await api('/api/rooms/' + code);
      ok(r.status === 200, '取不到房間');
      ok(r.body.state.players.length === 4, '選手數不對');
      ok(r.body.state.event.name === '週三夜間賽', '賽事名稱不對');
      const lower = await api('/api/rooms/' + code.toLowerCase());
      ok(lower.status === 200, '房號應該不分大小寫');
      console.log('  加入者拿得到完整狀態 · 房號不分大小寫 ✓');
    }

    head('【4】手機回報勝負');
    {
      const r = await post('/api/rooms/' + code + '/action',
        { op: 'result', round: 1, table: '1', value: 'a' });
      ok(r.status === 200, '回報失敗 ' + r.status);
      ok(r.body.rev === 2, 'rev 沒進位');
      const m = r.body.state.matches.find(x => x.table === '1');
      ok(m.result === 'a', '勝負沒寫進去');
      console.log('  不用 token 就能回報（房號即權限）· rev → 2 ✓');

      const undo = await post('/api/rooms/' + code + '/action',
        { op: 'result', round: 1, table: '1', value: 'a' });
      ok(undo.body.state.matches.find(x => x.table === '1').result === null,
        '點同一邊第二次應該取消');
      console.log('  點同一邊第二次 = 取消回報 ✓');

      const bad = await post('/api/rooms/' + code + '/action',
        { op: 'result', round: 1, table: '99', value: 'a' });
      ok(bad.status === 409, '不存在的桌號應該回 409');
      console.log('  不存在的桌號會被擋 ✓');
    }

    head('【5】只有主控能覆寫整份狀態');
    {
      const st = sampleState();
      st.matches.push({ round: 2, table: '1', a: 'p1', b: 'p3', result: null });

      const no = await post('/api/rooms/' + code + '/state', { hostToken: '亂猜的', state: st });
      ok(no.status === 403, '沒有 token 竟然寫得進去');

      const yes = await post('/api/rooms/' + code + '/state', { hostToken, state: st });
      ok(yes.status === 200, '主控寫入失敗 ' + yes.status);
      const now = await api('/api/rooms/' + code);
      ok(now.body.state.matches.length === 3, '第二輪沒寫進去');
      console.log('  主控寫入成功 · 別人寫被擋 403 ✓');
    }

    head('【6】SSE 即時推送');
    {
      const ctrl = new AbortController();
      const got = [];
      const res = await fetch(BASE + '/api/rooms/' + code + '/stream', { signal: ctrl.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const pump = (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
              const line = chunk.split('\n').find(l => l.startsWith('data: '));
              if (line) got.push(JSON.parse(line.slice(6)));
            }
          }
        } catch (e) {}
      })();

      await sleep(250);
      ok(got.length === 1, '連上時應該先推一次目前狀態，實際 ' + got.length);

      await post('/api/rooms/' + code + '/action',
        { op: 'result', round: 2, table: '1', value: 'b' });
      await sleep(300);
      ok(got.length === 2, '回報之後沒有推送，收到 ' + got.length);
      ok(got[1].state.matches.find(x => x.round === 2).result === 'b', '推的內容不對');
      console.log('  連上先推一次 · 有人回報就即時推給同房所有人 ✓');
      ctrl.abort(); await pump.catch(() => {});
    }

    head('【7】錯誤處理');
    {
      const r1 = await api('/api/rooms/ZZZZZZ');
      ok(r1.status === 404, '不存在的房號應該 404');
      const r2 = await post('/api/rooms', {});
      ok(r2.status === 400, '沒帶 state 應該 400');
      const r3 = await post('/api/rooms/' + code + '/action', { op: '亂七八糟' });
      ok(r3.status === 400, '不支援的操作應該 400');
      console.log('  404 / 400 都正確 ✓');
    }

    head('【8】兩臺裝置同時回報不同桌');
    {
      const st = sampleState();
      st.matches = [
        { round: 1, table: '1', a: 'p1', b: 'p2', result: null },
        { round: 1, table: '2', a: 'p3', b: 'p4', result: null }
      ];
      const room = await post('/api/rooms', { state: st });
      const c = room.body.code;
      const [x, y] = await Promise.all([
        post('/api/rooms/' + c + '/action', { op: 'result', round: 1, table: '1', value: 'a' }),
        post('/api/rooms/' + c + '/action', { op: 'result', round: 1, table: '2', value: 'b' })
      ]);
      ok(x.status === 200 && y.status === 200, '併發回報有失敗的');
      const fin = await api('/api/rooms/' + c);
      const r1 = fin.body.state.matches.find(m => m.table === '1').result;
      const r2 = fin.body.state.matches.find(m => m.table === '2').result;
      ok(r1 === 'a' && r2 === 'b', `兩筆併發被吃掉了：${r1} / ${r2}`);
      console.log('  兩臺同時回報不同桌，兩筆都留住 ✓');
    }

    head('【9】BO 制：副控送整場的小局，伺服器只收不算');
    {
      const st = sampleState();
      st.matches = [{ round: 1, table: '1', a: 'p1', b: 'p2', bo: 3, games: [], result: null }];
      const room = await post('/api/rooms', { state: st });
      const c = room.body.code;

      const one = await post('/api/rooms/' + c + '/action',
        { op: 'match', round: 1, table: '1', games: ['a'], result: null });
      ok(one.status === 200, '第一局應該收得下');
      ok(one.body.state.matches[0].result === null, '一比零還沒分勝負');

      const two = await post('/api/rooms/' + c + '/action',
        { op: 'match', round: 1, table: '1', games: ['a', 'b', 'a'], result: 'a' });
      ok(two.status === 200, '整場結果應該收得下');
      const m = two.body.state.matches[0];
      ok(m.result === 'a', 'result 應該是 a，得到 ' + m.result);
      ok(m.games.join(',') === 'a,b,a', 'games 沒有完整留住：' + JSON.stringify(m.games));

      const back = await post('/api/rooms/' + c + '/action',
        { op: 'match', round: 1, table: '1', games: ['a', 'b'], result: null });
      ok(back.body.state.matches[0].result === null, '退一局之後應該回到未定');
      console.log('  BO3 一局一局送、退一局，伺服器都照收 ✓');
    }

    head('【10】壞掉的小局值要被擋下來');
    {
      const st = sampleState();
      st.matches = [
        { round: 1, table: '1', a: 'p1', b: 'p2', bo: 3, games: [], result: null },
        { round: 1, table: '9', a: 'p3', b: null, bo: 1, games: [], result: 'bye' }
      ];
      const room = await post('/api/rooms', { state: st });
      const c = room.body.code;
      const bad = (body) => post('/api/rooms/' + c + '/action',
        Object.assign({ op: 'match', round: 1, table: '1' }, body));

      ok((await bad({ games: 'aaa', result: 'a' })).status === 409, 'games 不是陣列應該被擋');
      ok((await bad({ games: ['a', 'x'], result: 'a' })).status === 409, '看不懂的小局值應該被擋');
      ok((await bad({ games: ['a'], result: 'win' })).status === 409, '看不懂的 result 應該被擋');
      ok((await bad({ games: new Array(20).fill('a'), result: 'a' })).status === 409,
         '小局數量沒有上限');
      const bye = await post('/api/rooms/' + c + '/action',
        { op: 'match', round: 1, table: '9', games: ['a'], result: 'a' });
      ok(bye.status === 409, '輪空的桌次不該收得下小局');

      const fin = await api('/api/rooms/' + c);
      ok(fin.body.state.matches[0].result === null, '被擋下來的請求不該改到狀態');
      console.log('  格式不對一律 409，狀態不受影響 ✓');
    }

  } finally {
    srv.kill();
  }

  console.log('\n' + (fails === 0 ? '全部通過 ✅' : `有 ${fails} 項失敗 ❌`));
  process.exit(fails === 0 ? 0 : 1);
})();
