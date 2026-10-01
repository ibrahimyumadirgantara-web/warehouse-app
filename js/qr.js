// qr.js — pembaca QR code (2D) tanpa library.
// Alur: citra → hitam-putih → cari 3 pola sudut → grid modul → info format → Reed-Solomon → teks.
// Dipakai sebagai cadangan bila browser tidak punya BarcodeDetector (mis. iPhone/Safari, Firefox).

// Per versi (1..40), per level koreksi (L,M,Q,H): "ecPerBlok,n1,data1[,n2,data2]"
const EC_ROWS = `7,1,19|10,1,16|13,1,13|17,1,9
10,1,34|16,1,28|22,1,22|28,1,16
15,1,55|26,1,44|18,2,17|22,2,13
20,1,80|18,2,32|26,2,24|16,4,9
26,1,108|24,2,43|18,2,15,2,16|22,2,11,2,12
18,2,68|16,4,27|24,4,19|28,4,15
20,2,78|18,4,31|18,2,14,4,15|26,4,13,1,14
24,2,97|22,2,38,2,39|22,4,18,2,19|26,4,14,2,15
30,2,116|22,3,36,2,37|20,4,16,4,17|24,4,12,4,13
18,2,68,2,69|26,4,43,1,44|24,6,19,2,20|28,6,15,2,16
20,4,81|30,1,50,4,51|28,4,22,4,23|24,3,12,8,13
24,2,92,2,93|22,6,36,2,37|26,4,20,6,21|28,7,14,4,15
26,4,107|22,8,37,1,38|24,8,20,4,21|22,12,11,4,12
30,3,115,1,116|24,4,40,5,41|20,11,16,5,17|24,11,12,5,13
22,5,87,1,88|24,5,41,5,42|30,5,24,7,25|24,11,12
24,5,98,1,99|28,7,45,3,46|24,15,19,2,20|30,3,15,13,16
28,1,107,5,108|28,10,46,1,47|28,1,22,15,23|28,2,14,17,15
30,5,120,1,121|26,9,43,4,44|28,17,22,1,23|28,2,14,19,15
28,3,113,4,114|26,3,44,11,45|26,17,21,4,22|26,9,13,16,14
28,3,107,5,108|26,3,41,13,42|30,15,24,5,25|28,15,15,10,16
28,4,116,4,117|26,17,42|28,17,22,6,23|30,19,16,6,17
28,2,111,7,112|28,17,46|30,7,24,16,25|24,34,13
30,4,121,5,122|28,4,47,14,48|30,11,24,14,25|30,16,15,14,16
30,6,117,4,118|28,6,45,14,46|30,11,24,16,25|30,30,16,2,17
26,8,106,4,107|28,8,47,13,48|30,7,24,22,25|30,22,15,13,16
28,10,114,2,115|28,19,46,4,47|28,28,22,6,23|30,33,16,4,17
30,8,122,4,123|28,22,45,3,46|30,8,23,26,24|30,12,15,28,16
30,3,117,10,118|28,3,45,23,46|30,4,24,31,25|30,11,15,31,16
30,7,116,7,117|28,21,45,7,46|30,1,23,37,24|30,19,15,26,16
30,5,115,10,116|28,19,47,10,48|30,15,24,25,25|30,23,15,25,16
30,13,115,3,116|28,2,46,29,47|30,42,24,1,25|30,23,15,28,16
30,17,115|28,10,46,23,47|30,10,24,35,25|30,19,15,35,16
30,17,115,1,116|28,14,46,21,47|30,29,24,19,25|30,11,15,46,16
30,13,115,6,116|28,14,46,23,47|30,44,24,7,25|30,59,16,1,17
30,12,121,7,122|28,12,47,26,48|30,39,24,14,25|30,22,15,41,16
30,6,121,14,122|28,6,47,34,48|30,46,24,10,25|30,2,15,64,16
30,17,122,4,123|28,29,46,14,47|30,49,24,10,25|30,24,15,46,16
30,4,122,18,123|28,13,46,32,47|30,48,24,14,25|30,42,15,32,16
30,20,117,4,118|28,40,47,7,48|30,43,24,22,25|30,10,15,67,16
30,19,118,6,119|28,18,47,31,48|30,34,24,34,25|30,20,15,61,16`.split('\n').map((r) => r.split('|').map((s) => s.split(',').map(Number)));
// Posisi pola alignment per versi (1..40)
const ALIGN = [[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]];

