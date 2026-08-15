# 連線整合賽事次世代系統

**NICEPLAY** — Networked Integrated Competition & Event Platform for League And Yomi

實體賽事的現場工具。瑞士制配對、即時名次、投影畫面。純前端，離線可用。

**https://niceplay.transtation.org**

---

## 功能

**賽制**

| 賽制 | 說明 |
|---|---|
| 瑞士制 | 同分配同分、不重複對手、輪空自動輪替、退賽不影響他人成績 |
| 單敗淘汰 | 標準交叉種子序，第 1 與第 2 只在決賽相遇；非 2 次方人數自動輪空 |
| 循環賽 | 每人與其他所有人各打一場 |
| 瑞士制 + 淘汰 | 瑞士制跑完取前 N 名接單敗淘汰 |

**計分**

- 勝／平／敗分數可調，預設 3 / 1 / 0，輪空視同勝
- 同分依序比 OMW%（對手勝率平均，每位對手最低 25%）→ OOMW% → 選手編號

**現場**

- 桌號：數字 `1 2 3`、字母 `A B C`、自訂 `Q1 Q2`
- 桌數留白時依人數自動；輪數建議值 `ceil(log2(人數))`
- 每輪倒數，剩 2 分轉金、剩 30 秒轉紅
- 投影模式獨立視窗，字級依桌數自動縮放
- 深色／淺色主題，多視窗同步切換
- 名次表可列印或存 PDF

**多裝置**（選配）

- 六碼房號加入，無需帳號
- 手機回報勝負，電視即時更新
- 主控負責配對與換輪，加入者只能回報
- SSE 推送，斷線退回輪詢，重整自動接回

**資料**

- localStorage 本機儲存，匯出／匯入 JSON
- 同機多視窗經 BroadcastChannel 同步

---

## 快速開始

```bash
git clone https://github.com/akai1030/NICEPLAY.git
cd NICEPLAY
python3 -m http.server 8123
```

開 `http://localhost:8123`。無建置步驟、無相依套件。

---

## 用法

**投影**　按「放大投影 ↗」開新視窗，拖到第二個顯示器，按「全螢幕」。

**手機遙控**　需要房間伺服器。

1. 主控端設定頁填入伺服器位址，按「開房」取得六碼房號
2. 手機開同一網址，填同一伺服器位址，輸入房號加入
3. 手機即可回報勝負

---

## 部署

**前端**　靜態站，指向根目錄。Zeabur 已附 `zbpack.json`，Add Service → Git 選本 repo 即可。Cloudflare Pages / Netlify / GitHub Pages / Vercel 同理。

**房間伺服器**（選配）　Add Service → Git → Root Directory 設為 `server`。

| 環境變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | 8787 | 平臺通常自動帶入 |
| `DATABASE_URL` | — | 未設定則房間存記憶體，重啟清空 |
| `ROOM_TTL_HOURS` | 36 | 逾期未活動的房間自動清除 |

Postgres 資料表首次啟動時自動建立。

---

## 專案結構

```
index.html            外殼
src/engine.js         賽制引擎（純函式，不碰畫面、儲存、網路）
src/store.js          狀態：localStorage + BroadcastChannel
src/net.js            連線層：開房／加入／SSE／輪詢
src/ui.js             介面
src/style.css         視覺（語意 token，深淺兩主題）
sw.js                 Service Worker
server/index.js       房間伺服器（Node 內建 http，Postgres 選配）
```

原生 ES5 + 原生 DOM，無框架。

---

## 引擎單獨使用

```js
const E = require('./src/engine.js');

E.suggestRounds(32);                    // 5
E.makeTables(4, 'letter');              // ['A','B','C','D']
E.standings(players, matches, rules);   // 含 OMW / OOMW 的完整名次
E.nextRound(state);                     // { matches } | { done } | { error }
```

512 人九輪，單輪配對 3.2 ms，零重複對手。

---

## 測試

```bash
node test/engine.test.js    # 引擎 11 組
node server/test.js         # 伺服器 8 組

python3 -m http.server 8123
#  /test/e2e.html                              單機端對端
#  /test/duo.html?srv=http://127.0.0.1:8799    雙裝置端對端
```

---

## 授權

MIT
