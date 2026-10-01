// parts.js — menu "Part & BOM": tab Part (daftar, impor/ekspor Excel) dan tab BOM.
import { S, onChange, importParts } from './store.js';
import { can, isAdmin, isLow, minOf, lowParts } from './core.js';
import { matchParts } from './search.js';
import { readWorkbook, writeWorkbook, downloadBytes } from './xlsx.js';
import { parsePartSheets, partsToSheet, partTemplate } from './sheets.js';
import { $, esc, icon, modal, toast, pickFile, today } from './ui.js';
import { openStock } from './forms.js';
import { bomTab } from './bom.js';
import { opnameTab } from './opname.js';

const byNo = (a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true });

export function errorList(errors, max = 8) {
  if (!errors.length) return '';
  return `<ul class="errlist">${errors.slice(0, max).map((e) => `<li>Baris ${e.line}${e.no ? ` (${esc(e.no)})` : ''}: ${esc(e.msg)}</li>`).join('')}${errors.length > max ? `<li>…dan ${errors.length - max} lainnya</li>` : ''}</ul>`;
}

function partTab(acts, body) {
  let filter = '', shown = 300, lowOnly = false;
  const canEdit = can(S.user, 'stock');
  acts.innerHTML = `<div class="filter">${icon('search')}<input id="pfilter" type="search" placeholder="Filter part…" aria-label="Filter part" autocomplete="off"></div>
    ${canEdit ? `<button class="btn small" id="imp">${icon('upload')}Impor Excel</button>` : ''}
    <button class="btn small" id="lowf" aria-pressed="false"></button>
    <button class="btn small" id="exp">${icon('download')}Ekspor</button>
    ${canEdit ? `<button class="btn small" id="tpl">${icon('file')}Template</button>` : ''}`;

  function render() {
    const nLow = lowParts(S.parts).length, lb = acts.querySelector('#lowf');
    lb.textContent = `Stok rendah (${nLow})`;
    lb.hidden = !nLow && !lowOnly;
    lb.classList.toggle('primary', lowOnly);
    lb.setAttribute('aria-pressed', lowOnly);
    let list = filter ? matchParts(S.parts, filter) : S.parts.slice().sort(byNo);
    if (lowOnly) list = list.filter(isLow);
    if (!S.parts.length) {
      body.innerHTML = `<div class="empty"><b>Belum ada part</b><span>${canEdit ? 'Unduh Template, isi datanya, lalu ketuk Impor Excel. Atau tambahkan satu per satu dari Dashboard.' : 'Minta admin mengisi data part.'}</span></div>`;
      return;
    }
    body.innerHTML = `<div class="tcount" aria-live="polite">${filter ? `${list.length} dari ${S.parts.length} part` : `${S.parts.length} part`}</div>
      <div class="tbl"><div class="trow thead"><span>No Item</span><span>Nama Part</span><span class="hide-m">Spesifikasi</span><span>Lokasi</span><span class="r">Qty</span></div>
      ${list.slice(0, shown).map((p) => {
        const q = Number(p.qty) || 0;
        return `<div class="trow${canEdit ? ' click' : ''}" data-no="${esc(p.no)}"${canEdit ? ' tabindex="0" role="button"' : ''}>
          <span class="mono">${esc(p.no)}</span><span class="tname">${esc(p.name)}</span><span class="hide-m muted tname">${esc(p.spec || '')}</span>
          <span>${p.rack ? `<span class="loc">${esc(p.rack)}${p.col}${p.row}</span>` : '<span class="muted">–</span>'}</span>
          <span class="qty r${q <= 0 ? ' zero' : isLow(p) ? ' low' : ''}"${isLow(p) ? ` title="Stok minimum ${minOf(p)}"` : ''}>${q}${minOf(p) ? `<small class="qmin">min ${minOf(p)}</small>` : ''}</span></div>`;
      }).join('')}
      ${list.length > shown ? `<div class="more"><button class="btn small" id="more">Tampilkan ${list.length - shown} lagi</button></div>` : ''}</div>`;
  }

  acts.querySelector('#lowf').onclick = () => { lowOnly = !lowOnly; shown = 300; render(); };
  acts.querySelector('#pfilter').addEventListener('input', (e) => { filter = e.target.value.trim(); shown = 300; render(); });
  body.addEventListener('click', (e) => {
    if (e.target.closest('#more')) { shown += 300; render(); return; }
    const row = e.target.closest('.trow.click');
    if (row) openStock(row.dataset.no);
  });
  body.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('click')) { e.preventDefault(); openStock(e.target.dataset.no); }
  });

  acts.querySelector('#exp').onclick = () => {
    if (!S.parts.length) return toast('Belum ada part untuk diekspor.', 'warn');
    downloadBytes(writeWorkbook([partsToSheet(S.parts)]), `part-${today()}.xlsx`);
  };
  if (canEdit) {
    acts.querySelector('#tpl').onclick = () => downloadBytes(writeWorkbook(partTemplate()), 'template-part.xlsx');
    acts.querySelector('#imp').onclick = startImport;
  }

  async function startImport() {
    const file = await pickFile('.xlsx,.csv');
    if (!file) return;
    let sheets;
    try { sheets = await readWorkbook(file); } catch (e) { toast(e.message || 'File tidak bisa dibaca.', 'error'); return; }
    const res = parsePartSheets(sheets, S.racks);
    if (!res.ok) { toast(res.error, 'error'); return; }
    const have = new Set(S.parts.map((p) => p.no));
    const fresh = res.rows.filter((r) => !have.has(r.no)), old = res.rows.filter((r) => have.has(r.no));
    const admin = isAdmin(S.user);
    const m = modal({
      title: 'Pratinjau impor Part',
      body: `<p class="muted" style="margin-top:0">${esc(file.name)} · sheet “${esc(res.sheet)}”</p>
        <div class="stats"><div><b>${fresh.length}</b><span>part baru</span></div><div><b>${old.length}</b><span>sudah ada</span></div>
          <div class="${res.errors.length ? 'bad' : ''}"><b>${res.errors.length}</b><span>baris bermasalah</span></div></div>
        ${old.length && admin ? `<div class="form" style="margin:12px 0"><label class="radio"><input type="radio" name="mode" value="skip" checked> Lewati ${old.length} part yang sudah ada</label>
          <label class="radio"><input type="radio" name="mode" value="update"> Perbarui ${old.length} part yang sudah ada (nama, lokasi, dan qty diganti sesuai file)</label></div>` : ''}
        ${old.length && !admin ? `<p class="muted">${old.length} part sudah ada dan akan dilewati. Hanya admin yang dapat memperbarui part yang sudah ada.</p>` : ''}
        ${res.noLocation ? `<p class="muted">${res.noLocation} part tanpa lokasi tidak akan muncul di denah sampai lokasinya diisi.</p>` : ''}
        ${res.samples ? '<p class="muted">Baris contoh dilewati.</p>' : ''}
        ${res.errors.length ? '<p class="section-title" style="margin-top:12px">Baris yang dilewati</p>' : ''}${errorList(res.errors)}`,
      footer: '<button class="btn" data-close>Batal</button><button class="btn primary" id="go"></button>',
    });
    const mode = () => (m.el.querySelector('input[name=mode]:checked') || {}).value === 'update';
    const count = () => fresh.length + (mode() ? old.length : 0);
    const label = () => { const b = m.$('#go'); b.textContent = `Impor ${count()} part`; b.disabled = count() === 0; };
    m.el.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', label));
    label();
    m.$('#go').onclick = async () => {
      const update = mode();
      m.$('#go').disabled = true;
      const r = await importParts(update ? res.rows : fresh, update, file.name);
      m.close();
      if (r.ok) toast(`Impor selesai: ${r.added} baru${update ? `, ${r.updated} diperbarui` : ''}`, 'ok'); else toast(r.error, 'error');
    };
  }

  render();
  return { refresh: render, destroy() {} };
}

