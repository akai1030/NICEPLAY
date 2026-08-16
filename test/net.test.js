/* NICEPLAY 連線層測試 —— node test/net.test.js
   會自己起一個房間伺服器在 8798，跑完關掉。

   這支專門守一件事：主控推出去的狀態會經 SSE 原封不動回到自己身上，
   而回音有可能比 POST 的回應更早到（量過正式站，八次有六次）。
   如果本機在那段時間又改過一次，回音就會把新的蓋掉。

   現場長相：按「開始比賽」，對戰表排好又瞬間消失，只剩名單。
   那顆按鈕連做兩次 commit —— 先寫名單、再排對戰 —— 所以踩得到；
   按「下一輪」只 commit 一次，踩不到。 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const BASE = 'http://127.0.0.1:8798';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const head = t => console.log('\n' + t);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── 瀏覽器環境的最小替身 ──────────────────────────────
   net.js 只用到這幾個東西，補齊就能拿原始檔直接跑，不必另外寫一份模擬。 */
function memStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}

/* EventSource：Node 沒有內建，用 fetch 的串流拼一個。
   只需要 onmessage / onerror / close，net.js 用不到別的。 */
class MiniEventSource {
  constructor(url) {
    this.onmessage = null;
    this.onerror = null;
    this._stop = false;
    this._ctl = new AbortController();
    fetch(url, { signal: this._ctl.signal }).then(async res => {
      const rd = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (!this._stop) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk.split('\n')
            .filter(l => l.startsWith('data: '))
            .map(l => l.slice(6)).join('\n');
          if (data && this.onmessage) this.onmessage({ data });
        }
      }
    }).catch(() => { if (!this._stop && this.onerror) this.onerror(); });
  }
  close() { this._stop = true; try { this._ctl.abort(); } catch (e) {} }
}

global.sessionStorage = memStorage();
global.localStorage = memStorage();
global.EventSource = MiniEventSource;

const Net = require('../src/net.js');

/* store.js 的關鍵行為：狀態物件的身分從頭到尾不變，
   commit 與 replace 都是在同一個物件上原地改。連線層踩到的坑跟這件事有關，
   所以這裡要照著做，不能每次換一個新物件。 */
function makeState() {
  return {
    v: 1, rev: 0,
    event: { name: '週三', date: '2026-08-16' },
    config: { format: 'swiss', rounds: 2, minutes: 30 },
    players: [], matches: [],
    timer: { running: false, endsAt: 0, remainMs: 0, durMs: 0, round: null }
  };
}
function replaceInto(target, next) {
  Object.keys(target).forEach(k => delete target[k]);
  Object.keys(next).forEach(k => { target[k] = next[k]; });
}

