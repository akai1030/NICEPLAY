#!/bin/sh
# 蓋版本章。
#
# Cloudflare（以及大部分 CDN）會把 .css / .js 快取好幾個小時，但 index.html
# 是每次都回源的。結果是部署完之後，使用者拿到新的 HTML 配舊的 CSS ——
# 畫面會爛掉，而且要等快取自己過期才會好。
#
# 解法：把版本號寫進網址的查詢字串。版本一換就是新網址，CDN 一定回源。
# 每次要部署之前跑這支，然後照常 commit。
set -e
cd "$(dirname "$0")/.."
V=$(date +%Y%m%d%H%M)

perl -pi -e "s/(src\/[a-z]+\.(?:css|js))\?v=\d+/\$1?v=$V/g; s/(src\/[a-z]+\.(?:css|js))\"/\$1?v=$V\"/g" index.html
perl -pi -e "s/^const VERSION = '.*';/const VERSION = '$V';/" sw.js

echo "版本 $V"
grep -o "src/[a-z]*\.\(css\|js\)?v=[0-9]*" index.html | sed 's/^/  /'
grep -n "^const VERSION" sw.js | sed 's/^/  /'
