# 連線整合賽事次世代系統

**NICEPLAY** — Networked Integrated Competition & Event Platform for League And You

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

**幾勝制**

- 常規賽與淘汰賽分開設 —— 現場最常見的是瑞士制 BO1 控時間，切進淘汰賽改 BO3
- BO1 / BO2 / BO3 / BO5；先過半就拿下，打滿沒過半算平手（BO2 的 1-1、BO3 的 1-1-1）
- 幾勝制在場次排出來的當下就蓋上去，中途改設定不會追溯改寫已打完的輪次
- 小局只是紀錄。整場的勝負仍然只寫在 `m.result`，積分／OMW／配對／晉級全部只讀它

**計分**

- 勝／平／敗分數可調，預設 3 / 1 / 0，輪空視同勝
- 同分依序比 OMW%（對手勝率平均，每位對手最低 25%）→ OOMW% → 選手編號

**現場**

- 左下角內建使用手冊，十一個步驟，可列印貼在櫃檯
- 桌號：數字 `1 2 3`、字母 `A B C`、自訂 `Q1 Q2`
- 桌數留白時依人數自動；輪數建議值 `ceil(log2(人數))`
- 每輪倒數，剩 2 分轉金、剩 30 秒轉紅
- 投影模式獨立視窗，字級依桌數自動縮放
- 深色／淺色主題，多視窗同步切換
- 名次表可列印或存 PDF

**多裝置**（選配）

無需帳號。開房後產生兩條給人的東西，兩種人各走各的畫面：

| | 拿到什麼 | 看到什麼 |
|---|---|---|
| 副控 | 網址 `#sub` ＋ 六碼密碼 | 只有密碼框；進去後只有對戰頁，可回報勝負 |
| 選手 | 投影畫面右下角的 QR（或 `#join=<碼>` 連結） | 專屬唯讀畫面：我在第幾桌、對手是誰、目前第幾名 |

- 密碼不寫在副控網址裡 —— 網址會被轉傳，密碼才是權限
- 選手唯讀由伺服器強制，繞過前端直接打 API 一樣回 403
- 自架伺服器時，連結會自動帶上 `&srv=`，對方不必設定
- 主控負責配對與換輪，加入者只能回報
- SSE 推送，斷線退回輪詢，重整自動接回
- QR 由 `src/qr.js` 自己畫，不連任何外部服務
- 身分存在 `sessionStorage`（每個分頁一份），同一臺電腦可以同時開主控與副控
- 投影視窗不連線，狀態走 BroadcastChannel —— 避免兩個視窗都以為自己是主控

**資料**

- localStorage 本機儲存，匯出／匯入 JSON
- 同機多視窗經 BroadcastChannel 同步
- 存檔帶的是賽況，不含主控權限（`hostToken` 只在原本那臺的 sessionStorage）——
  換電腦匯入之後要重新開房，副控密碼與選手 QR 一併重發

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

**手機遙控**　伺服器位址已預設好，設定頁按「開房，產生連結」即可。

1. 給副控：按「複製網址」與「複製密碼」，兩個都傳給他
2. 給選手：投影畫面右下角就有 QR，或按「放大 QR 給全場掃」

自架伺服器改 `src/ui.js` 的 `DEFAULT_SERVER`，或在設定頁「進階」裡改（記在瀏覽器裡）。

---

## 部署

**前端**　靜態站，指向根目錄。Zeabur 已附 `zbpack.json`，Add Service → Git 選本 repo 即可。Cloudflare Pages / Netlify / GitHub Pages / Vercel 同理。

改完前端、推上去之前先跑 `sh tools/test.sh` 再跑 `tools/stamp.sh`。CDN 會把 `.css` / `.js` 快取數小時而 `index.html` 每次回源，不蓋版本章的話使用者會拿到新 HTML 配舊 CSS。Service Worker 的註冊網址也一併蓋 —— 那支檔案只認註冊時的網址，沒帶版本就得等快取自己過期。

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
index.html            外殼 + 使用手冊 + 副控／選手畫面
src/engine.js         賽制引擎（純函式，不碰畫面、儲存、網路）
src/qr.js             QR 產生器（零相依，不連外部服務）
src/store.js          狀態：localStorage + BroadcastChannel
src/net.js            連線層：開房／加入／SSE／輪詢
src/ui.js             介面
src/style.css         視覺（語意 token，深淺兩主題）
assets/               品牌素材，深淺各一版
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

E.winsNeeded(3);                        // 2
E.matchResult(['a','b','a'], 3);        // 'a'
E.matchResult(['a','b'], 2);            // 'draw'
E.playGame(match, 'a');                 // { games, result } | null（這一下沒有作用）
```

512 人九輪，單輪配對 3.2 ms，零重複對手。

---

## 測試

```bash
sh tools/test.sh            # 一次跑完下面五組

node test/engine.test.js    # 引擎 11 組　　賽制算得對不對
node test/bo.test.js        # 幾勝制 12 組　含「小局不影響名次」那條界線
node server/test.js         # 伺服器 10 組　HTTP 行為與權限
node test/net.test.js       # 連線層 4 組　　拿真的 net.js 對真的伺服器跑
node test/check.js          # 靜態 10 組　　標籤閉合、id、版本章、字級規範

python3 -m http.server 8123
#  /test/e2e.html                                單機端對端
#  /test/duo.html?srv=http://127.0.0.1:8799      雙裝置端對端
#  /test/watch.html?srv=http://127.0.0.1:8799    副控／選手分流
#  /test/shot.html?theme=light&view=book         視覺檢查（截圖用）
```

---

## 品牌

| | |
|---|---|
| 電光藍 | `#2563FF` |
| 霓虹紫 | `#A855F7` |
| 桃紅 | `#FF2ED1` |
| 碳黑 | `#0B0D12` |
| 石墨 | `#13161D` |

主漸層 藍 → 紫 → 桃紅。素材深淺各一版，`assets/*-light.png` 供淺色主題使用。

---

## 授權

MIT
