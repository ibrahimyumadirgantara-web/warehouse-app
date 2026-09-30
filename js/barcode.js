// barcode.js — pembaca barcode 1D tanpa library: Code 128, Code 39, EAN-13.
// Dipakai sebagai cadangan bila browser tidak punya BarcodeDetector (mis. iPhone/Safari, Firefox).
// QR tidak didukung di sini; QR dibaca lewat BarcodeDetector di browser yang mendukungnya.

const C128 = ('212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,' +
  '123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,' +
  '131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,' +
  '213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,' +
  '112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,' +
  '421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,2331112')
  .split(',').map((s) => [...s].map(Number));

const C39 = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw',
  E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww',
  M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn', $: 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};
const C39_REV = Object.fromEntries(Object.entries(C39).map(([k, v]) => [v, k]));

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_R = EAN_L.map((p) => [...p].map((b) => (b === '0' ? '1' : '0')).join(''));
const EAN_G = EAN_R.map((p) => [...p].reverse().join(''));
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

// ---------- Scanline → run-length ----------
// Hasil: lebar bar/spasi bergantian, mulai dari bar dan berakhir di bar.
function slide(lum, w, pop) {
  const n = lum.length, out = new Float32Array(n), dq = new Int32Array(n);
  let h = 0, t = 0, r = 0;
  for (let i = 0; i < n; i++) {
    const edge = Math.min(n - 1, i + w);
    while (r <= edge) { while (t > h && pop(lum[dq[t - 1]], lum[r])) t--; dq[t++] = r++; }
    while (dq[h] < i - w) h++;
    out[i] = lum[dq[h]];
  }
  return out;
}

export function toRuns(lum) {
  const n = lum.length;
  // Ambang = tengah antara terang & gelap di sekitar piksel → tahan terhadap buram dan tepi simbol.
  const w = Math.max(15, Math.floor(n / 8));
  const mn = slide(lum, w, (a, b) => a >= b), mx = slide(lum, w, (a, b) => a <= b);
  const runs = [];
  let cur = null, len = 0, started = false;
  for (let i = 0; i < n; i++) {
    const black = mx[i] - mn[i] >= 40 && lum[i] < (mx[i] + mn[i]) / 2;
    if (!started) { if (!black) continue; started = true; cur = true; len = 0; }
    if (black === cur) len++;
    else { runs.push(len); cur = black; len = 1; }
  }
  if (started) runs.push(len);
  if (runs.length % 2 === 0) runs.pop(); // buang spasi di ujung: array mulai & berakhir di bar
  return runs;
}

const sum = (a, s, e) => { let t = 0; for (let i = s; i < e; i++) t += a[i]; return t; };
const quietOk = (runs, i) => i === 0 || runs[i - 1] >= 0.8 * (sum(runs, i, Math.min(runs.length, i + 6)) / 11) * 3;

// ---------- Code 128 ----------
function match128(runs, i, patIdx) {
  const pat = C128[patIdx], n = pat.length;
  if (i + n > runs.length) return 9;
  const unit = sum(runs, i, i + n) / (n === 7 ? 13 : 11);
  let worst = 0;
  for (let k = 0; k < n; k++) worst = Math.max(worst, Math.abs(runs[i + k] / unit - pat[k]));
  return worst;
}
function best128(runs, i) {
  let bi = -1, be = 0.75;
  for (let c = 0; c < 106; c++) { const e = match128(runs, i, c); if (e < be) { be = e; bi = c; } }
  return bi;
}
function text128(codes, start) {
  let set = start === 103 ? 'A' : start === 104 ? 'B' : 'C';
  let out = '', shift = false;
  for (const v of codes) {
    if (set === 'C') {
      if (v < 100) out += String(v).padStart(2, '0');
      else if (v === 100) set = 'B'; else if (v === 101) set = 'A';
      continue;
    }
    if (v === 99) { set = 'C'; continue; }
    if (v === 100 && set === 'A') { set = 'B'; continue; }
    if (v === 101 && set === 'B') { set = 'A'; continue; }
    if (v === 98) { shift = true; continue; }
    if (v >= 96) continue; // FNC / kode khusus
    const useA = shift ? set === 'B' : set === 'A';
    shift = false;
    out += useA ? (v < 64 ? String.fromCharCode(v + 32) : String.fromCharCode(v - 64)) : String.fromCharCode(v + 32);
  }
  return out;
}
function decode128(runs) {
  for (let i = 0; i + 6 + 6 + 7 <= runs.length; i += 2) {
    let start = -1;
    for (const s of [104, 103, 105]) if (match128(runs, i, s) < 0.7) { start = s; break; }
    if (start < 0 || !quietOk(runs, i)) continue;
    const vals = [start];
    let p = i + 6, ok = false;
    while (p + 7 <= runs.length) {
      if (vals.length >= 3 && match128(runs, p, 106) < 0.7) { ok = true; break; }
      const c = best128(runs, p);
      if (c < 0) break;
      vals.push(c); p += 6;
    }
    if (!ok || vals.length < 3) continue;
    const check = vals.pop();
    let total = vals[0];
    for (let k = 1; k < vals.length; k++) total += vals[k] * k;
    if (total % 103 !== check) continue;
    const text = text128(vals.slice(1), start);
    if (text) return { text, format: 'code_128' };
  }
  return null;
}

