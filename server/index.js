/* ============================================================
   NICEPLAY · 房間伺服器
   ------------------------------------------------------------
   讓多臺裝置看同一場比賽。開房會拿到兩組六碼：

     主控房號  副控用。可以回報勝負。
     觀眾碼    選手用。只能看，伺服器會擋掉所有寫入。

   兩組都不用註冊、不用帳號 —— 碼即權限，像會議室連結。
   唯讀是在伺服器擋的，不是只把按鈕藏起來。

   設計沿用 2026-08-15 臺東卡牌大賽現場驗證過的那一套：

     · 伺服器只保管「整份狀態」，不懂賽制、不算配對。
       配對與名次仍然在瀏覽器算，這裡只是共用的白板。
     · 傳整份快照而不是差異 —— 漏一次不會永遠歪掉，
       下一次就對回來，系統沒有「同步失敗」這個狀態。
     · SSE 即時推送，另外保留輪詢當備援。斷線重連是免費的。

   資料庫是選配：有 DATABASE_URL 就寫 Postgres，沒有就放記憶體
   （本機開發、或別人 clone 下來自己跑，都不必先架資料庫）。
   ============================================================ */
'use strict';

const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT, 10) || 8787;
const ROOM_TTL_HOURS = parseInt(process.env.ROOM_TTL_HOURS, 10) || 36;
const MAX_STATE_BYTES = parseInt(process.env.MAX_STATE_BYTES, 10) || 2 * 1024 * 1024;

/* 房號用不會看錯的字母數字：拿掉 0/O/1/I/L，唸給人聽不會錯 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function roomCode() {
  const b = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}
function token() { return crypto.randomBytes(24).toString('base64url'); }

/* ── 儲存層 ────────────────────────────────────────────
   兩種實作、同一組介面。沒有資料庫也跑得起來。        */
let store;

