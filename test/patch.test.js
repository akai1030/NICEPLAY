/* NICEPLAY 局部更新測試 —— node test/patch.test.js

   src/patch.js 的 morphChildren 要做到兩件事：
     1. 更新完的樣子跟直接換 innerHTML 一模一樣（不然畫面會跟原本不同）
     2. 沒變的節點是原本那一個（焦點才留得住）
   Node 沒有 DOM，這裡用一個只有幾十行的假 DOM 跑演算法本身；
   在真瀏覽器裡跟 innerHTML 逐一對照的是 test/patch.html。 */
'use strict';

const P = require('../src/patch.js');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const eq = (got, want, m) => ok(got === want, m + '　得到 ' + JSON.stringify(got) +
                                              '　應該是 ' + JSON.stringify(want));
const head = t => console.log('\n' + t);

/* ── 假 DOM：只做 morphChildren 用得到的部分 ── */
const XHTML = 'http://www.w3.org/1999/xhtml', SVGNS = 'http://www.w3.org/2000/svg';
let writes = 0;   /* 真的動到畫面的次數（改屬性、改文字、插入、移除） */
class N {
  constructor(type, name, ns) {
    this.nodeType = type; this.nodeName = name; this.namespaceURI = ns || null;
    this.attributes = []; this.childNodes = []; this.parentNode = null; this.nodeValue = null;
  }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const s = this.parentNode.childNodes; return s[s.indexOf(this) + 1] || null;
  }
  hasAttribute(k) { return this.attributes.some(a => a.name === k); }
  getAttribute(k) { const a = this.attributes.find(x => x.name === k); return a ? a.value : null; }
  setAttribute(k, v) {
    writes++;
    const a = this.attributes.find(x => x.name === k);
    if (a) a.value = String(v); else this.attributes.push({ name: k, value: String(v) });
  }
  removeAttribute(k) { writes++; this.attributes = this.attributes.filter(a => a.name !== k); }
  detach() { if (this.parentNode) { const s = this.parentNode.childNodes; s.splice(s.indexOf(this), 1); this.parentNode = null; } }
  appendChild(c) { writes++; c.detach(); c.parentNode = this; this.childNodes.push(c); return c; }
  replaceChild(c, old) {
    writes++; c.detach();
    const i = this.childNodes.indexOf(old); this.childNodes[i] = c; c.parentNode = this; old.parentNode = null; return old;
  }
  removeChild(c) { writes++; c.detach(); return c; }
  isEqualNode(o) { return html(this) === html(o); }
}
/* nodeValue 用 getter/setter 包起來，才數得到改文字的次數 */
Object.defineProperty(N.prototype, 'nodeValue', {
  get() { return this._v; }, set(v) { if (this._v !== undefined && v !== this._v) writes++; this._v = v; }
});
function h(tag, attrs, ...kids) {
  const ns = tag.startsWith('svg:') ? SVGNS : XHTML;
  const n = new N(1, tag.replace('svg:', '').toUpperCase(), ns);
  Object.keys(attrs || {}).forEach(k => n.attributes.push({ name: k, value: String(attrs[k]) }));
  kids.forEach(k => { const c = typeof k === 'string' ? text(k) : k; c.parentNode = n; n.childNodes.push(c); });
  return n;
}
function text(s) { const t = new N(3, '#text'); t._v = s; return t; }
function frag(...kids) { return h('div', {}, ...kids); }   /* 當成 template.content 用 */
function html(n) {
  if (n.nodeType === 3) return n.nodeValue;
  const a = n.attributes.map(x => ' ' + x.name + '="' + x.value + '"').join('');
  return '<' + n.nodeName.toLowerCase() + a + '>' + n.childNodes.map(html).join('') + '</' + n.nodeName.toLowerCase() + '>';
}
const inner = n => n.childNodes.map(html).join('');

