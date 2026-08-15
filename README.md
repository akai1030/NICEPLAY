# NICEPLAY

**Networked Integrated Competition & Event Platform for League And Yomi**
連線整合賽事次世代系統

一臺筆電就能辦一場比賽。打開網址、貼上名單、按開始 —— **全程不需要網路、不需要帳號、不需要安裝。**

---

## 這是什麼

實體賽事的現場工具。瑞士制配對、即時名次、投影畫面，三件事一次解決。

從實戰長出來的：2026-08-15 臺東卡牌大賽・寶可夢道館賽，32 位選手、五輪瑞士制加八強單敗淘汰，
87 場全程用前身系統跑完。NICEPLAY 是把那套東西一般化、去掉伺服器之後的版本。

## 為什麼不是雲端

因為場館的網路不能信。

比賽進行中的一切都在你的瀏覽器裡 —— 名單、配對、勝負、名次。
路由器重開、Wi-Fi 掛掉、手機切飛航，比賽照跑。第一次打開之後就連伺服器都不需要了。

---

## 功能

**賽制**
- 瑞士制 —— 同分打同分、不重複對手、輪空自動輪替、退賽不影響別人成績
- 單敗淘汰 —— 標準交叉種子序，第 1 與第 2 只會在決賽相遇
- 循環賽 —— 每個人都跟其他所有人打一場
- 瑞士制打完可以直接接前 N 強淘汰賽

**計分**
- 勝／平／敗分數可調（預設 3 / 1 / 0），輪空視同勝
- 同分依序比 **OMW%**（對手勝率平均，每位對手最低以 25% 計）→ **OOMW%** → 選手編號
- 這是寶可夢 / MTG 通用的官方算法

**現場**
- 桌號可設定：數字 `1 2 3`、字母 `A B C`、或自訂 `Q1 Q2 Q3`
- 每輪倒數計時，剩 2 分變金色、剩 30 秒變紅色
- **投影模式**：按「放大投影」全螢幕，字級依桌數自動縮放，Esc 離開
- 排名表可直接列印或存成 PDF

**資料**
- 存在瀏覽器本機，關掉再開還在
- 匯出／匯入 JSON 存檔
- 多視窗自動同步（控制視窗留在筆電、投影視窗拖到電視）

---

## 怎麼用

### 直接用

打開網址就能用。想裝到桌面就用瀏覽器的「加入主畫面／安裝」。

### 自己跑

沒有建置步驟，任何靜態伺服器都行：

```bash
git clone https://github.com/akai1030/NICEPLAY.git
cd NICEPLAY
python3 -m http.server 8123
# 開 http://localhost:8123
```

### 控制與投影分開

1. 在筆電開一個視窗操作
2. 再開一個視窗、網址加上 `#present`，拖到接電視的那個顯示器
3. 兩邊會自動同步（用瀏覽器內建的 BroadcastChannel，不需要伺服器）

---

## 部署

純靜態，丟哪都能跑。

**Zeabur**：Add Service → Git → 選這個 repo，`zbpack.json` 已經設好靜態部署，
接著在 Domains 綁你的網域就好。

**其他**：Cloudflare Pages、Netlify、GitHub Pages、Vercel 都是直接指到根目錄即可。

---

## 開發

```
index.html          外殼
src/engine.js       賽制引擎（純函式，不碰畫面與儲存）
src/store.js        狀態：localStorage + BroadcastChannel
src/ui.js           介面
src/style.css       視覺
sw.js               Service Worker（離線快取）
test/engine.test.js 引擎單元測試
test/e2e.html       端對端測試（在瀏覽器裡驅動真的介面跑完一場）
```

沒有建置步驟、沒有相依套件、沒有框架。原生 ES5 + 原生 DOM。

```bash
node test/engine.test.js         # 引擎 11 組測試
python3 -m http.server 8123      # 然後開 /test/e2e.html 看端對端
```

`engine.js` 是純函式，也可以單獨拿去用：

```js
const E = require('./src/engine.js');
E.suggestRounds(32);             // 5
E.standings(players, matches);   // 含 OMW / OOMW 的完整名次
E.nextRound(state);              // 下一輪怎麼排
```

實測 512 人跑滿九輪，單輪配對 3.2 毫秒，全程零重複對手。

---

## 視覺

沿用臺東卡牌大賽的主視覺：純黑底、純白大字、電光藍 `#1824E4`、萊姆綠 `#B0D000`、
橄欖金 `#A89330`。桌號用襯線體、數字用等寬體 —— 投影在暗場最清楚。

不載任何外部字型，現場斷網也不會掉字。

---

## 授權

MIT。拿去改、拿去用、拿去開你自己的比賽。
