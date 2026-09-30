// xlsx.js — baca/tulis .xlsx dan .csv tanpa library luar (jalan offline).
// Membaca: zip (stored/deflate via DecompressionStream) + XML. Menulis: zip tanpa kompresi.

const dec = new TextDecoder();
const enc = new TextEncoder();
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// ======================= ZIP =======================
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function zip(files) {
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), size = f.data.length, crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true);
    lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  const cd = concat(central);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cd.length, true); end.setUint32(16, offset, true);
  return concat([...chunks, cd, new Uint8Array(end.buffer)]);
}

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function openZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Bukan file .xlsx yang valid.');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const entries = {};
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('File Excel rusak.');
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    entries[dec.decode(u8.subarray(p + 46, p + 46 + nlen))] = {
      method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true),
    };
    p += 46 + nlen + xlen + clen;
  }
  return async (name) => {
    const en = entries[name];
    if (!en) return null;
    const start = en.off + 30 + dv.getUint16(en.off + 26, true) + dv.getUint16(en.off + 28, true);
    const data = u8.subarray(start, start + en.csize);
    if (en.method === 0) return dec.decode(data);
    if (en.method === 8) return dec.decode(await inflate(data));
    throw new Error('Metode kompresi file Excel tidak didukung.');
  };
}

// ======================= BACA =======================
function xml(text) {
  const d = new DOMParser().parseFromString(text, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) throw new Error('Isi file Excel tidak terbaca.');
  return d;
}
const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};
const textOf = (el) => [...el.getElementsByTagName('t')].filter((t) => !t.closest || !t.closest('rPh')).map((t) => t.textContent).join('');

function sheetRows(doc, shared) {
  const rows = [];
  let seq = -1;
  for (const r of doc.getElementsByTagName('row')) {
    const ri = r.getAttribute('r') ? Number(r.getAttribute('r')) - 1 : ++seq;
    seq = ri;
    const cells = [];
    let cseq = -1;
    for (const c of r.getElementsByTagName('c')) {
      const ci = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : ++cseq;
      cseq = ci;
      const t = c.getAttribute('t');
      let v = '';
      if (t === 'inlineStr') v = textOf(c);
      else {
        const ve = c.getElementsByTagName('v')[0];
        const raw = ve ? ve.textContent : '';
        if (t === 's') v = shared[Number(raw)] ?? '';
        else if (t === 'str') v = raw;
        else if (t === 'b') v = raw === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'e') v = '';
        else v = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
      }
      cells[ci] = v;
    }
    if (cells.length) rows[ri] = cells;
  }
  const out = [];
  for (let i = 0; i < rows.length; i++) out.push(Array.from(rows[i] || [], (x) => (x === undefined ? '' : x)));
  while (out.length && out[out.length - 1].every((c) => c === '')) out.pop();
  return out;
}

export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows.map((r) => r.map((c) => (c !== '' && /^-?\d+(\.\d+)?$/.test(c) && !/^0\d/.test(c) ? Number(c) : c)));
}

// Hasil: [{ name, rows: [[...]] }]
export async function readWorkbook(file) {
  if (/\.(csv|txt)$/i.test(file.name || '')) return [{ name: 'CSV', rows: parseCsv(await file.text()) }];
  const get = openZip(await file.arrayBuffer());
  const wbText = await get('xl/workbook.xml');
  if (!wbText) throw new Error('Bukan file .xlsx yang valid.');
  const wb = xml(wbText);
  const relText = await get('xl/_rels/workbook.xml.rels');
  const rels = {};
  if (relText) for (const r of xml(relText).getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const shared = [];
  const ssText = await get('xl/sharedStrings.xml');
  if (ssText) for (const si of xml(ssText).getElementsByTagName('si')) shared.push(textOf(si));
  const sheets = [];
  for (const s of wb.getElementsByTagName('sheet')) {
    if (s.getAttribute('state') && s.getAttribute('state') !== 'visible') continue;
    let target = rels[s.getAttributeNS(NS_R, 'id')] || rels[s.getAttribute('r:id')];
    if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const text = await get(target);
    if (text) sheets.push({ name: s.getAttribute('name'), rows: sheetRows(xml(text), shared) });
  }
  return sheets;
}

// ======================= TULIS =======================
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const STYLE = { h: 1, label: 2, note: 3, wrap: 4 };
const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const STYLES = XMLH + `<styleSheet xmlns="${MAIN}">
<fonts count="4"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><i/><sz val="10"/><color rgb="FF55636F"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1D5FD1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE8FB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB8C4CE"/></left><right style="thin"><color rgb="FFB8C4CE"/></right><top style="thin"><color rgb="FFB8C4CE"/></top><bottom style="thin"><color rgb="FFB8C4CE"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function cellXml(v, ref) {
  let val = v, s = 0;
  if (v && typeof v === 'object') { val = v.v; s = STYLE[v.s] || 0; }
  if (val === '' || val === null || val === undefined) return s ? `<c r="${ref}" s="${s}"/>` : '';
  const sa = s ? ` s="${s}"` : '';
  if (typeof val === 'number' && Number.isFinite(val)) return `<c r="${ref}"${sa}><v>${val}</v></c>`;
  const str = String(val);
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(str)}</t></is></c>`;
}

function sheetXml(sh) {
  let x = XMLH + `<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0">`;
  if (sh.freeze) x += `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/>`;
  x += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
  if (sh.widths) x += '<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
  x += '<sheetData>';
  sh.rows.forEach((row, ri) => {
    const cells = row.map((v, ci) => cellXml(v, colName(ci) + (ri + 1))).join('');
    x += `<row r="${ri + 1}">${cells}</row>`;
  });
  return x + '</sheetData></worksheet>';
}

// sheets: [{ name, rows:[[cell|{v,s}]], widths?:[], freeze?:n }] → Uint8Array (.xlsx)
export function writeWorkbook(sheets) {
  const files = [];
  const add = (name, text) => files.push({ name, data: enc.encode(text) });
  add('[Content_Types].xml', XMLH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>');
  add('_rels/.rels', XMLH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  add('xl/workbook.xml', XMLH + `<workbook xmlns="${MAIN}" xmlns:r="${NS_R}"><sheets>` +
    sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', XMLH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  add('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip(files);
}

export function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
