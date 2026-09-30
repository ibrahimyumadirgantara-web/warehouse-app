// sheets.js — logika murni: baca tabel Part/BOM dari baris Excel, validasi, dan susun sheet ekspor/template.

export const PART_HEADERS = ['No Item', 'Nama Part', 'Spesifikasi', 'Total Qty', 'Rak', 'Kolom', 'Baris'];
const WIDTHS = [18, 30, 32, 12, 8, 8, 8];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const str = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v).trim());
const isBlank = (r) => !r || r.every((c) => c === '' || c === null || c === undefined);

// Urutan sinonim = prioritas (mis. "No Item" didahulukan dari "No" saja).
const SYN = {
  no: ['noitem', 'nomoritem', 'kodeitem', 'kodepart', 'nopart', 'partno', 'itemno', 'item', 'kode', 'no'],
  name: ['namapart', 'namabarang', 'namaitem', 'nama', 'name', 'deskripsi', 'description'],
  spec: ['spesifikasi', 'spec', 'specification', 'ukuran', 'keterangan'],
  qty: ['totalqty', 'qty', 'stok', 'stock', 'jumlah', 'quantity', 'totalstok'],
  rack: ['rak', 'rack'],
  col: ['kolom', 'col', 'column'],
  row: ['baris', 'row'],
  loc: ['lokasi', 'location', 'bin'],
};
const PRODUCT_NAME = ['namaproduk', 'produk', 'productname', 'product'];
const PRODUCT_NO = ['noitemproduk', 'noproduk', 'kodeproduk', 'productno', 'nomorproduk', 'noitemproduct'];

function headerMap(row) {
  const keys = (row || []).map(norm);
  const map = {};
  for (const [f, syns] of Object.entries(SYN)) {
    for (const s of syns) {
      const i = keys.indexOf(s);
      if (i >= 0) { map[f] = i; break; }
    }
  }
  return map;
}
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const map = headerMap(rows[i]);
    if (map.no !== undefined && map.name !== undefined && Object.keys(map).length >= 3) return { index: i, map };
  }
  return null;
}

function parseQty(v) {
  if (v === '' || v === null || v === undefined) return { qty: 0 };
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return { err: 'Qty bukan angka' };
  if (!Number.isInteger(n)) return { err: 'Qty harus bilangan bulat' };
  if (n < 0) return { err: 'Qty tidak boleh negatif' };
  return { qty: n };
}

// Baca baris data di bawah header → item mentah + kesalahan lokasi (dinilai oleh pemanggil).
function readLines(rows, hi, racks) {
  const out = [];
  let samples = 0;
  for (let i = hi.index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (isBlank(r)) continue;
    const g = (f) => (hi.map[f] === undefined ? '' : r[hi.map[f]]);
    const line = i + 1;
    const no = str(g('no'));
    if (!no) { out.push({ line, err: 'No item kosong' }); continue; }
    if (/^contoh[-_ ]/i.test(no)) { samples++; continue; }
    const q = parseQty(g('qty'));
    let rack = str(g('rack')).toUpperCase(), col = str(g('col')), row = str(g('row'));
    if (!rack && !col && !row && hi.map.loc !== undefined) {
      const m = /^([A-Za-z])([1-9])([1-9])$/.exec(str(g('loc')).replace(/\s/g, ''));
      if (m) { rack = m[1].toUpperCase(); col = m[2]; row = m[3]; }
    }
    let loc = { rack: '', col: null, row: null }, locErr = '';
    if (rack || col || row) {
      const rk = racks.find((x) => x.id === rack);
      const c = Number(col), rw = Number(row);
      if (!rack || !col || !row) locErr = 'Lokasi belum lengkap (rak, kolom, dan baris harus terisi semua)';
      else if (!rk) locErr = `Rak ${rack} belum ada di denah`;
      else if (!Number.isInteger(c) || c < 1 || c > rk.cols || !Number.isInteger(rw) || rw < 1 || rw > rk.rows) {
        locErr = `Kolom/baris di luar ukuran Rak ${rack} (${rk.cols} kolom × ${rk.rows} baris)`;
      } else loc = { rack, col: c, row: rw };
    }
    out.push({ line, no, name: str(g('name')), spec: str(g('spec')), qty: q.qty, qtyErr: q.err || '', ...loc, locErr });
  }
  return { items: out, samples };
}

const usable = (sheets) => sheets.filter((s) => !/^petunjuk|^panduan|^readme/i.test(s.name));

