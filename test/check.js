/* NICEPLAY 靜態檢查 —— node test/check.js

   前面幾支測的是「跑起來對不對」，這一支測的是「結構有沒有歪」。
   這裡抓的每一種，都是曾經真的溜到正式站上過的類型：

     · index.html 有一行被貼成兩次，#book 從此沒閉合，#toast 被吃進去，
       整站的提示變成無聲的 —— 純靠肉眼看不出來，但 div 一數就現形。
     · CDN 會把 .css 快取數小時，版本章沒對齊就是新 HTML 配舊 CSS。
     · Service Worker 的快取清單少一個檔，離線就少一塊。

   不需要瀏覽器，所以 CI 或 commit 前都跑得動。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } return c; };
const head = t => console.log('\n' + t);

const html = read('index.html');
const css = read('src/style.css');
const ui = read('src/ui.js');
const sw = read('sw.js');
const lines = html.split(/\r?\n/);

/* ── 1 ─────────────────────────────────────────────── */
head('【1】index.html 標籤結構');
{
  let d = 0, s = 0;
  lines.forEach(l => {
    d += (l.match(/<div\b/g) || []).length - (l.match(/<\/div>/g) || []).length;
    s += (l.match(/<section\b/g) || []).length - (l.match(/<\/section>/g) || []).length;
  });
  ok(d === 0, '<div> 沒有平衡，檔尾還差 ' + d + ' 個 —— 後面的元素會被吃進上一個容器');
  ok(s === 0, '<section> 沒有平衡，檔尾還差 ' + s + ' 個');
  console.log('  div / section 都平衡 ✓');
}

/* ── 2 ─────────────────────────────────────────────── */
head('【2】id 不重複');
{
  const seen = {};
  lines.forEach((l, i) => {
    (l.match(/id="([^"]+)"/g) || []).forEach(m => {
      const k = m.slice(4, -1);
      (seen[k] = seen[k] || []).push(i + 1);
    });
  });
  const dup = Object.entries(seen).filter(([, v]) => v.length > 1);
  ok(!dup.length, '有重複的 id：' + dup.map(([k, v]) => k + '(' + v.join(',') + ')').join('、'));
  console.log('  ' + Object.keys(seen).length + ' 個 id，沒有重複 ✓');
}

/* ── 3 ─────────────────────────────────────────────── */
head('【3】ui.js 取用的元素都真的在 index.html 裡');
{
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...ui.matchAll(/\bel\('([^']+)'\)/g)].map(m => m[1]));
  const missing = [...used].filter(i => !ids.has(i));
  ok(!missing.length, 'ui.js 會拿到 null：' + missing.join('、'));

  /* 選擇器指到的 class 可以寫死在 HTML 裡，也可以是 ui.js 自己畫出來的
     （對戰卡、名次列都是動態生成）—— 兩邊都找不到才算是打錯字。 */
  const sels = [...ui.matchAll(/querySelector(?:All)?\('([^']+)'\)/g)].map(m => m[1]);
  sels.forEach(sel => {
    /* 先把屬性選擇器整段拿掉，不然 script[src*="ui.js"] 裡的 .js
       會被當成 class 名 */
    const bare = sel.replace(/\[[^\]]*\]/g, '');
    (bare.match(/\.([\w-]+)/g) || []).forEach(c => {
      const cls = c.slice(1);
      ok(html.indexOf('"' + cls) >= 0 || html.indexOf(cls + '"') >= 0 ||
         html.indexOf(cls + ' ') >= 0 || ui.indexOf('"' + cls) >= 0 ||
         ui.indexOf(cls + ' ') >= 0 || ui.indexOf("'" + cls) >= 0,
         '選擇器 ' + sel + ' 用到的 class「' + cls + '」在 HTML 與 ui.js 裡都找不到');
    });
  });
  console.log('  ' + used.size + ' 個 id、' + sels.length + ' 條選擇器都對得上 ✓');
}