// ---------- GF(256) & Reed-Solomon ----------
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const gdiv = (a, b) => (a ? EXP[(LOG[a] - LOG[b] + 255) % 255] : 0);

// Koreksi kesalahan in-place. true bila berhasil.
function rsCorrect(cw, nsym) {
  const n = cw.length, S = new Array(nsym).fill(0);
  let any = false;
  for (let j = 0; j < nsym; j++) {
    let s = 0;
    for (let k = 0; k < n; k++) s = gmul(s, EXP[j]) ^ cw[k];
    S[j] = s; if (s) any = true;
  }
  if (!any) return true;
  // Berlekamp–Massey
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let i = 0; i < nsym; i++) {
    let d = S[i];
    for (let j = 1; j <= L; j++) d ^= gmul(C[j] || 0, S[i - j]);
    if (d === 0) { m++; continue; }
    const T = C.slice(), coef = gdiv(d, b);
    while (C.length < B.length + m) C.push(0);
    for (let j = 0; j < B.length; j++) C[j + m] ^= gmul(coef, B[j]);
    if (2 * L <= i) { L = i + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  if (L === 0 || L > nsym >> 1) return false;
  // Chien: cari posisi salah
  const pos = [];
  for (let p = 0; p < n; p++) {
    const x = EXP[(255 - (p % 255)) % 255];
    let v = 0, xp = 1;
    for (let j = 0; j < C.length; j++) { v ^= gmul(C[j], xp); xp = gmul(xp, x); }
    if (v === 0) pos.push(p);
  }
  if (pos.length !== L) return false;
  // Forney
  const om = new Array(nsym).fill(0);
  for (let i = 0; i < nsym; i++) for (let j = 0; j < C.length && i + j < nsym; j++) om[i + j] ^= gmul(S[i], C[j]);
  for (const p of pos) {
    const xi = EXP[(255 - (p % 255)) % 255];
    let num = 0, xp = 1;
    for (let j = 0; j < nsym; j++) { num ^= gmul(om[j], xp); xp = gmul(xp, xi); }
    let den = 0; xp = 1;
    for (let j = 1; j < C.length; j += 2) { den ^= gmul(C[j], xp); xp = gmul(xp, gmul(xi, xi)); }
    if (!den) return false;
    cw[n - 1 - p] ^= gmul(EXP[p % 255], gdiv(num, den));
  }
  for (let j = 0; j < nsym; j++) {
    let s = 0;
    for (let k = 0; k < n; k++) s = gmul(s, EXP[j]) ^ cw[k];
    if (s) return false;
  }
  return true;
}

// ---------- Info format ----------
const FORMAT_CODES = [];
for (let data = 0; data < 32; data++) {
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  FORMAT_CODES.push({ code: ((data << 10) | rem) ^ 0x5412, ec: data >> 3, mask: data & 7 });
}
const popcnt = (x) => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };
const EC_INDEX = [1, 0, 3, 2]; // bit format (M=0,L=1,H=2,Q=3) → indeks tabel (L,M,Q,H)

const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (((i >> 1) + Math.floor(j / 3)) % 2) === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => ((((i * j) % 2) + ((i * j) % 3)) % 2) === 0,
  (i, j) => ((((i + j) % 2) + ((i * j) % 3)) % 2) === 0,
];

const fnCache = {};
function functionMask(version) {
  if (fnCache[version]) return fnCache[version];
  const dim = 17 + 4 * version, f = new Uint8Array(dim * dim);
  const fill = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < dim && y < dim) f[y * dim + x] = 1; };
  fill(0, 0, 8, 8); fill(dim - 8, 0, dim - 1, 8); fill(0, dim - 8, 8, dim - 1);
  fill(6, 0, 6, dim - 1); fill(0, 6, dim - 1, 6);
  const pos = ALIGN[version - 1], last = pos.length - 1;
  for (let a = 0; a < pos.length; a++) for (let b = 0; b < pos.length; b++) {
    if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
    fill(pos[b] - 2, pos[a] - 2, pos[b] + 2, pos[a] + 2);
  }
  if (version >= 7) { fill(dim - 11, 0, dim - 9, 5); fill(0, dim - 11, 5, dim - 9); }
  return (fnCache[version] = f);
}