// ---------- Part ----------
export function parsePartSheets(sheets, racks) {
  for (const sh of usable(sheets)) {
    const hi = findHeader(sh.rows);
    if (!hi) continue;
    const { items, samples } = readLines(sh.rows, hi, racks);
    const rows = [], errors = [], seen = new Set();
    let noLocation = 0;
    for (const it of items) {
      if (it.err) { errors.push({ line: it.line, msg: it.err }); continue; }
      const bad = it.qtyErr || it.locErr || (!it.name ? 'Nama part kosong' : '') || (seen.has(it.no) ? 'No item ganda di file ini' : '');
      if (bad) { errors.push({ line: it.line, no: it.no, msg: bad }); continue; }
      seen.add(it.no);
      if (!it.rack) noLocation++;
      rows.push({ no: it.no, name: it.name, spec: it.spec, qty: it.qty, rack: it.rack, col: it.col, row: it.row });
    }
    return { ok: true, sheet: sh.name, rows, errors, samples, noLocation };
  }
  return { ok: false, error: 'Header tidak ditemukan. Kolom wajib: "No Item" dan "Nama Part". Unduh template untuk contoh format.' };
}

// ---------- BOM ----------
function findMeta(rows) {
  const meta = { name: '', no: '' };
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i] || [];
    for (let j = 0; j < r.length; j++) {
      const k = norm(r[j]);
      if (!k) continue;
      const val = () => { for (let x = j + 1; x < r.length; x++) if (str(r[x]) !== '') return str(r[x]); return ''; };
      if (!meta.name && PRODUCT_NAME.includes(k)) meta.name = val();
      else if (!meta.no && PRODUCT_NO.includes(k)) meta.no = val();
    }
  }
  return meta;
}

export function parseBomSheets(sheets, racks, parts) {
  const have = new Map(parts.map((p) => [p.no, p]));
  const results = [];
  for (const sh of usable(sheets)) {
    const res = { sheet: sh.name, ok: false, error: '', errors: [], warnings: [], newParts: [], samples: 0 };
    results.push(res);
    const meta = findMeta(sh.rows);
    const hi = findHeader(sh.rows);
    if (!meta.name || !meta.no) { res.error = 'Baris atas harus berisi "Nama Produk" dan "No Item Produk" beserta nilainya.'; continue; }
    if (!hi) { res.error = 'Header tabel part tidak ditemukan (kolom wajib: No Item, Nama Part, Total Qty).'; continue; }
    const { items, samples } = readLines(sh.rows, hi, racks);
    res.samples = samples;
    const lines = new Map(), fresh = new Map();
    for (const it of items) {
      if (it.err) { res.errors.push({ line: it.line, msg: it.err }); continue; }
      if (it.qtyErr) { res.errors.push({ line: it.line, no: it.no, msg: it.qtyErr }); continue; }
      if (!(it.qty > 0)) { res.errors.push({ line: it.line, no: it.no, msg: 'Qty per produk harus lebih dari 0' }); continue; }
      const cur = have.get(it.no);
      if (!cur && !fresh.has(it.no)) {
        if (!it.name) { res.errors.push({ line: it.line, no: it.no, msg: 'Part belum ada di sistem dan namanya kosong' }); continue; }
        let { rack, col, row } = it;
        if (it.locErr) { res.warnings.push({ line: it.line, no: it.no, msg: `${it.locErr}. Part dibuat tanpa lokasi.` }); rack = ''; col = null; row = null; }
        fresh.set(it.no, { no: it.no, name: it.name, spec: it.spec, qty: 0, rack, col, row });
      }
      if (lines.has(it.no)) {
        lines.get(it.no).qty += it.qty;
        res.warnings.push({ line: it.line, no: it.no, msg: 'No item muncul lebih dari sekali; qty dijumlahkan.' });
      } else lines.set(it.no, { no: it.no, qty: it.qty, name: (cur && cur.name) || it.name });
    }
    if (!lines.size) { res.error = 'Tidak ada baris part yang valid.'; continue; }
    res.ok = true;
    res.newParts = [...fresh.values()];
    res.bom = { id: meta.no, product_no: meta.no, product_name: meta.name, lines: [...lines.values()] };
  }
  return results;
}

// ---------- Ekspor ----------
const H = () => PART_HEADERS.map((v) => ({ v, s: 'h' }));
const byNo = (a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true });

