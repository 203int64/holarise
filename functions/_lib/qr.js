/**
 * Minimal, standards-compliant QR Code (ISO/IEC 18004, Byte mode, ECC Level L, Versions 1-6)
 * Pure ESM with zero external dependencies — runs on Cloudflare Workers & Node.js.
 */

const VERSION_INFO = {
  1: { size: 21, dataCodewords: 19, ecCodewords: 7, align: [] },
  2: { size: 25, dataCodewords: 34, ecCodewords: 10, align: [6, 18] },
  3: { size: 29, dataCodewords: 55, ecCodewords: 15, align: [6, 22] },
  4: { size: 33, dataCodewords: 80, ecCodewords: 20, align: [6, 26] },
  5: { size: 37, dataCodewords: 108, ecCodewords: 26, align: [6, 30] },
  6: { size: 41, dataCodewords: 136, ecCodewords: 36, align: [6, 34] },
};

// GF(256) exp/log tables with primitive polynomial 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function pickVersion(byteLen) {
  for (let v = 1; v <= 6; v++) {
    // 4-bit mode + 8-bit length + bytes + 4-bit terminator
    const capacityBytes = VERSION_INFO[v].dataCodewords - 2;
    if (byteLen <= capacityBytes) return v;
  }
  throw new Error("QR payload exceeds Version 6 capacity");
}

function encodeDataCodewords(bytes, version) {
  const { dataCodewords } = VERSION_INFO[version];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);

  const totalBits = dataCodewords * 8;
  const termLen = Math.min(4, totalBits - bits.length);
  pushBits(0, termLen);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let cw = 0;
    for (let j = 0; j < 8; j++) cw = (cw << 1) | bits[i + j];
    codewords.push(cw);
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (codewords.length < dataCodewords) {
    codewords.push(pads[p % 2]);
    p++;
  }
  return new Uint8Array(codewords);
}

function encodeCodewordsWithEc(dataCodewords, version) {
  const { ecCodewords } = VERSION_INFO[version];
  // Versions 1-5 ECC-L use 1 block; Version 6 ECC-L uses 2 blocks of 68 data + 18 EC each
  if (version === 6) {
    const b1 = dataCodewords.slice(0, 68);
    const b2 = dataCodewords.slice(68, 136);
    const ec1 = rsRemainder(b1, 18);
    const ec2 = rsRemainder(b2, 18);
    const out = [];
    for (let i = 0; i < 68; i++) {
      out.push(b1[i], b2[i]);
    }
    for (let i = 0; i < 18; i++) {
      out.push(ec1[i], ec2[i]);
    }
    return new Uint8Array(out);
  }
  const ec = rsRemainder(dataCodewords, ecCodewords);
  const out = new Uint8Array(dataCodewords.length + ec.length);
  out.set(dataCodewords, 0);
  out.set(ec, dataCodewords.length);
  return out;
}

function buildFunctionMatrix(version) {
  const { size, align } = VERSION_INFO[version];
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunc = (r, c, val) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = val ? 1 : 0;
    isFunc[r][c] = 1;
  };

  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const isDark =
          inOuter &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFunc(r, c, isDark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  for (const ar of align) {
    for (const ac of align) {
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6)) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFunc(ar + dr, ac + dc, dist !== 1);
        }
      }
    }
  }

  // Reserve format info areas + dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunc(8, i, 0);
      setFunc(i, 8, 0);
    }
  }
  for (let i = size - 8; i < size; i++) {
    setFunc(8, i, 0);
    setFunc(i, 8, 0);
  }
  setFunc(size - 8, 8, 1);

  return { size, modules, isFunc };
}

function drawFormatBits(modules, size, maskId) {
  // ECC Level L = 01 (bits 4..3), maskId (bits 2..0)
  const data = (0b01 << 3) | (maskId & 0b111);
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
  }
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) modules[8][i] = (bits >>> (14 - i)) & 1;
  modules[8][7] = (bits >>> 8) & 1;
  modules[8][8] = (bits >>> 7) & 1;
  modules[7][8] = (bits >>> 6) & 1;
  for (let i = 9; i < 15; i++) modules[14 - i][8] = (bits >>> (14 - i)) & 1;

  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = (bits >>> i) & 1;
  for (let i = 0; i < 7; i++) modules[size - 7 + i][8] = (bits >>> (14 - i)) & 1;
}

function applyDataAndMask(base, allCodewords, maskId) {
  const { size, isFunc } = base;
  const modules = base.modules.map((row) => new Uint8Array(row));
  let bitIdx = 0;
  const totalBits = allCodewords.length * 8;

  const maskFn = (r, c) => {
    switch (maskId) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };

  let upward = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (isFunc[row][c]) continue;
        let bit = 0;
        if (bitIdx < totalBits) {
          bit = (allCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
        modules[row][c] = maskFn(row, c) ? bit ^ 1 : bit;
      }
    }
    upward = !upward;
  }

  drawFormatBits(modules, size, maskId);
  return modules;
}

function penaltyScore(modules, size) {
  let score = 0;
  // Rule 1: runs of 5+
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (modules[r][c] === modules[r][c - 1]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        run = 1;
      }
    }
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (modules[r][c] === modules[r - 1][c]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        run = 1;
      }
    }
  }
  // Rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }
  return score;
}

export function generateQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  const version = pickVersion(bytes.length);
  const dataCw = encodeDataCodewords(bytes, version);
  const allCw = encodeCodewordsWithEc(dataCw, version);
  const base = buildFunctionMatrix(version);

  let bestModules = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyDataAndMask(base, allCw, mask);
    const s = penaltyScore(candidate, base.size);
    if (s < bestScore) {
      bestScore = s;
      bestModules = candidate;
    }
  }
  return { size: base.size, modules: bestModules };
}

export function generateQrSvg(text, { quietZone = 3, fg = "#0B110F", bg = "#FFFFFF", sizePx = 168, label = "Mã QR thẻ thành viên" } = {}) {
  const { size, modules } = generateQrMatrix(text);
  const dim = size + quietZone * 2;
  const parts = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        parts.push(`M${c + quietZone},${r + quietZone}h1v1h-1z`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${sizePx}" height="${sizePx}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="${bg}"/><path d="${parts.join("")}" fill="${fg}"/></svg>`;
}