// ---------- Grid → teks ----------
function decodeGrid(g, dim) {
  const version = (dim - 17) / 4;
  if (version < 1 || version > 40 || !Number.isInteger(version)) return null;
  const bit = (x, y) => g[y * dim + x];
  let b1 = 0, b2 = 0;
  const p1 = (x, y) => { b1 = (b1 << 1) | bit(x, y); };
  for (let i = 0; i < 6; i++) p1(i, 8);
  p1(7, 8); p1(8, 8); p1(8, 7);
  for (let j = 5; j >= 0; j--) p1(8, j);
  const p2 = (x, y) => { b2 = (b2 << 1) | bit(x, y); };
  for (let j = dim - 1; j >= dim - 7; j--) p2(8, j);
  for (let i = dim - 8; i < dim; i++) p2(i, 8);
  let best = null, bd = 99;
  for (const f of FORMAT_CODES) {
    const d = Math.min(popcnt(f.code ^ b1), popcnt(f.code ^ b2));
    if (d < bd) { bd = d; best = f; }
  }
  if (!best || bd > 3) return null;

  const fn = functionMask(version), mask = MASKS[best.mask];
  const bytes = [];
  let cur = 0, nb = 0, up = true;
  for (let x = dim - 1; x > 0; x -= 2) {
    if (x === 6) x--;
    for (let k = 0; k < dim; k++) {
      const y = up ? dim - 1 - k : k;
      for (let c = 0; c < 2; c++) {
        const xx = x - c;
        if (fn[y * dim + xx]) continue;
        let v = g[y * dim + xx];
        if (mask(y, xx)) v ^= 1;
        cur = (cur << 1) | v;
        if (++nb === 8) { bytes.push(cur); cur = 0; nb = 0; }
      }
    }
    up = !up;
  }

  const spec = EC_ROWS[version - 1][EC_INDEX[best.ec]];
  const ec = spec[0], blocks = [];
  for (let i = 2; i < spec.length; i += 2) for (let k = 0; k < spec[i - 1]; k++) blocks.push({ data: spec[i], cw: [] });
  const totalCw = blocks.reduce((a, bl) => a + bl.data + ec, 0);
  if (bytes.length < totalCw) return null;
  let idx = 0;
  const maxData = Math.max(...blocks.map((bl) => bl.data));
  for (let i = 0; i < maxData; i++) for (const bl of blocks) if (i < bl.data) bl.cw.push(bytes[idx++]);
  for (let i = 0; i < ec; i++) for (const bl of blocks) bl.cw.push(bytes[idx++]);
  const data = [];
  for (const bl of blocks) {
    const arr = Uint8Array.from(bl.cw);
    if (!rsCorrect(arr, ec)) return null;
    for (let i = 0; i < bl.data; i++) data.push(arr[i]);
  }
  return parsePayload(data, version);
}

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
function parsePayload(data, version) {
  let pos = 0;
  const total = data.length * 8;
  const read = (n) => {
    if (pos + n > total) throw new Error('habis');
    let v = 0;
    for (let i = 0; i < n; i++, pos++) v = (v << 1) | ((data[pos >> 3] >> (7 - (pos & 7))) & 1);
    return v;
  };
  const tier = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  const cnt = { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16], 8: [8, 10, 12] };
  let text = '', raw = [];
  const flush = () => {
    if (!raw.length) return;
    const u = Uint8Array.from(raw); raw = [];
    try { text += new TextDecoder('utf-8', { fatal: true }).decode(u); }
    catch { text += new TextDecoder('iso-8859-1').decode(u); }
  };
  try {
    while (pos + 4 <= total) {
      const mode = read(4);
      if (mode === 0) break;
      if (mode === 7) { const b = read(8); if (b & 0x80) read((b & 0x40) ? 16 : 8); continue; }
      if (mode === 3) { read(16); continue; }
      if (mode === 5) continue;
      if (mode === 9) { read(8); continue; }
      if (!cnt[mode]) return null;
      const n = read(cnt[mode][tier]);
      if (mode === 4) { for (let i = 0; i < n; i++) raw.push(read(8)); }
      else if (mode === 1) {
        flush();
        let left = n;
        while (left >= 3) { text += String(read(10)).padStart(3, '0'); left -= 3; }
        if (left === 2) text += String(read(7)).padStart(2, '0');
        else if (left === 1) text += String(read(4));
      } else if (mode === 2) {
        flush();
        let left = n;
        while (left >= 2) { const v = read(11); text += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; left -= 2; }
        if (left === 1) text += ALNUM[read(6)];
      } else if (mode === 8) {
        flush();
        const sj = [];
        for (let i = 0; i < n; i++) {
          const v = read(13);
          let w = Math.floor(v / 0xc0) * 0x100 + (v % 0xc0);
          w += w + 0x8140 <= 0x9ffc ? 0x8140 : 0xc140;
          sj.push(w >> 8, w & 255);
        }
        try { text += new TextDecoder('shift_jis').decode(Uint8Array.from(sj)); } catch { /* abaikan */ }
      }
    }
  } catch { /* bit habis: pakai yang sudah terbaca */ }
  flush();
  return text || null;
}