// ---------- Code 39 ----------
function char39(runs, i) {
  const w = runs.slice(i, i + 9);
  const order = w.map((v, k) => [v, k]).sort((a, b) => b[0] - a[0]);
  if (order[2][0] < order[3][0] * 1.4) return null; // lebar & sempit tidak jelas
  const wide = new Set(order.slice(0, 3).map((x) => x[1]));
  return C39_REV[w.map((_, k) => (wide.has(k) ? 'w' : 'n')).join('')] || null;
}
function decode39(runs) {
  for (let i = 0; i + 9 * 3 + 2 <= runs.length; i += 2) {
    if (char39(runs, i) !== '*') continue;
    if (i > 0 && runs[i - 1] < 2 * Math.min(...runs.slice(i, i + 9))) continue;
    let p = i + 10, out = '', ok = false;
    while (p + 9 <= runs.length) {
      const c = char39(runs, p);
      if (c === null) break;
      if (c === '*') { ok = true; break; }
      out += c; p += 10;
    }
    if (ok && out) return { text: out, format: 'code_39' };
  }
  return null;
}

// ---------- EAN-13 ----------
function decodeEan13(runs) {
  for (let i = 0; i + 59 <= runs.length; i += 2) {
    const unit = (runs[i] + runs[i + 1] + runs[i + 2]) / 3;
    if ([0, 1, 2].some((k) => Math.abs(runs[i + k] / unit - 1) > 0.5)) continue;
    if (!quietOk(runs, i)) continue;
    const digit = (start, tables) => {
      const u = sum(runs, start, start + 4) / 7;
      let bits = '';
      for (let k = 0; k < 4; k++) {
        const w = Math.round(runs[start + k] / u);
        if (w < 1 || w > 4) return null;
        bits += (tables.first === 'space' ? (k % 2 === 0 ? '0' : '1') : (k % 2 === 0 ? '1' : '0')).repeat(w);
      }
      if (bits.length !== 7) return null;
      return bits;
    };
    let ok = true, parity = '', digits = [];
    for (let d = 0; d < 6 && ok; d++) {
      const bits = digit(i + 3 + d * 4, { first: 'space' });
      const l = bits ? EAN_L.indexOf(bits) : -1, g = bits ? EAN_G.indexOf(bits) : -1;
      if (l >= 0) { parity += 'L'; digits.push(l); } else if (g >= 0) { parity += 'G'; digits.push(g); } else ok = false;
    }
    if (!ok) continue;
    const first = EAN_PARITY.indexOf(parity);
    if (first < 0) continue;
    for (let d = 0; d < 6 && ok; d++) {
      const bits = digit(i + 3 + 24 + 5 + d * 4, { first: 'bar' });
      const r = bits ? EAN_R.indexOf(bits) : -1;
      if (r >= 0) digits.push(r); else ok = false;
    }
    if (!ok) continue;
    const all = [first, ...digits];
    const chk = (10 - (all.slice(0, 12).reduce((s, v, k) => s + v * (k % 2 ? 3 : 1), 0) % 10)) % 10;
    if (chk !== all[12]) continue;
    return { text: all.join(''), format: 'ean_13' };
  }
  return null;
}

export function decodeRuns(runs) {
  if (runs.length < 20) return null;
  const rev = runs.slice().reverse();
  for (const r of [runs, rev]) {
    const hit = decode128(r) || decodeEan13(r) || decode39(r);
    if (hit) return hit;
  }
  return null;
}

// ---------- Gambar ----------
// data: RGBA (ImageData.data). Membaca beberapa garis pindai di tengah gambar.
export function decodeImageData({ data, width, height }, lines = 17) {
  const lum = new Float32Array(width);
  for (let l = 0; l < lines; l++) {
    const y = Math.floor(height * (0.2 + (0.6 * l) / (lines - 1)));
    lum.fill(0);
    for (let dy = -1; dy <= 1; dy++) {
      const yy = Math.min(height - 1, Math.max(0, y + dy)) * width * 4;
      for (let x = 0; x < width; x++) {
        const o = yy + x * 4;
        lum[x] += (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 3000;
      }
    }
    const hit = decodeRuns(toRuns(lum));
    if (hit) return hit;
  }
  return null;
}

export function decodeCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
}
