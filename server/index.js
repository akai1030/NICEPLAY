/* ============================================================
   NICEPLAY · 房間伺服器
   ------------------------------------------------------------
   讓多臺裝置看同一場比賽。開房會拿到兩組六碼：

     主控房號  店員用。可以回報勝負。
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
function publish(code, payload) {
  const s = subs.get(code);
  if (!s) return;
  const line = 'data: ' + JSON.stringify(payload) + '\n\n';
  for (const res of s) { try { res.write(line); } catch (e) {} }
}

/* ── 把單一操作套進狀態 ────────────────────────────────
   只支援「回報勝負」這一種 —— 那是非主控裝置唯一會做的事。
   其餘（配對、下一輪、改設定）一律由主控端送整份狀態。
   這樣伺服器就不需要懂賽制，賽制永遠只有一份實作。      */
function applyResult(state, action) {
  const round = action.round;
  const table = String(action.table);
  const value = action.value;                    /* 'a' | 'b' | 'draw' | null */
  if (!Array.isArray(state.matches)) return false;
  let hit = false;
  for (const m of state.matches) {
    if (String(m.round) !== String(round) || String(m.table) !== table) continue;
    m.result = (m.result === value) ? null : value;
    hit = true;
    break;
  }
  return hit;
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
          code: code, rev: room.rev, state: room.state, readOnly: !!room.readOnly
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
        res.write('data: ' + JSON.stringify({
          rev: room.rev, state: room.state, readOnly: !!room.readOnly
        }) + '\n\n');
        const off = subscribe(room.code, res);
        /* 心跳：中間有代理時避免連線被當成閒置砍掉 */
        const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
        req.on('close', () => { clearInterval(beat); off(); });
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
        const rev = room.rev + 1;
        await store.put(room.code, body.state, rev);
        publish(room.code, { rev, state: body.state });
        return json(res, 200, { rev });
      }

      /* 任何加入者回報勝負 */
      if (sub === 'action' && req.method === 'POST') {
        if (room.readOnly) return json(res, 403, { error: '這是選手查詢碼，只能看不能改' });
        const body = await readBody(req, 64 * 1024);
        if (body.op !== 'result') return json(res, 400, { error: '不支援的操作' });
        const state = room.state;
        if (!applyResult(state, body)) {
          return json(res, 409, { error: '找不到那一桌', rev: room.rev, state });
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