// ---------- Hitam-putih ----------
function toGray(d, n) {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 151 + d[j + 2] * 28) >> 8;
  return g;
}
function otsu(g) {
  const h = new Int32Array(256);
  for (let i = 0; i < g.length; i++) h[g[i]]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * h[i];
  let wb = 0, sb = 0, best = 0, bt = 127;
  for (let t = 0; t < 256; t++) {
    wb += h[t]; if (!wb) continue;
    const wf = g.length - wb; if (!wf) break;
    sb += t * h[t];
    const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) * (mb - mf);
    if (v > best) { best = v; bt = t; }
  }
  return bt;
}
function binarize(g, w, h, mode) {
  const bin = new Uint8Array(w * h), T = otsu(g);
  if (mode === 'otsu') {
    for (let i = 0; i < bin.length; i++) bin[i] = g[i] <= T ? 1 : 0;
    return bin;
  }
  // lokal: rata-rata jendela besar lewat integral image (tahan bayangan/cahaya tak merata)
  const W = w + 1, I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) / 8));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
      const mean = s / ((x1 - x0) * (y1 - y0)), v = g[y * w + x];
      bin[y * w + x] = v < mean * 0.9 || v < T * 0.45 ? 1 : 0;
    }
  }
  return bin;
}

// ---------- Pencari pola (finder 1:1:3:1:1, alignment 1:1:1:1:1) ----------
function crossCheck(bin, w, h, x, y, dx, dy, ratios) {
  const n = ratios.length, mid = n >> 1, lens = new Array(n).fill(0);
  const ok = (a, b) => a >= 0 && b >= 0 && a < w && b < h;
  let px = x, py = y, col = 1;
  while (ok(px, py) && bin[py * w + px] === col) { lens[mid]++; px -= dx; py -= dy; }
  const back = lens[mid];
  for (let i = mid - 1; i >= 0; i--) {
    col ^= 1;
    while (ok(px, py) && bin[py * w + px] === col) { lens[i]++; px -= dx; py -= dy; }
    if (!lens[i]) return null;
  }
  px = x + dx; py = y + dy; col = 1;
  let fwd = 0;
  while (ok(px, py) && bin[py * w + px] === col) { fwd++; px += dx; py += dy; }
  lens[mid] += fwd;
  for (let i = mid + 1; i < n; i++) {
    col ^= 1;
    while (ok(px, py) && bin[py * w + px] === col) { lens[i]++; px += dx; py += dy; }
    if (!lens[i]) return null;
  }
  const mod = matchRatios(lens, ratios);
  if (!mod) return null;
  return { off: (fwd - back + 1) / 2, mod };
}
function matchRatios(lens, ratios) {
  let sum = 0, rs = 0;
  for (let i = 0; i < lens.length; i++) { sum += lens[i]; rs += ratios[i]; }
  if (sum < rs) return 0;
  const mod = sum / rs;
  for (let i = 0; i < lens.length; i++) {
    const tol = mod * (ratios[i] > 1 ? 0.9 : 0.55);
    if (Math.abs(lens[i] - ratios[i] * mod) > tol) return 0;
  }
  return mod;
}
function findPatterns(bin, w, h, ratios, box) {
  const n = ratios.length, mid = n >> 1, out = [];
  const starts = [], lens = [];
  for (let y = box.y0; y < box.y1; y++) {
    starts.length = 0; lens.length = 0;
    const row = y * w;
    let cur = bin[row + box.x0], s = box.x0;
    for (let x = box.x0 + 1; x < box.x1; x++) {
      const v = bin[row + x];
      if (v !== cur) { starts.push(s); lens.push(x - s); cur = v; s = x; }
    }
    starts.push(s); lens.push(box.x1 - s);
    const firstBlack = bin[row + box.x0] === 1 ? 0 : 1;
    for (let i = firstBlack; i + n <= lens.length; i += 2) {
      if (matchRatios(lens.slice(i, i + n), ratios)) {
        const cx0 = Math.round(starts[i + mid] + (lens[i + mid] - 1) / 2);
        const v = crossCheck(bin, w, h, cx0, y, 0, 1, ratios);
        if (!v) continue;
        const cy = y + v.off, cyi = Math.round(cy);
        const hz = crossCheck(bin, w, h, cx0, cyi, 1, 0, ratios);
        if (!hz) continue;
        const cx = cx0 + hz.off, mod = (v.mod + hz.mod) / 2;
        if (Math.abs(v.mod - hz.mod) > mod * 0.4) continue;
        let m = null;
        for (const c of out) if (Math.abs(c.x - cx) < mod && Math.abs(c.y - cy) < mod && Math.abs(c.mod - mod) < mod * 0.5) { m = c; break; }
        if (m) { const k = m.n; m.x = (m.x * k + cx) / (k + 1); m.y = (m.y * k + cy) / (k + 1); m.mod = (m.mod * k + mod) / (k + 1); m.n++; }
        else out.push({ x: cx, y: cy, mod, n: 1 });
      }
    }
  }
  return out;
}

