/* ============================================================
   NICEPLAY · 局部更新
   ------------------------------------------------------------
   畫面每次狀態一變就整份重畫（render），原本是直接換 innerHTML。
   換 innerHTML 等於把整塊拆掉重蓋：裡面的按鈕全部是新的，
   鍵盤焦點會掉回 <body>、按住的那一下會斷掉。

   最明顯的是對戰卡：用鍵盤回報（Tab 到選手、按 Enter），
   一按下去整份列表重蓋，焦點就不見了，← → 沒辦法接著用。
   搜尋框每打一個字也是整份重蓋一次。

   patch(容器, html) 產生的畫面跟 innerHTML 一樣，差別是
   只動真的不一樣的地方：屬性不同就改屬性、文字不同就改文字，
   一樣的節點原封不動留著（焦點、:active 都還在）。

   比對是「照位置」一個一個對，不認 key —— 這裡的列表只有在
   搜尋與排序時會整串移位，那時候焦點本來就在搜尋框或下拉選單裡。

   跟 innerHTML 唯一可能的差別是屬性的先後順序：原本沒有、後來才加的屬性
   會排在最後。畫面與行為都不受影響（CSS 選擇器、dataset 都不看順序）。

   限制：容器裡不能放輸入框。<input> 的 value 屬性跟使用者打進去的值
   是兩回事，同步屬性改不到後者，結果就會跟 innerHTML 不一樣。
   現在用到的三個容器（對戰列表、名次表、桌數提示）都只有按鈕與文字。
   Node 也跑得動（test/patch.test.js 用一個很小的假 DOM），
   真瀏覽器裡跟 innerHTML 逐一對照的在 test/patch.html。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Patch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var XHTML = 'http://www.w3.org/1999/xhtml';

/* 同一種節點才能就地更新：同為文字、或同為同一個標籤 */
function sameKind(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  return a.nodeName === b.nodeName && a.namespaceURI === b.namespaceURI;
}

function syncAttrs(from, to) {
  var i, a;
  for (i = from.attributes.length - 1; i >= 0; i--) {
    a = from.attributes[i];
    if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
  }
  for (i = 0; i < to.attributes.length; i++) {
    a = to.attributes[i];
    if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
  }
}

/* 把 a 改成跟 b 一樣。回傳 a 在樹上的替身（被整個換掉的時候是 b） */
function morph(a, b) {
  if (a.nodeType !== 1) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return a;
  }
  /* SVG（QR 碼）的屬性有命名空間，逐一同步容易出錯；
     不一樣就整個換掉，一樣就不碰 */
  if (a.namespaceURI !== XHTML) {
    if (!a.isEqualNode(b)) { a.parentNode.replaceChild(b, a); return b; }
    return a;
  }
  syncAttrs(a, b);
  morphChildren(a, b);
  return a;
}

/* from 的子節點改成跟 to 的子節點一樣。to 裡新增或換掉的節點是直接搬過去用的，
   所以呼叫完 to 就是半拆的狀態，不能再拿來用。 */
function morphChildren(from, to) {
  var a = from.firstChild, b = to.firstChild;
  while (b) {
    var nextB = b.nextSibling;
    if (!a) {
      from.appendChild(b);
    } else {
      var nextA = a.nextSibling;
      if (sameKind(a, b)) morph(a, b);
      else from.replaceChild(b, a);
      a = nextA;
    }
    b = nextB;
  }
  while (a) {
    var n = a.nextSibling;
    from.removeChild(a);
    a = n;
  }
}

/* 用法跟 el.innerHTML = html 一樣。
   用 <template> 解析而不是另開一個 <div>：template 裡的東西不會被執行、
   圖片不會被載入，解析完直接把節點搬過去用。 */
function patch(container, html) {
  var tpl = container.ownerDocument.createElement('template');
  tpl.innerHTML = html;
  morphChildren(container, tpl.content);
}

return { patch: patch, morphChildren: morphChildren };
});