export function partsToSheet(parts) {
  return {
    name: 'Part', freeze: 1, widths: WIDTHS,
    rows: [H(), ...parts.slice().sort(byNo).map((p) => [p.no, p.name, p.spec || '', Number(p.qty) || 0, p.rack || '', p.col ?? '', p.row ?? ''])],
  };
}

export function safeSheetName(name, used) {
  let base = String(name).replace(/[\[\]:*?/\\]/g, '-').trim().slice(0, 31) || 'BOM';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  used.add(n.toLowerCase());
  return n;
}

export function bomToSheet(bom, parts, name) {
  const map = new Map(parts.map((p) => [p.no, p]));
  return {
    name, freeze: 3, widths: WIDTHS,
    rows: [
      [{ v: 'Nama Produk', s: 'label' }, bom.product_name, { v: 'No Item Produk', s: 'label' }, bom.product_no],
      [],
      H(),
      ...bom.lines.map((l) => {
        const p = map.get(l.no) || {};
        return [l.no, p.name || l.name || '', p.spec || '', l.qty, p.rack || '', p.col ?? '', p.row ?? ''];
      }),
    ],
  };
}

export function bomsToSheets(boms, parts) {
  const used = new Set();
  return boms.map((b) => bomToSheet(b, parts, safeSheetName(b.product_no, used)));
}

// ---------- Template (satu baris contoh, awalan CONTOH- otomatis dilewati saat impor) ----------
const NOTE = (v) => ({ v, s: 'note' });

export function partTemplate() {
  return [
    {
      name: 'Part', freeze: 1, widths: WIDTHS,
      rows: [H(), ['CONTOH-001', 'Baut M8 x 20', 'Baja galvanis, panjang 20 mm', 120, 'A', 1, 3]],
    },
    {
      name: 'Petunjuk', widths: [96],
      rows: [
        [{ v: 'Petunjuk pengisian — Part', s: 'label' }],
        ['Isi data mulai baris 2 pada sheet "Part". Baris contoh (No Item berawalan CONTOH-) dilewati otomatis saat impor.'],
        ['No Item dan Nama Part wajib diisi. No Item harus unik (ini juga isi barcode yang akan dipindai).'],
        ['Total Qty: jumlah stok saat ini, bilangan bulat (0 atau lebih). Kosong dianggap 0.'],
        ['Rak, Kolom, Baris: lokasi part. Rak berupa satu huruf yang sudah ada di denah, kolom dan baris berupa angka 1–9.'],
        ['Contoh: Rak A, Kolom 1, Baris 3 → kode lokasi A13. Boleh dikosongkan bila lokasi belum ditentukan.'],
        ['Kolom "Lokasi" dengan kode seperti A13 juga dikenali bila kolom Rak/Kolom/Baris tidak ada.'],
        [NOTE('Sel yang diisi pengguna: semua baris data di bawah header pada sheet "Part".')],
      ],
    },
  ];
}

export function bomTemplate() {
  return [
    {
      name: 'BOM', freeze: 3, widths: WIDTHS,
      rows: [
        [{ v: 'Nama Produk', s: 'label' }, 'Mesin Pengemas X100', { v: 'No Item Produk', s: 'label' }, 'PRD-X100'],
        [],
        H(),
        ['CONTOH-001', 'Baut M8 x 20', 'Baja galvanis, panjang 20 mm', 8, 'A', 1, 3],
      ],
    },
    {
      name: 'Petunjuk', widths: [96],
      rows: [
        [{ v: 'Petunjuk pengisian — BOM', s: 'label' }],
        ['Baris 1 berisi Nama Produk dan No Item Produk. Ganti nilai contoh dengan produk Anda.'],
        ['Mulai baris 4, isi daftar part yang dipakai untuk membuat 1 unit produk. Baris contoh (CONTOH-) dilewati otomatis.'],
        ['Total Qty pada BOM = jumlah part yang dibutuhkan untuk 1 unit produk (bukan stok gudang).'],
        ['Part yang sudah ada di sistem cukup diisi No Item dan Qty; data lain diambil dari daftar Part.'],
        ['Part yang belum ada di sistem dibuat otomatis dengan stok 0 (Nama Part wajib diisi; Rak/Kolom/Baris opsional).'],
        ['Satu file boleh berisi banyak produk: buat satu sheet per produk dengan susunan yang sama.'],
        [NOTE('Sel yang diisi pengguna: baris 1 (nilai produk) dan semua baris di bawah header tabel.')],
      ],
    },
  ];
}