// ---------- Transformasi proyektif ----------
function homography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i], [x, y] = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const H = A.map((r, i) => r[8] / r[i]);
  return (u, v) => {
    const d = H[6] * u + H[7] * v + 1;
    return [(H[0] * u + H[1] * v + H[2]) / d, (H[3] * u + H[4] * v + H[5]) / d];
  };
}

function sampleGrid(bin, w, h, dim, map) {
  const g = new Uint8Array(dim * dim);
  const offs = [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];
  for (let r = 0; r < dim; r++) for (let c = 0; c < dim; c++) {
    let black = 0;
    for (const [dx, dy] of offs) {
      const [x, y] = map(c + dx, r + dy), xi = Math.floor(x), yi = Math.floor(y);
      if (xi >= 0 && yi >= 0 && xi < w && yi < h && bin[yi * w + xi]) black++;
    }
    g[r * dim + c] = black >= 3 ? 1 : 0;
  }
  return g;
}

let deadline = 0; // batas waktu satu kali decode (ms) agar ponsel lambat tidak tersendat
const late = () => performance.now() > deadline;

function tryTriple(bin, w, h, tl, tr, bl) {
  const dTR = Math.hypot(tr.x - tl.x, tr.y - tl.y), dBL = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const mod = (tl.mod + tr.mod + bl.mod) / 3;
  const est = ((dTR + dBL) / 2) / mod + 7;
  const base = Math.round((est - 17) / 4) * 4 + 17;
  const tried = new Set();
  for (const dim of [base, base + 4, base - 4]) {
    if (dim < 21 || dim > 177 || tried.has(dim)) continue;
    tried.add(dim);
    const version = (dim - 17) / 4, near = dim - 3.5;
    const src3 = [[3.5, 3.5], [near, 3.5], [3.5, near]], dst3 = [[tl.x, tl.y], [tr.x, tr.y], [bl.x, bl.y]];
    const corner = [tr.x + bl.x - tl.x, tr.y + bl.y - tl.y];
    const aff = homography([...src3, [near, near]], [...dst3, corner]);
    if (!aff) continue;
    // Titik ke-4: pola alignment asli (versi >= 2) atau sudut perkiraan (versi 1).
    let s4 = [near, near], d4 = corner, step = mod * 0.5, span = 3;
    if (version >= 2) {
      const [px, py] = aff(dim - 6.5, dim - 6.5), rad = Math.ceil(mod * 4);
      const box = { x0: Math.max(0, Math.floor(px - rad)), y0: Math.max(0, Math.floor(py - rad)), x1: Math.min(w, Math.ceil(px + rad)), y1: Math.min(h, Math.ceil(py + rad)) };
      const found = findPatterns(bin, w, h, [1, 1, 1, 1, 1], box)
        .filter((c) => c.n >= 2 && c.mod > mod * 0.5 && c.mod < mod * 2)
        .sort((p, q) => Math.hypot(p.x - px, p.y - py) - Math.hypot(q.x - px, q.y - py));
      if (found.length) { s4 = [dim - 6.5, dim - 6.5]; d4 = [found[0].x, found[0].y]; step = mod * 0.35; span = 2; }
      else { d4 = [px, py]; s4 = [dim - 6.5, dim - 6.5]; step = mod * 0.6; span = 3; }
    }
    // Coba titik tepat dulu, lalu geser sedikit (mengatasi sudut pandang miring).
    const offs = [];
    for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) offs.push([i, j]);
    offs.sort((p, q) => (p[0] * p[0] + p[1] * p[1]) - (q[0] * q[0] + q[1] * q[1]));
    for (const [i, j] of offs) {
      if (late()) return null;
      const map = homography([...src3, s4], [...dst3, [d4[0] + i * step, d4[1] + j * step]]);
      if (!map) continue;
      const text = decodeGrid(sampleGrid(bin, w, h, dim, map), dim);
      if (text) return text;
    }
  }
  return null;
}

