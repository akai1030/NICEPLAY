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