/* ── 4 ─────────────────────────────────────────────── */
head('【4】CSS 結構與變數');
{
  ok((css.match(/{/g) || []).length === (css.match(/}/g) || []).length, 'CSS 大括號沒有配對');

  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const usedVars = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
  const undef = [...usedVars].filter(v => !defined.has(v));
  ok(!undef.length, '用到了沒有定義的 CSS 變數：' + undef.join('、'));
  console.log('  ' + defined.size + ' 個 token，' + usedVars.size + ' 個被使用，沒有懸空的 ✓');
}

/* ── 5 ─────────────────────────────────────────────── */
head('【5】版本章對齊（CDN 會把 .css / .js 快取數小時）');
{
  const stamps = [...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]);
  const uniq = [...new Set(stamps)];
  ok(stamps.length > 0, 'index.html 完全沒有蓋版本章');
  ok(uniq.length === 1, 'index.html 裡有不只一組版本章：' + uniq.join('、'));

  const swv = (sw.match(/^const VERSION = '(\d+)'/m) || [])[1];
  ok(swv === uniq[0], 'sw.js 的版本 ' + swv + ' 跟 index.html 的 ' + uniq[0] + ' 不一致');

  const reg = (html.match(/register\('sw\.js\?v=(\d+)'/) || [])[1];
  ok(reg === uniq[0], 'Service Worker 的註冊網址沒帶對版本：' + reg);
  console.log('  ' + stamps.length + ' 處版本章一致（' + uniq[0] + '），sw.js 與註冊網址都對上 ✓');
}

/* ── 6 ─────────────────────────────────────────────── */
head('【6】Service Worker 快取清單裡的檔案都存在');
{
  const shell = [...sw.matchAll(/'\.\/([^']*)'/g)].map(m => m[1])
    .filter(p => p && !p.startsWith('?'));
  let bad = [];
  shell.forEach(p => {
    const clean = p.split('?')[0];
    if (!clean) return;                      /* './' 就是首頁本身 */
    if (!exists(clean)) bad.push(clean);
  });
  ok(!bad.length, '快取清單列了不存在的檔案，離線會缺一塊：' + bad.join('、'));
  console.log('  ' + shell.length + ' 個項目，檔案都在 ✓');
}

/* ── 7 ─────────────────────────────────────────────── */
head('【7】HTML / CSS 引用到的素材都存在');
{
  const refs = new Set();
  [...html.matchAll(/(?:href|src)="((?:assets|src)\/[^"?]+)/g)].forEach(m => refs.add(m[1]));
  [...css.matchAll(/url\(\.\.\/([^)]+)\)/g)].forEach(m => refs.add(m[1]));
  const bad = [...refs].filter(p => !exists(p));
  ok(!bad.length, '引用了不存在的檔案：' + bad.join('、'));
  console.log('  ' + refs.size + ' 個引用都找得到檔案 ✓');
}

/* ── 8 ─────────────────────────────────────────────── */
head('【8】最小字級規範（功能性文字 ≥ 11.5px）');
{
  const FLOOR = 11.5;
  const small = [];
  css.split(/\r?\n/).forEach((l, i) => {
    const m = l.match(/font-size:\s*([\d.]+)px/);
    if (m && parseFloat(m[1]) < FLOOR) small.push('L' + (i + 1) + ' ' + m[1] + 'px');
  });
  ok(!small.length, '有低於 ' + FLOOR + 'px 的字級：' + small.join('、'));
  console.log('  沒有小於 ' + FLOOR + 'px 的 px 字級 ✓');
}