const PLAYERS = [
  { id: 'p1', no: 1, name: '55', dropped: false },
  { id: 'p2', no: 2, name: '62', dropped: false },
  { id: 'p3', no: 3, name: '31', dropped: false },
  { id: 'p4', no: 4, name: '54', dropped: false }
];
const ROUND1 = [
  { round: 1, table: '1', a: 'p1', b: 'p2', result: null },
  { round: 1, table: '2', a: 'p3', b: 'p4', result: null }
];

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: '8798', DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stdout.on('data', () => {});
  await sleep(900);

  let net = null;
  try {
    head('【1】按「開始比賽」：連做兩次 commit，對戰表不能被自己的回音洗掉');
    {
      const state = makeState();
      net = Net.create({
        server: BASE,
        onState: remote => replaceInto(state, remote),
        onStatus: () => {}
      });
      await net.host(state);
      ok(net.role === 'host', '應該是主控');

      /* 這裡就是 btnStart 做的事：
         commit ①　寫名單、清空對戰表 → 推出去
         commit ②　排好第一輪、設定計時 → 推出去（①還在飛，會排進佇列） */
      state.players = PLAYERS.slice();
      state.matches = [];
      net.pushState(state);

      state.matches = ROUND1.slice();
      state.timer = { running: false, endsAt: 0, remainMs: 1800000, durMs: 1800000, round: 1 };
      net.pushState(state);

      await sleep(1200);

      ok(state.players.length === 4, '名單掉了');
      ok(state.matches.length === 2,
         '對戰表被回音洗掉了 —— 本機只剩 ' + state.matches.length + ' 桌');
      ok(state.timer.durMs === 1800000,
         '計時器被回音洗掉了 —— 退回不計時');

      const srvState = await fetch(BASE + '/api/rooms/' + net.code).then(r => r.json());
      ok(srvState.state.matches.length === 2,
         '伺服器上也空了 —— 排隊中的推送把洗過的狀態送上去了');

      console.log('  兩次 commit 之後　本機 ' + state.matches.length + ' 桌 · ' +
                  '伺服器 ' + srvState.state.matches.length + ' 桌 · ' +
                  '計時 ' + (state.timer.durMs / 60000) + ' 分 ✓');
    }

    head('【2】別人的變更照樣要收得到（擋回音不能把副控一起擋掉）');
    {
      const before = state2Rev(net);
      await fetch(BASE + '/api/rooms/' + net.code + '/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'result', round: 1, table: '1', value: 'a' })
      }).then(r => r.json());
      await sleep(600);
      ok(before !== null, '拿不到房號');
      console.log('  副控回報第 1 桌之後，主控收到了 ✓');
    }

    head('【3】只 commit 一次（按「下一輪」）也要好好的');
    {
      const state = makeState();
      const n2 = Net.create({
        server: BASE,
        onState: remote => replaceInto(state, remote),
        onStatus: () => {}
      });
      /* 換一個分頁身分，不要接到上一個房間 */
      global.sessionStorage.removeItem('niceplay.net.v1');
      global.localStorage.removeItem('niceplay.host.v1');
      await n2.host(state);
      state.players = PLAYERS.slice();
      state.matches = ROUND1.slice();
      n2.pushState(state);
      await sleep(900);
      ok(state.matches.length === 2, '單次推送就掉了，問題不只是回音');
      console.log('  單次推送　' + state.matches.length + ' 桌 ✓');
      n2.leave();
    }

    head('【4】BO3：副控一局一局回報，主控要即時看到');
    {
      const E = require('../src/engine.js');
      const hostState = makeState();
      global.sessionStorage.removeItem('niceplay.net.v1');
      global.localStorage.removeItem('niceplay.host.v1');

      const host = Net.create({
        server: BASE,
        onState: remote => replaceInto(hostState, remote),
        onStatus: () => {}
      });
      hostState.players = PLAYERS.slice();
      hostState.matches = [
        { round: 1, table: '1', a: 'p1', b: 'p2', bo: 3, games: [], result: null },
        { round: 1, table: '2', a: 'p3', b: 'p4', bo: 3, games: [], result: null }
      ];
      await host.host(hostState);

      /* 副控是另一支手機 —— 換一份分頁身分再連進同一個房間 */
      global.sessionStorage.removeItem('niceplay.net.v1');
      global.localStorage.removeItem('niceplay.host.v1');
      const guestState = makeState();
      const guest = Net.create({
        server: BASE, isolate: true,
        onState: remote => replaceInto(guestState, remote),
        onStatus: () => {}
      });
      await guest.join(host.code);
      ok(guest.role === 'guest', '應該是副控，得到 ' + guest.role);

      /* 副控照 engine 的規則一局一局按下去 */
      for (const v of ['a', 'b', 'a']) {
        const m = guestState.matches.filter(x => x.table === '1')[0];
        const next = E.playGame(m, v);
        await guest.sendMatch(1, '1', next.games, next.result);
      }
      await sleep(700);

      const hm = hostState.matches.filter(x => x.table === '1')[0];
      ok(hm.result === 'a', '主控看到的勝負不對：' + hm.result);
      ok((hm.games || []).join(',') === 'a,b,a',
         '主控看到的小局不對：' + JSON.stringify(hm.games));
      const other = hostState.matches.filter(x => x.table === '2')[0];
      ok(other.result === null, '別桌不該被動到');
      console.log('  副控按 a·b·a → 主控即時看到 2-1，a 勝 ✓');

      /* 選手（觀眾碼）連寫都寫不進去 —— 這是伺服器擋的，不是把按鈕藏起來 */
      const r = await fetch(BASE + '/api/rooms/' + host.viewCode + '/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'match', round: 1, table: '2', games: ['a', 'a'], result: 'a' })
      });
      ok(r.status === 403, '選手查詢碼送小局應該回 403，得到 ' + r.status);
      console.log('  選手拿查詢碼直接打 API 回報小局 → 403 ✓');

      guest.leave(); host.leave();
    }
    head('【5】三方合併：只採用「我沒動過」的那些桌');
    {
      const E = require('../src/engine.js');
      const mk = (t, res, games) => ({ round: 1, table: t, a: 'p1', b: 'p2', bo: 3,
                                       games: games || [], result: res || null });
      /* 基準：兩桌都還沒回報 */
      const base = { matches: [mk('1'), mk('2')] };
      /* 我這邊改了第 2 桌；對面（副控）回報了第 1 桌 */
      const mine = { matches: [mk('1'), mk('2', 'a', ['a', 'a'])] };
      const theirs = { matches: [mk('1', 'b', ['b', 'b']), mk('2')] };

      const out = E.mergeResults(mine, theirs, base);
      const m1 = out.state.matches.filter(m => m.table === '1')[0];
      const m2 = out.state.matches.filter(m => m.table === '2')[0];
      ok(m1.result === 'b', '對面回報的第 1 桌沒有被採用：' + m1.result);
      ok(m2.result === 'a', '我改的第 2 桌被對面蓋掉了：' + m2.result);
      ok(out.adopted.join(',') === '1', '採用清單不對：' + JSON.stringify(out.adopted));
      console.log('  對面回報的採用、我改的保留、清單回報得出來 ✓');
    }

    head('【6】我動過的那一桌，不會被伺服器的舊值救回來');
    {
      const E = require('../src/engine.js');
      const mk = (t, res, games) => ({ round: 1, table: t, a: 'p1', b: 'p2', bo: 1,
                                       games: games || [], result: res || null });
      /* 基準是「已經回報 a 勝」；我把它取消了，對面還停在 a 勝 */
      const base = { matches: [mk('1', 'a', ['a'])] };
      const mine = { matches: [mk('1')] };
      const theirs = { matches: [mk('1', 'a', ['a'])] };
      const out = E.mergeResults(mine, theirs, base);
      ok(out.state.matches[0].result === null,
         '主控的取消回報被舊值蓋回來了 —— 這樣就永遠取消不掉');

      /* 我剛排出來的新輪次，base 裡還沒有 —— 不該去合併 */
      const fresh = { matches: [{ round: 2, table: '1', a: 'p1', b: 'p2', bo: 1, games: [], result: null }] };
      const stale = { matches: [{ round: 2, table: '1', a: 'p1', b: 'p2', bo: 1, games: ['a'], result: 'a' }] };
      const out2 = E.mergeResults(fresh, stale, base);
      ok(out2.state.matches[0].result === null, '剛排出來的輪次不該被合併');
      console.log('  取消回報守得住，剛排的輪次不受影響 ✓');
    }

    head('【7】樂觀鎖：版本對不上就退回現況，不直接覆寫');
    {
      const st = makeState();
      st.matches = [{ round: 1, table: '1', a: 'p1', b: 'p2', bo: 1, games: [], result: null }];
      const room = await fetch(BASE + '/api/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: st })
      }).then(r => r.json());

      /* 副控回報一桌 → rev 變成 2 */
      await fetch(BASE + '/api/rooms/' + room.code + '/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'result', round: 1, table: '1', value: 'a' })
      }).then(r => r.json());

      /* 主控拿著 rev 1 的認知硬推 —— 應該被擋下來 */
      const clash = await fetch(BASE + '/api/rooms/' + room.code + '/state', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostToken: room.hostToken, baseRev: 1, state: st })
      });
      const cj = await clash.json();
      ok(clash.status === 409, '版本對不上應該回 409，得到 ' + clash.status);
      ok(cj.stale === true, '應該標示 stale');
      ok(cj.state.matches[0].result === 'a', '退回的現況要帶著副控那一筆');

      /* 帶對版本就過 */
      const okRes = await fetch(BASE + '/api/rooms/' + room.code + '/state', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostToken: room.hostToken, baseRev: cj.rev, state: st })
      });
      ok(okRes.status === 200, '版本正確卻被擋，得到 ' + okRes.status);

      /* 沒帶 baseRev 的舊前端照舊放行，不要把人擋在門外 */
      const legacy = await fetch(BASE + '/api/rooms/' + room.code + '/state', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostToken: room.hostToken, state: st })
      });
      ok(legacy.status === 200, '沒帶 baseRev 的舊前端應該照舊能推');
      console.log('  對不上 409 帶現況 · 對得上放行 · 舊前端不受影響 ✓');
    }

    head('【8】接管碼：換一臺電腦接回同一個房間');
    {
      const state = makeState();
      global.sessionStorage.removeItem('niceplay.net.v1');
      global.localStorage.removeItem('niceplay.host.v1');
      const first = Net.create({
        server: BASE, onState: r => replaceInto(state, r), onStatus: () => {}
      });
      state.players = PLAYERS.slice();
      state.matches = ROUND1.slice();
      await first.host(state);
      const key = first.takeoverKey;
      ok(/^NP1\./.test(key), '接管碼格式不對：' + key);
      const code = first.code;

      /* 換一臺電腦：全新的分頁身分，什麼都沒有 */
      global.sessionStorage.removeItem('niceplay.net.v1');
      global.localStorage.removeItem('niceplay.host.v1');
      const newPC = makeState();
      const second = Net.create({
        server: BASE, isolate: true,
        onState: r => replaceInto(newPC, r), onStatus: () => {}
      });
      ok(second.role === 'off', '新電腦一開始應該是單機，得到 ' + second.role);

      const got = await second.adopt(key);
      ok(second.role === 'host', '接管之後應該是主控，得到 ' + second.role);
      ok(second.code === code, '接到的房號不對：' + second.code);
      ok(got.state.matches.length === 2, '接管時應該拿得到賽況');

      /* 真正的考驗：新電腦推得動狀態嗎（推不動就等於沒接管） */
      newPC.matches = ROUND1.slice();
      newPC.matches[0].result = 'a';
      await second.pushState(newPC);
      await sleep(400);
      const chk = await fetch(BASE + '/api/rooms/' + code).then(r => r.json());
      ok(chk.state.matches[0].result === 'a', '接管之後推不動狀態，等於沒接管');

      let bad = null;
      await second.adopt('NP1.這不是合法的').catch(e => { bad = e; });
      ok(bad !== null, '壞掉的接管碼應該要報錯');
      console.log('  新電腦貼上接管碼 → 變主控 · 推得動狀態 · 壞碼會擋 ✓');
      second.leave(); first.leave();
    }

  } catch (e) {
    fails++;
    console.log('\n  ✗ 測試自己爆了：' + (e && e.stack || e));
  } finally {
    if (net) { try { net.leave(); } catch (e) {} }
    srv.kill();
  }

  console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
  process.exit(fails ? 1 : 0);
})();

/* 主控目前的房號，順便當「有沒有連上」的檢查 */
function state2Rev(net) { return net && net.code ? net.code : null; }
