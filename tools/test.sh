#!/bin/sh
# 一次跑完全部。推上去之前跑這支。
#
# 每一組各守不同的東西：
#   engine  賽制算得對不對（配對、名次、淘汰賽）
#   bo      幾勝制，以及「小局不影響名次」那條界線沒被踩破
#   pairing 遲到補分、避開同隊，兩件會直接動到名次公正性的事
#   double  雙敗淘汰：勝敗部的相依順序、加賽時機、輪空補齊
#   store   名單解析、匯出匯入、還原點、舊存檔相容
#   fmt     介面共用的小工具：跳脫、輪次名稱、賽制說明、桌號排序、搜尋
#   csv     匯出 CSV：欄位、公式注入、BOM 與 CRLF
#   view    控制台三頁的 HTML 片段：名單、桌數提示、賽事清單、對戰卡、名次表、桌卡
#   watch   選手手機那一頁：我在第幾桌、比分站在誰那邊、我的每一輪、名次
#   present 投影：回報進度、預計結束時間、欄數與字級、對戰表、名次
#   card    賽後成績單：每一輪那幾行、名次與戰績畫在哪裡（假的 2D context）
#   patch   局部更新：結果跟 innerHTML 一樣、沒變的節點留著（瀏覽器裡的對照在 test/patch.html）
#   clean   別臺推來、匯入的狀態先整理：壞 id 整筆丟掉、數字轉整數，三個畫面都拼不出標籤
#   server  房間伺服器的 HTTP 行為與權限
#   net     連線層，拿真的 net.js 對真的伺服器跑
#   check   結構性問題：標籤沒閉合、id 重複、版本章沒對齊、字級破規範
set -e
cd "$(dirname "$0")/.."

fail=0
n=0
for t in test/engine.test.js test/bo.test.js test/pairing.test.js test/double.test.js test/store.test.js \
         test/fmt.test.js test/csv.test.js test/view.test.js test/watch.test.js test/present.test.js test/card.test.js test/patch.test.js test/clean.test.js \
         server/test.js test/net.test.js test/check.js; do
  printf '\n════ %s ════\n' "$t"
  n=$((n + 1))
  # 不能寫成 `if node "$t" | tail -n 3`：管線的結束碼是 tail 的，永遠是 0，
  # 測試掛了也照樣印「全部通過」、CI 也是綠的。先接住輸出與結束碼再印。
  if out=$(node "$t" 2>&1); then :; else fail=1; fi
  printf '%s\n' "$out" | tail -n 3
done

printf '\n'
if [ "$fail" = "0" ]; then
  echo "$n 組全部通過 ✅"
else
  echo "有測試沒過 ❌"
  exit 1
fi