function decodeBinary(bin, w, h) {
  let c = findPatterns(bin, w, h, [1, 1, 3, 1, 1], { x0: 0, y0: 0, x1: w, y1: h }).filter((p) => p.n >= 2);
  if (c.length < 3) return null;
  c.sort((a, b) => b.n - a.n);
  c = c.slice(0, 9);
  const triples = [];
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) for (let k = j + 1; k < c.length; k++) {
    const P = [c[i], c[j], c[k]];
    const ms = P.map((p) => p.mod);
    if (Math.max(...ms) > Math.min(...ms) * 1.6) continue;
    // titik sudut kiri-atas = yang berhadapan dengan sisi terpanjang
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const sides = [d(P[1], P[2]), d(P[0], P[2]), d(P[0], P[1])];
    const li = sides.indexOf(Math.max(...sides));
    const tl = P[li], o = P.filter((_, idx) => idx !== li);
    const a = d(tl, o[0]), b = d(tl, o[1]), hyp = sides[li];
    const err = Math.abs(a - b) / Math.max(a, b) + Math.abs(hyp - Math.hypot(a, b)) / hyp;
    if (err > 0.5) continue;
    const cross = (o[0].x - tl.x) * (o[1].y - tl.y) - (o[0].y - tl.y) * (o[1].x - tl.x);
    triples.push({ err, tl, tr: cross > 0 ? o[0] : o[1], bl: cross > 0 ? o[1] : o[0] });
  }
  triples.sort((p, q) => p.err - q.err);
  for (const t of triples.slice(0, 3)) {
    if (late()) return null;
    const text = tryTriple(bin, w, h, t.tl, t.tr, t.bl);
    if (text) return text;
  }
  return null;
}

// ---------- API ----------
// Menerima { data, width, height } (RGBA). Mengembalikan { text } atau null.
export function decodeImageData({ data, width, height }) {
  deadline = performance.now() + 220;
  const gray = toGray(data, width * height);
  for (const mode of ['otsu', 'local']) {
    const bin = binarize(gray, width, height, mode);
    let text = decodeBinary(bin, width, height);
    if (text) return { text };
    if (mode === 'local') {
      for (let i = 0; i < bin.length; i++) bin[i] ^= 1; // QR terbalik (terang di atas gelap)
      text = decodeBinary(bin, width, height);
      if (text) return { text };
    }
  }
  return null;
}
export function decodeCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
}