/* ── 9 ─────────────────────────────────────────────── */
head('【9】點擊區規範');
{
  const rule = (sel) => {
    const i = css.indexOf(sel);
    if (i < 0) return null;
    const block = css.slice(i, css.indexOf('}', i));
    const m = block.match(/min-height:\s*(\d+)px/);
    return m ? parseInt(m[1], 10) : null;
  };
  const tap = (css.match(/--tap:\s*(\d+)px/) || [])[1];
  ok(parseInt(tap, 10) >= 44, '主要點擊區 --tap 應該至少 44px（iOS 最低），目前 ' + tap);
  ok(rule('button.sm {') >= 44, '.sm 按鈕低於 44px：' + rule('button.sm {'));
  ok(rule('.dropb {') >= 34, '.dropb 低於 34px：' + rule('.dropb {'));

  /* 表單元件低於 16px，iOS Safari 一聚焦就會把整頁放大 */
  const inp = css.match(/input\[type=text\][\s\S]{0,400}?font-size:\s*(\d+)px/);
  ok(inp && parseInt(inp[1], 10) >= 16,
     '表單字級低於 16px，iOS 會自動縮放頁面：' + (inp && inp[1]));
  console.log('  --tap ' + tap + 'px · .sm ' + rule('button.sm {') + 'px · 表單 ' +
              (inp && inp[1]) + 'px ✓');
}

/* ── 10 ────────────────────────────────────────────── */
head('【10】品牌字串一致，沒有改到一半的殘留');
{
  const files = ['index.html', 'manifest.json', 'README.md', 'src/engine.js'];
  const stale = files.filter(f => /Yomi|讀心/.test(read(f)));
  ok(!stale.length, '還留著舊的 Y 字：' + stale.join('、'));

  const full = files.filter(f => read(f).indexOf('League And You') >= 0);
  ok(full.length === files.length,
     '有檔案沒有帶到完整全稱：' + files.filter(f => full.indexOf(f) < 0).join('、'));

  const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1];
  ok(/NICEPLAY/.test(title), '<title> 不含品牌名：' + title);
  console.log('  四個檔案的全稱一致，沒有殘留 ✓');
}

/* ── 11 ────────────────────────────────────────────── */
head('【11】文字對比度（WCAG AA 4.5:1）');
{
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (f, b) => {
    const a = Math.max(lum(f), lum(b)), c = Math.min(lum(f), lum(b));
    return (a + 0.05) / (c + 0.05);
  };
  const hex = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const over = (f, a, b) => f.map((v, i) => Math.round(a * v + (1 - a) * b[i]));

  /* 從 CSS 直接讀 token，不要在測試裡另外抄一份數值 —— 抄的那份遲早會走鐘 */
  const grab = (block, name) => {
    const i = css.indexOf(block);
    const seg = css.slice(i, css.indexOf('}', i));
    const m = seg.match(new RegExp('--' + name + ':\\s*([^;]+);'));
    return m ? m[1].trim() : null;
  };
  const parse = v => {
    let m = v.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (m) return { rgb: [+m[1], +m[2], +m[3]], a: parseFloat(m[4]) };
    m = v.match(/#([0-9A-Fa-f]{6})/);
    return m ? { rgb: hex('#' + m[1]), a: 1 } : null;
  };

  /* 內文級距的文字色，各自疊在自己主題的 surface 上 */
  const checks = [
    ['深色 --dim', ':root {', 'dim', ':root {', 'surface'],
    ['深色 --faint', ':root {', 'faint', ':root {', 'surface'],
    ['深色 --label-fg', ':root {', 'label-fg', ':root {', 'surface'],
    ['淺色 --dim', '[data-theme="light"]', 'dim', '[data-theme="light"]', 'surface'],
    ['淺色 --faint', '[data-theme="light"]', 'faint', '[data-theme="light"]', 'surface'],
    ['淺色 --label-fg', '[data-theme="light"]', 'label-fg', '[data-theme="light"]', 'surface']
  ];
  let worst = 99;
  checks.forEach(([label, fb, fn, bb, bn]) => {
    const f = parse(grab(fb, fn)), b = parse(grab(bb, bn));
    if (!f || !b) { ok(false, label + ' 讀不到 token'); return; }
    const r = ratio(f.a < 1 ? over(f.rgb, f.a, b.rgb) : f.rgb, b.rgb);
    worst = Math.min(worst, r);
    ok(r >= 4.5, label + ' 只有 ' + r.toFixed(2) + ':1，低於 AA 的 4.5:1');
  });
  console.log('  六個內文色都過 AA，最低 ' + worst.toFixed(2) + ':1 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
