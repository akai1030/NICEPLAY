/*
 * qr.js — 零相依的 QR Code 產生器（ES5，可直接用 <script> 載入）
 *
 * 做什麼：把字串編成 QR Code，輸出 0/1 二維矩陣或單路徑 SVG。
 * 只支援 byte mode（UTF-8），版本 1–40 自動選，四種容錯等級 L/M/Q/H。
 *
 * 為什麼自己寫：現場機器不接外網，也不允許載入任何外部資源或套件，
 * 所以編碼、Reed-Solomon、矩陣佈局、遮罩評分全部在這個檔案裡完成。
 *
 * 用法：
 *   QR.matrix(text, ecc)        -> [[0|1, ...], ...]，1 = 黑模組
 *   QR.svg(text, opts)          -> SVG 字串（不含 XML 宣告）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 容錯等級 ---------- */
  // 索引順序 L, M, Q, H；formatBits 是寫進 format information 的 2 bit 值
  var ECC_ORDER = ['L', 'M', 'Q', 'H'];
  var ECC_FORMAT_BITS = [1, 0, 3, 2];

  // 每區塊的 EC codeword 數（索引 0 未用，對應版本 1..40）
  var ECC_PER_BLOCK = [
    [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28,
     28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
     26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26,
     30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26,
     28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];

  // 區塊數
  var NUM_BLOCKS = [
    [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7,
     8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14,
     16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21,
     20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25,
     25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  /* ---------- UTF-8 ---------- */
  function utf8Bytes(str) {
    var out = [], i, c, c2, cp;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length &&
                 (c2 = str.charCodeAt(i + 1)) >= 0xDC00 && c2 <= 0xDFFF) {
        cp = ((c - 0xD800) << 10) + (c2 - 0xDC00) + 0x10000;
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
        i++;
      } else if (c >= 0xD800 && c <= 0xDFFF) {
        out.push(0xEF, 0xBF, 0xBD); // 落單的代理對，換成 U+FFFD
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return out;
  }

  /* ---------- 版本容量 ---------- */
  // 該版本可放的資料模組總數（bit）
  function rawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64, numAlign;
    if (ver >= 2) {
      numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function totalCodewords(ver) { return Math.floor(rawDataModules(ver) / 8); }

  function dataCodewords(ver, e) {
    return totalCodewords(ver) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];
  }

  function charCountBits(ver) { return ver <= 9 ? 8 : 16; }

  /* ---------- GF(256)，生成多項式 0x11D ---------- */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1, i;
    for (i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  // 產生 degree 次的 RS 生成多項式（首項係數 1，省略不存）
  function rsGenerator(degree) {
    var poly = [1], i, j;
    for (i = 0; i < degree; i++) {
      poly.push(0);
      for (j = poly.length - 1; j > 0; j--) {
        poly[j] = poly[j - 1] ^ gfMul(poly[j], EXP[i]);
      }
      poly[0] = gfMul(poly[0], EXP[i]);
    }
    return poly; // 長度 degree+1，poly[degree] === 1
  }

  function rsRemainder(data, degree) {
    var gen = rsGenerator(degree), result = [], i, j, factor;
    for (i = 0; i < degree; i++) result.push(0);
    for (i = 0; i < data.length; i++) {
      factor = data[i] ^ result.shift();
      result.push(0);
      for (j = 0; j < degree; j++) {
        result[j] ^= gfMul(gen[degree - 1 - j], factor);
      }
    }
    return result;
  }

  /* ---------- 位元流 ---------- */
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, length) {
    for (var i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  /* ---------- 資料編碼：mode + 長度 + 內容 + terminator + padding ---------- */
  function encodeData(bytes, ver, e) {
    var capacity = dataCodewords(ver, e) * 8;
    var bb = new BitBuffer(), i, pad, codewords;

    bb.put(4, 4);                              // byte mode
    bb.put(bytes.length, charCountBits(ver));
    for (i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);

    // terminator：最多 4 個 0
    bb.put(0, Math.min(4, capacity - bb.bits.length));
    // 補到整個 byte
    bb.put(0, (8 - bb.bits.length % 8) % 8);

    codewords = [];
    for (i = 0; i < bb.bits.length; i += 8) {
      codewords.push(
        (bb.bits[i] << 7) | (bb.bits[i + 1] << 6) | (bb.bits[i + 2] << 5) |
        (bb.bits[i + 3] << 4) | (bb.bits[i + 4] << 3) | (bb.bits[i + 5] << 2) |
        (bb.bits[i + 6] << 1) | bb.bits[i + 7]);
    }
    // 0xEC / 0x11 交替填滿
    for (pad = 0xEC; codewords.length < capacity / 8; pad ^= 0xEC ^ 0x11) {
      codewords.push(pad);
    }
    return codewords;
  }

  /* ---------- 區塊分割、RS、交錯 ---------- */
  function interleave(data, ver, e) {
    var numBlocks = NUM_BLOCKS[e][ver];
    var eccLen = ECC_PER_BLOCK[e][ver];
    var total = totalCodewords(ver);
    var shortBlockLen = Math.floor(total / numBlocks);
    var numShort = numBlocks - total % numBlocks;
    var blocks = [], k = 0, i, j, dat, ecc, result;

    for (i = 0; i < numBlocks; i++) {
      var datLen = shortBlockLen - eccLen + (i < numShort ? 0 : 1);
      dat = data.slice(k, k + datLen);
      k += datLen;
      ecc = rsRemainder(dat, eccLen);
      blocks.push({ data: dat, ecc: ecc });
    }

    result = [];
    // 資料 codeword 交錯（短區塊在最後一輪沒有資料）
    for (i = 0; i < shortBlockLen - eccLen + 1; i++) {
      for (j = 0; j < numBlocks; j++) {
        if (i < blocks[j].data.length) result.push(blocks[j].data[i]);
      }
    }
    // EC codeword 交錯（每區塊長度相同）
    for (i = 0; i < eccLen; i++) {
      for (j = 0; j < numBlocks; j++) result.push(blocks[j].ecc[i]);
    }
    return result;
  }

  /* ---------- 對齊圖樣座標 ---------- */
  function alignPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var size = ver * 4 + 17;
    var step = (ver === 32) ? 26
      : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6], pos;
    for (pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    result.sort(function (a, b) { return a - b; });
    return result;
  }

  /* ---------- 矩陣：功能圖樣 ---------- */
  function newGrid(size, fill) {
    var g = [], y, x, row;
    for (y = 0; y < size; y++) {
      row = [];
      for (x = 0; x < size; x++) row.push(fill);
      g.push(row);
    }
    return g;
  }

  function drawFunctionPatterns(mods, func, ver) {
    var size = mods.length, i, j, x, y, pos, n;

    function setF(x, y, v) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      mods[y][x] = v;
      func[y][x] = 1;
    }

    // finder + separator：以中心 (cx, cy) 畫 9x9 範圍
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var d = Math.max(Math.abs(dx), Math.abs(dy));
          setF(cx + dx, cy + dy, (d !== 2 && d !== 4) ? 1 : 0);
        }
      }
    }
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    // timing
    for (i = 0; i < size; i++) {
      if (!func[6][i]) setF(i, 6, i % 2 === 0 ? 1 : 0);
      if (!func[i][6]) setF(6, i, i % 2 === 0 ? 1 : 0);
    }

    // alignment：跳過與 finder 重疊的三個角
    pos = alignPositions(ver);
    n = pos.length;
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (y = -2; y <= 2; y++) {
          for (x = -2; x <= 2; x++) {
            setF(pos[j] + x, pos[i] + y,
              Math.max(Math.abs(x), Math.abs(y)) !== 1 ? 1 : 0);
          }
        }
      }
    }

    // format information 保留區（內容稍後才填）
    // i === 6 是 timing pattern 的交會點，必須跳過，不能被蓋掉
    for (i = 0; i <= 8; i++) {
      if (i === 6) continue;
      setF(i, 8, 0);
      setF(8, i, 0);
    }
    for (i = 0; i < 8; i++) {
      setF(size - 1 - i, 8, 0);
      setF(8, size - 1 - i, 0);
    }
    // dark module
    setF(8, size - 8, 1);

    // version information（版本 7 以上）
    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vbits = (ver << 12) | rem; // 18 bit
      for (i = 0; i < 18; i++) {
        var bit = (vbits >>> i) & 1;
        var a = size - 11 + i % 3, b = Math.floor(i / 3);
        setF(a, b, bit);
        setF(b, a, bit);
      }
    }
  }

  function drawFormatBits(mods, ver, e, mask) {
    var size = mods.length;
    var data = (ECC_FORMAT_BITS[e] << 3) | mask; // 5 bit
    var rem = data, i, bit;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;   // 15 bit

    // 第一份：左上角 finder 周圍（column 8 由上往下，接 row 8 由右往左）
    for (i = 0; i <= 5; i++) mods[i][8] = (bits >>> i) & 1;
    mods[7][8] = (bits >>> 6) & 1;
    mods[8][8] = (bits >>> 7) & 1;
    mods[8][7] = (bits >>> 8) & 1;
    for (i = 9; i < 15; i++) mods[8][14 - i] = (bits >>> i) & 1;

    // 第二份：row 8 右側 + column 8 下方
    for (i = 0; i < 8; i++) mods[8][size - 1 - i] = (bits >>> i) & 1;
    for (i = 8; i < 15; i++) mods[size - 15 + i][8] = (bits >>> i) & 1;
    mods[size - 8][8] = 1; // dark module
  }

  function drawCodewords(mods, func, codewords) {
    var size = mods.length, i = 0, right, vert, j, x, y, upward;
    for (right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // 跳過垂直 timing 那一行
      for (vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          x = right - j;
          upward = ((right + 1) & 2) === 0;
          y = upward ? size - 1 - vert : vert;
          if (!func[y][x] && i < codewords.length * 8) {
            mods[y][x] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1;
            i++;
          }
        }
      }
    }
  }

  /* ---------- 遮罩 ---------- */
  function maskBit(m, x, y) {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
  }

  function applyMask(mods, func, m) {
    var size = mods.length, y, x;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        if (!func[y][x] && maskBit(m, x, y)) mods[y][x] ^= 1;
      }
    }
  }

  /* ---------- 四條懲罰規則 ---------- */
  function penalty(mods) {
    var size = mods.length, score = 0, y, x, i;

    // 規則 1：同色連續 5 個以上
    function runScore(run) { return run >= 5 ? 3 + (run - 5) : 0; }
    for (y = 0; y < size; y++) {
      var run = 1;
      for (x = 1; x < size; x++) {
        if (mods[y][x] === mods[y][x - 1]) run++;
        else { score += runScore(run); run = 1; }
      }
      score += runScore(run);
    }
    for (x = 0; x < size; x++) {
      var runv = 1;
      for (y = 1; y < size; y++) {
        if (mods[y][x] === mods[y - 1][x]) runv++;
        else { score += runScore(runv); runv = 1; }
      }
      score += runScore(runv);
    }

    // 規則 2：2x2 同色
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = mods[y][x];
        if (c === mods[y][x + 1] && c === mods[y + 1][x] && c === mods[y + 1][x + 1]) score += 3;
      }
    }

    // 規則 3：1:1:3:1:1 樣式，前後任一側有 4 個淺色
    function line(get) {
      var arr = [], k;
      for (k = 0; k < size; k++) arr.push(get(k));
      var s = 0;
      for (k = 0; k + 6 < size; k++) {
        if (arr[k] === 1 && arr[k + 1] === 0 && arr[k + 2] === 1 && arr[k + 3] === 1 &&
            arr[k + 4] === 1 && arr[k + 5] === 0 && arr[k + 6] === 1) {
          var before = true, after = true, t;
          for (t = 1; t <= 4; t++) {
            if (k - t < 0 || arr[k - t] !== 0) { before = false; break; }
          }
          for (t = 1; t <= 4; t++) {
            if (k + 6 + t >= size || arr[k + 6 + t] !== 0) { after = false; break; }
          }
          if (before || after) s += 40;
        }
      }
      return s;
    }
    for (y = 0; y < size; y++) {
      score += line((function (row) { return function (k) { return mods[row][k]; }; })(y));
    }
    for (x = 0; x < size; x++) {
      score += line((function (col) { return function (k) { return mods[k][col]; }; })(x));
    }

    // 規則 4：黑色比例偏離 50%
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) dark += mods[y][x];
    var total = size * size;
    var k5 = Math.floor(Math.abs(dark * 20 - total * 10) / total); // = floor(|pct-50|/5)
    score += k5 * 10;

    return score;
  }

  /* ---------- 主流程 ---------- */
  function eccIndex(ecc) {
    var e = ECC_ORDER.indexOf(String(ecc == null ? 'M' : ecc).toUpperCase());
    if (e < 0) throw new Error('QR: 不支援的容錯等級 ' + ecc);
    return e;
  }

  function chooseVersion(byteLen, e) {
    for (var ver = 1; ver <= 40; ver++) {
      var cap = dataCodewords(ver, e) * 8;
      if (4 + charCountBits(ver) + byteLen * 8 <= cap) return ver;
    }
    throw new Error('QR: 資料過長，超出版本 40 容量');
  }

  function cloneGrid(g) {
    var out = [], i;
    for (i = 0; i < g.length; i++) out.push(g[i].slice());
    return out;
  }

  function matrix(text, ecc) {
    var e = eccIndex(ecc);
    var bytes = utf8Bytes(String(text));
    var ver = chooseVersion(bytes.length, e);
    var size = ver * 4 + 17;

    var codewords = interleave(encodeData(bytes, ver, e), ver, e);

    var base = newGrid(size, 0);
    var func = newGrid(size, 0);
    drawFunctionPatterns(base, func, ver);
    drawCodewords(base, func, codewords);

    // 八種 mask 全試，取懲罰分數最低者
    var best = null, bestScore = Infinity, m;
    for (m = 0; m < 8; m++) {
      var cand = cloneGrid(base);
      applyMask(cand, func, m);
      drawFormatBits(cand, ver, e, m);
      var s = penalty(cand);
      if (s < bestScore) { bestScore = s; best = cand; }
    }
    return best;
  }

  /* ---------- SVG ---------- */
  function svg(text, opts) {
    opts = opts || {};
    var mods = matrix(text, opts.ecc);
    var n = mods.length;
    var margin = opts.margin == null ? 4 : Math.max(0, Math.floor(opts.margin));
    var dim = n + margin * 2;
    var px = opts.size == null ? dim * 4 : Math.max(1, Math.floor(opts.size));
    var dark = opts.dark || '#000';
    var light = opts.light || '#fff';

    // 每列合併成一條水平線段，全部塞進同一個 <path>
    var d = [], y, x, runStart;
    for (y = 0; y < n; y++) {
      x = 0;
      while (x < n) {
        if (mods[y][x]) {
          runStart = x;
          while (x < n && mods[y][x]) x++;
          d.push('M' + (runStart + margin) + ' ' + (y + margin) +
                 'h' + (x - runStart) + 'v1h-' + (x - runStart) + 'z');
        } else x++;
      }
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
      '" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + light + '"/>' +
      '<path fill="' + dark + '" d="' + d.join('') + '"/></svg>';
  }

  return { matrix: matrix, svg: svg };
});