async function makeStore() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('  沒有 DATABASE_URL —— 房間放記憶體（重啟會清空）');
    return memoryStore();
  }
  let Pool;
  try { ({ Pool } = require('pg')); }
  catch (e) {
    console.log('  找不到 pg 套件 —— 房間放記憶體');
    return memoryStore();
  }
  const pool = new Pool({
    connectionString: url,
    ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
    max: 5
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      code       TEXT PRIMARY KEY,
      view_code  TEXT UNIQUE,
      host_token TEXT NOT NULL,
      state      JSONB NOT NULL,
      rev        INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query('ALTER TABLE rooms ADD COLUMN IF NOT EXISTS view_code TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS rooms_updated ON rooms (updated_at)');
  await pool.query('CREATE INDEX IF NOT EXISTS rooms_view ON rooms (view_code)');
  console.log('  已連上 Postgres');

  return {
    kind: 'postgres',
    async create(code, viewCode, hostTok, state) {
      await pool.query(
        'INSERT INTO rooms (code, view_code, host_token, state, rev) VALUES ($1,$2,$3,$4,1)',
        [code, viewCode, hostTok, state]);
      return { code, viewCode, rev: 1 };
    },
    async get(code) {
      const r = await pool.query(
        'SELECT code, view_code, host_token, state, rev FROM rooms WHERE code = $1 OR view_code = $1',
        [code]);
      if (!r.rows.length) return null;
      const x = r.rows[0];
      return { code: x.code, viewCode: x.view_code, hostToken: x.host_token,
               state: x.state, rev: x.rev, readOnly: x.view_code === code };
    },
    async put(code, state, rev) {
      await pool.query(
        'UPDATE rooms SET state = $2, rev = $3, updated_at = now() WHERE code = $1',
        [code, state, rev]);
    },
    async sweep() {
      const r = await pool.query(
        `DELETE FROM rooms WHERE updated_at < now() - interval '${ROOM_TTL_HOURS} hours'`);
      return r.rowCount || 0;
    },
    async count() {
      const r = await pool.query('SELECT count(*)::int AS n FROM rooms');
      return r.rows[0].n;
    }
  };
}

function memoryStore() {
  const m = new Map();
  return {
    kind: 'memory',
    async create(code, viewCode, hostTok, state) {
      m.set(code, { code, viewCode, hostToken: hostTok, state, rev: 1, updatedAt: Date.now() });
      return { code, viewCode, rev: 1 };
    },
    async get(code) {
      const direct = m.get(code);
      if (direct) return Object.assign({}, direct, { readOnly: false });
      for (const v of m.values()) {
        if (v.viewCode === code) return Object.assign({}, v, { readOnly: true });
      }
      return null;
    },
    async put(code, state, rev) {
      const r = m.get(code);
      if (r) { r.state = state; r.rev = rev; r.updatedAt = Date.now(); }
    },
    async sweep() {
      const cutoff = Date.now() - ROOM_TTL_HOURS * 3600e3;
      let n = 0;
      for (const [k, v] of m) if (v.updatedAt < cutoff) { m.delete(k); n++; }
      return n;
    },
    async count() { return m.size; }
  };
}

/* ── SSE 訂閱者 ────────────────────────────────────────
   code → Set<res>。有人寫入就把整份新狀態推給同房的人。 */
const subs = new Map();

function subscribe(code, res) {
  if (!subs.has(code)) subs.set(code, new Set());
  subs.get(code).add(res);
  return () => {
    const s = subs.get(code);
    if (!s) return;
    s.delete(res);
    if (!s.size) subs.delete(code);
  };
}
function clientCount(code) {
  const s = subs.get(code);
  return s ? s.size : 0;
}
function publish(code, payload) {
  const s = subs.get(code);
  if (!s) return;
  const line = 'data: ' + JSON.stringify(
    Object.assign({ clients: s.size }, payload)) + '\n\n';
  for (const res of s) { try { res.write(line); } catch (e) {} }
}
/* 有人接上或斷線就通知同房的其他人 ——
   主控在意的是「副控還在不在」，而那件事不會有狀態變動來帶出。

   剛連上的那一臺不通知：它的初始封包裡已經有 clients 了，
   再推一次只是多一則沒有內容的訊息。 */
function publishPresence(code, except) {
  const s = subs.get(code);
  if (!s) return;
  const line = 'data: ' + JSON.stringify({ presence: true, clients: s.size }) + '\n\n';
  for (const res of s) {
    if (res === except) continue;
    try { res.write(line); } catch (e) {}
  }
}

/* ── 把單一操作套進狀態 ────────────────────────────────
   只支援「回報勝負」這一種 —— 那是非主控裝置唯一會做的事。
   其餘（配對、下一輪、改設定）一律由主控端送整份狀態。
   這樣伺服器就不需要懂賽制，賽制永遠只有一份實作。      */
function findMatch(state, round, table) {
  if (!Array.isArray(state.matches)) return null;
  const t = String(table);
  for (const m of state.matches) {
    if (String(m.round) === String(round) && String(m.table) === t) return m;
  }
  return null;
}

/* 一勝制的老路：點同一邊＝取消，點另一邊＝改判 */
function applyResult(state, action) {
  const m = findMatch(state, action.round, action.table);
  if (!m) return false;
  const value = action.value;                    /* 'a' | 'b' | 'draw' | null */
  m.result = (m.result === value) ? null : value;
  m.games = (m.result && m.result !== 'bye') ? [m.result] : [];
  return true;
}

/* BO 制：小局怎麼推出整場勝負，規則只有 src/engine.js 一份。
   這裡不重算，只收下副控算好的結果 ——
   server/ 是獨立部署的 Root Directory，require('../src/engine.js') 會找不到檔案，
   照抄一份到這裡就等於同一條規則有兩個實作，遲早會分岔。

   把關的是「格式」而不是「賽制」：小局只能是那三個值、長度有上限、
   結果只能是那四種。權限本來就是「碼即權限」，這裡不多做假設。 */
const GAME_VALUES = ['a', 'b', 'draw'];
const RESULT_VALUES = [null, 'a', 'b', 'draw'];
const MAX_GAMES = 9;

function applyMatch(state, action) {
  const m = findMatch(state, action.round, action.table);
  if (!m) return false;
  if (m.b === null || m.b === undefined) return false;   /* 輪空沒有小局 */
  const games = action.games;
  if (!Array.isArray(games) || games.length > MAX_GAMES) return false;
  if (!games.every(g => GAME_VALUES.indexOf(g) >= 0)) return false;
  const result = (action.result === undefined) ? null : action.result;
  if (RESULT_VALUES.indexOf(result) < 0) return false;
  m.games = games.slice();
  m.result = result;
  return true;
}

/* ── HTTP ──────────────────────────────────────────── */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  cors(res);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  try {
    if (path === '/' || path === '/health') {
      return json(res, 200, {
        ok: true, service: 'niceplay-rooms',
        store: store.kind, rooms: await store.count(), ttlHours: ROOM_TTL_HOURS
      });
    }

    /* 開房 */
    if (path === '/api/rooms' && req.method === 'POST') {
      const body = await readBody(req, MAX_STATE_BYTES);
      if (!body.state || typeof body.state !== 'object') {
        return json(res, 400, { error: '缺少 state' });
      }
      let code = roomCode(), tries = 0;
      while (await store.get(code)) { code = roomCode(); if (++tries > 8) break; }
      let viewCode = roomCode(), t2 = 0;
      while (viewCode === code || await store.get(viewCode)) {
        viewCode = roomCode(); if (++t2 > 8) break;
      }
      const hostTok = token();
      await store.create(code, viewCode, hostTok, body.state);
      return json(res, 200, { code, viewCode, hostToken: hostTok, rev: 1 });
    }

    const m = path.match(/^\/api\/rooms\/([A-Za-z0-9]{4,12})(\/(state|action|stream))?$/);
    if (m) {
      const code = m[1].toUpperCase();
      const sub = m[3];
      const room = await store.get(code);
      if (!room) return json(res, 404, { error: '找不到這個房號' });

      /* 取狀態（輪詢用） */
      if (!sub && req.method === 'GET') {
        return json(res, 200, {
          code: code, rev: room.rev, state: room.state, readOnly: !!room.readOnly,
          clients: clientCount(room.code)
        });
      }

      /* 即時推送 */
      if (sub === 'stream' && req.method === 'GET') {
        cors(res);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        res.write('retry: 3000\n\n');
        const off = subscribe(room.code, res);
        res.write('data: ' + JSON.stringify({
          rev: room.rev, state: room.state, readOnly: !!room.readOnly,
          clients: clientCount(room.code)
        }) + '\n\n');
        publishPresence(room.code, res);         /* 通知同房其他人：有人接上了 */
        /* 心跳：中間有代理時避免連線被當成閒置砍掉 */
        const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
        req.on('close', () => {
          clearInterval(beat); off();
          publishPresence(room.code);            /* 通知同房：有人離開了 */
        });
        return;
      }

      /* 主控端寫入整份狀態 */
      if (sub === 'state' && req.method === 'POST') {
        if (room.readOnly) return json(res, 403, { error: '這是選手查詢碼，只能看不能改' });
        const body = await readBody(req, MAX_STATE_BYTES);
        if (body.hostToken !== room.hostToken) {
          return json(res, 403, { error: '只有開房的那臺可以覆寫整份狀態' });
        }
        if (!body.state || typeof body.state !== 'object') {
          return json(res, 400, { error: '缺少 state' });
        }
        /* 樂觀鎖。主控說「我是根據第 N 版改的」，而現在已經是第 N+1 版 ——
           代表這中間有人回報了一桌，直接蓋下去那一筆就沒了。
           退回現況讓主控合併再推一次；合併規則在 engine.js，這裡不碰。
           沒帶 baseRev 的是舊版前端，照舊直接覆寫，不要把人擋在門外。 */
        if (body.baseRev !== undefined && body.baseRev !== null
            && body.baseRev !== room.rev) {
          return json(res, 409, {
            error: '這中間有人回報過，請合併後再送', stale: true,
            rev: room.rev, state: room.state
          });
        }
        const rev = room.rev + 1;
        await store.put(room.code, body.state, rev);
        publish(room.code, { rev, state: body.state });
        return json(res, 200, { rev });
      }

      /* 任何加入者回報勝負 */
      if (sub === 'action' && req.method === 'POST') {
        if (room.readOnly) return json(res, 403, { error: '這是選手查詢碼，只能看不能改' });
        const body = await readBody(req, 64 * 1024);
        const state = room.state;
        let done;
        if (body.op === 'match') done = applyMatch(state, body);
        else if (body.op === 'result') done = applyResult(state, body);
        else return json(res, 400, { error: '不支援的操作' });
        if (!done) {
          return json(res, 409, { error: '找不到那一桌，或小局格式不對', rev: room.rev, state });
        }
        const rev = room.rev + 1;
        await store.put(room.code, state, rev);
        publish(room.code, { rev, state });
        return json(res, 200, { rev, state });
      }
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    const msg = String(e && e.message || e);
    return json(res, msg === 'too large' ? 413 : 500, { error: msg });
  }
});

/* ── 啟動 ──────────────────────────────────────────── */
(async () => {
  console.log('');
  console.log('  NICEPLAY · 房間伺服器');
  console.log('  ' + '-'.repeat(46));
  store = await makeStore();

  setInterval(async () => {
    try {
      const n = await store.sweep();
      if (n) console.log(`  清掉 ${n} 個超過 ${ROOM_TTL_HOURS} 小時沒動的房間`);
    } catch (e) { console.log('  清房失敗：' + e.message); }
  }, 30 * 60 * 1000);

  server.listen(PORT, () => {
    console.log(`  聽在 :${PORT}　房間保留 ${ROOM_TTL_HOURS} 小時`);
    console.log('');
  });
})();
