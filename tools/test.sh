#!/bin/sh
# 一次跑完全部。推上去之前跑這支。
#
# 八組各守不同的東西：
#   engine  賽制算得對不對（配對、名次、淘汰賽）
#   bo      幾勝制，以及「小局不影響名次」那條界線沒被踩破
#   pairing 遲到補分、避開同隊，兩件會直接動到名次公正性的事
#   double  雙敗淘汰：勝敗部的相依順序、加賽時機、輪空補齊
#   store   名單解析、匯出匯入、還原點、舊存檔相容
#   server  房間伺服器的 HTTP 行為與權限
#   net     連線層，拿真的 net.js 對真的伺服器跑
#   check   結構性問題：標籤沒閉合、id 重複、版本章沒對齊、字級破規範
set -e
cd "$(dirname "$0")/.."

fail=0
for t in test/engine.test.js test/bo.test.js test/pairing.test.js test/double.test.js test/store.test.js \
         server/test.js test/net.test.js test/check.js; do
  printf '\n════ %s ════\n' "$t"
  if node "$t" | tail -n 3; then :; else fail=1; fi
done

printf '\n'
if [ "$fail" = "0" ]; then
  echo "八組全部通過 ✅"
else
  echo "有測試沒過 ❌"
  exit 1
fi