head('【1】結果跟換 innerHTML 一樣');
{
  const box = frag(h('div', { class: 'mt' }, h('button', { 'data-t': '1', 'aria-pressed': 'true' }, '王')),
                   h('div', { class: 'mt' }, h('button', { 'data-t': '2' }, '陳')),
                   h('p', {}, '多出來的'));
  const want = frag(h('div', { class: 'mt islive' }, h('button', { 'data-t': '1' }, '王小明')),
                    h('section', {}, '換了標籤'),
                    h('div', { class: 'mt' }, h('button', { 'data-t': '3', title: 'x' }, '林')),
                    h('div', { class: 'mt' }, '新加的'));
  const target = inner(want);
  P.morphChildren(box, want);
  eq(inner(box), target, '加屬性、拿掉屬性、改文字、換標籤、多的刪掉、少的補上');
  console.log('  屬性、文字、標籤、增刪 ✓');
}

head('【2】沒變的節點留著原本那一個 —— 焦點才不會掉');
{
  const b1 = h('button', { 'data-t': '1' }, '王');
  const b2 = h('button', { 'data-t': '2', class: 'sd' }, '陳');
  const box = frag(h('div', { class: 'mt' }, b1), h('div', { class: 'mt' }, b2));
  writes = 0;
  P.morphChildren(box, frag(h('div', { class: 'mt' }, h('button', { 'data-t': '1' }, '王')),
                            h('div', { class: 'mt' }, h('button', { 'data-t': '2', class: 'sd win' }, '陳'))));
  ok(box.childNodes[0].childNodes[0] === b1, '完全沒變的按鈕是同一個物件');
  ok(box.childNodes[1].childNodes[0] === b2, '只改了 class 的按鈕也是同一個物件');
  eq(b2.getAttribute('class'), 'sd win', 'class 有更新');
  eq(writes, 1, '只動了一個地方');

  writes = 0;
  P.morphChildren(box, frag(h('div', { class: 'mt' }, h('button', { 'data-t': '1' }, '王')),
                            h('div', { class: 'mt' }, h('button', { 'data-t': '2', class: 'sd win' }, '陳'))));
  eq(writes, 0, '一模一樣就一下都不動');
  console.log('  同一個物件、只動該動的 ✓');
}

head('【3】JS 自己加上去的 class（例如換位時的 picked）照樣被洗掉，跟 innerHTML 一樣');
{
  const b = h('button', { class: 'sd' }, '王');
  const box = frag(b);
  b.setAttribute('class', 'sd picked');
  P.morphChildren(box, frag(h('button', { class: 'sd' }, '王')));
  eq(b.getAttribute('class'), 'sd', 'picked 拿掉了');
  console.log('  不會留下舊畫面的痕跡 ✓');
}

head('【4】SVG（QR 碼）：一樣就不碰，不一樣整個換');
{
  const q1 = h('svg:svg', { viewBox: '0 0 10 10' }, h('svg:path', { d: 'M0 0h1' }));
  const box = frag(q1);
  P.morphChildren(box, frag(h('svg:svg', { viewBox: '0 0 10 10' }, h('svg:path', { d: 'M0 0h1' }))));
  ok(box.childNodes[0] === q1, '一樣的 QR 不重畫');
  P.morphChildren(box, frag(h('svg:svg', { viewBox: '0 0 10 10' }, h('svg:path', { d: 'M0 0h2' }))));
  ok(box.childNodes[0] !== q1, '不一樣就整個換掉');
  eq(inner(box), '<svg viewBox="0 0 10 10"><path d="M0 0h2"></path></svg>', '換上新的');
  console.log('  QR 不必重畫、要重畫就整個換 ✓');
}

head('【5】文字與元素交錯、清空');
{
  const box = frag('前面', h('b', {}, '1'), '後面');
  P.morphChildren(box, frag(h('b', {}, '2'), '只剩這個'));
  eq(inner(box), '<b>2</b>只剩這個', '文字換成元素、元素換成文字');
  P.morphChildren(box, frag());
  eq(inner(box), '', '新的是空的就清空');
  P.morphChildren(box, frag('從空的開始'));
  eq(inner(box), '從空的開始', '從空的長出來');
  console.log('  交錯、清空、從空的開始 ✓');
}

console.log(fails ? '\n有 ' + fails + ' 項沒過 ❌' : '\n全部通過 ✅');
process.exit(fails ? 1 : 0);