export function mountParts(root) {
  const TABS = { part: partTab, bom: bomTab, opname: opnameTab };
  let tab = TABS[localStorage.getItem('swl.ptab')] ? localStorage.getItem('swl.ptab') : 'part', api = null;
  root.innerHTML = `<section class="pv">
    <div class="pv-top"><div class="segset tabs" role="tablist">
      <button data-t="part" role="tab">Part</button><button data-t="bom" role="tab">BOM</button><button data-t="opname" role="tab">Opname</button></div>
      <div class="pv-acts" id="acts"></div></div>
    <div class="pv-body panel" id="pvbody"></div></section>`;
  const acts = $('#acts', root);

  function show(t) {
    tab = t;
    localStorage.setItem('swl.ptab', t);
    if (api) api.destroy();
    root.querySelectorAll('[data-t]').forEach((b) => { const on = b.dataset.t === t; b.setAttribute('aria-pressed', on); b.setAttribute('aria-selected', on); });
    const cur = $('#pvbody', root);
    const fresh = cur.cloneNode(false); // elemen baru → listener tab sebelumnya ikut hilang
    cur.replaceWith(fresh);
    api = TABS[t](acts, fresh);
  }
  root.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => show(b.dataset.t)));
  const off = onChange(() => api && api.refresh());
  show(tab);
  return { refresh: () => api && api.refresh(), destroy() { off(); if (api) api.destroy(); } };
}
