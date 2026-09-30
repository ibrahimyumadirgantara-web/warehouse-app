// forms.js — dialog bersama: ubah stok dan tambah/edit/hapus part (dipakai Dashboard dan Part & BOM).
import { S, adjustStock, savePart, deletePart } from './store.js';
import { codeOf, can, isAdmin } from './core.js';
import { esc, icon, modal, toast, confirmDialog } from './ui.js';
import { scanBarcode } from './scanner.js';

const opts = (n, sel) => Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${i + 1 === sel ? ' selected' : ''}>${i + 1}</option>`).join('');

export function openStock(no) {
  const p = S.parts.find((x) => x.no === no);
  if (!p) return;
  const qty = Number(p.qty) || 0;
  let mode = 'in';
  const m = modal({
    title: 'Ubah stok',
    body: `<div class="part-head"><strong>${esc(p.name)}</strong><span class="muted">${esc(p.no)}${p.spec ? ' · ' + esc(p.spec) : ''}</span></div>
      <div class="stock-now"><span>Lokasi <span class="loc">${codeOf(p) || '–'}</span></span><span>Stok <b>${qty}</b></span></div>
      <div class="seg"><button data-mode="in" aria-pressed="true">Tambah</button><button data-mode="out" aria-pressed="false">Kurang</button></div>
      <form class="form" id="sf" novalidate>
        <label>Jumlah<div class="stepper"><button type="button" data-step="-1" aria-label="Kurangi">−</button>
          <input id="amt" type="number" inputmode="numeric" min="1" step="1" value="1"><button type="button" data-step="1" aria-label="Tambah">+</button></div></label>
        <label>Catatan (opsional)<input id="note" maxlength="80" autocomplete="off"></label>
        <p class="preview">Stok setelah disimpan: <b id="after"></b></p><p class="err" id="serr" role="alert"></p></form>`,
    footer: `${can(S.user, 'stock') ? '<button class="btn" id="editpart" style="margin-right:auto">Edit part</button>' : ''}<button class="btn" data-close>Batal</button><button class="btn primary" id="ssave">Simpan</button>`,
  });
  const amt = m.$('#amt');
  const val = () => Number(amt.value);
  const delta = () => (mode === 'in' ? val() : -val());
  function update() {
    const ok = Number.isInteger(val()) && val() > 0;
    const after = qty + delta();
    m.$('#after').textContent = ok ? after : '–';
    m.$('#serr').textContent = ok && after < 0 ? `Stok hanya ${qty}, tidak bisa dikurangi ${val()}.` : '';
    m.$('#ssave').disabled = !ok || after < 0;
  }
  m.el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    m.el.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    update();
  }));
  m.el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    amt.value = Math.max(1, (val() || 0) + Number(b.dataset.step)); update();
  }));
  amt.addEventListener('input', update);
  async function save() {
    if (m.$('#ssave').disabled) return;
    const r = await adjustStock(no, delta(), m.$('#note').value.trim());
    if (!r.ok) { m.$('#serr').textContent = r.error; return; }
    m.close();
    toast(`${p.name}: ${qty} → ${r.after}`, 'ok');
  }
  m.$('#ssave').onclick = save;
  m.$('#sf').addEventListener('submit', (e) => { e.preventDefault(); save(); });
  const ep = m.$('#editpart');
  if (ep) ep.onclick = () => { m.close(); openPartForm(p); };
  update(); amt.select();
}

// part = null → part baru. onSaved(no, isNew) dipanggil setelah tersimpan.
export function openPartForm(part, { onSaved, preset } = {}) {
  if (!S.racks.length) { toast('Buat rak dulu: Dashboard → Atur rak → Rak baru.', 'warn'); return; }
  const isNew = !part;
  const p = part || { no: (preset && preset.no) || '', name: '', spec: '', qty: 0, rack: S.racks[0].id, col: 1, row: 1 };
  const m = modal({
    title: isNew ? 'Part baru' : 'Edit part',
    body: `<form class="form" id="pf" novalidate>
      <label>No item<span class="inrow"><input name="no" value="${esc(p.no)}" ${isNew ? '' : 'readonly'} autocomplete="off">${isNew ? `<button type="button" class="icon-btn" id="scanno" aria-label="Pindai barcode no item">${icon('camera')}</button>` : ''}</span></label>
      <label>Nama part<input name="name" value="${esc(p.name)}" autocomplete="off"></label>
      <label>Spesifikasi<input name="spec" value="${esc(p.spec || '')}" autocomplete="off"></label>
      ${isNew ? `<label>Qty awal<input name="qty" type="number" inputmode="numeric" min="0" step="1" value="${p.qty}"></label>` : ''}
      <div class="grid3">
        <label>Rak<select name="rack"><option value="">— tanpa lokasi —</option>${S.racks.map((r) => `<option value="${esc(r.id)}"${r.id === p.rack ? ' selected' : ''}>Rak ${esc(r.id)}</option>`).join('')}</select></label>
        <label>Kolom<select name="col"></select></label><label>Baris<select name="row"></select></label></div>
      <p class="preview">Kode lokasi: <span class="loc" id="pcode"></span></p><p class="err" id="perr" role="alert"></p></form>`,
    footer: `${!isNew && isAdmin(S.user) ? '<button class="btn danger" id="pdel">Hapus part</button>' : ''}<button class="btn" data-close>Batal</button><button class="btn primary" id="psave">Simpan</button>`,
  });
  const f = m.$('#pf'), el = (n) => f.elements[n];
  const code = () => { m.$('#pcode').textContent = el('rack').value ? `${el('rack').value}${el('col').value}${el('row').value}` : '–'; };
  function dims(col, row) {
    const r = S.racks.find((x) => x.id === el('rack').value);
    el('col').innerHTML = r ? opts(r.cols, col) : '';
    el('row').innerHTML = r ? opts(r.rows, row) : '';
    el('col').disabled = el('row').disabled = !r;
    code();
  }
  dims(p.col, p.row);
  const scanBtn = m.$('#scanno');
  if (scanBtn) scanBtn.onclick = async () => { const c = await scanBarcode(); if (c) { el('no').value = c; el('name').focus(); } };
  el('rack').addEventListener('change', () => dims(1, 1));
  el('col').addEventListener('change', code); el('row').addEventListener('change', code);
  async function save() {
    const err = (t) => { m.$('#perr').textContent = t; };
    const no = el('no').value.trim(), name = el('name').value.trim();
    if (!no) return err('No item wajib diisi.');
    if (!name) return err('Nama part wajib diisi.');
    const qty = isNew ? Number(el('qty').value) : Number(p.qty) || 0;
    if (!Number.isInteger(qty) || qty < 0) return err('Qty awal harus bilangan bulat, minimal 0.');
    const rack = el('rack').value;
    const part2 = { no, name, spec: el('spec').value.trim(), qty, rack, col: rack ? Number(el('col').value) : null, row: rack ? Number(el('row').value) : null };
    const r = await savePart(part2, isNew);
    if (!r.ok) return err(r.error);
    m.close();
    toast(isNew ? `Part ${no} ditambahkan${rack ? ' di ' + codeOf(part2) : ''}` : 'Part diperbarui', 'ok');
    if (onSaved) onSaved(no, isNew);
  }
  m.$('#psave').onclick = save;
  f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  const del = m.$('#pdel');
  if (del) del.onclick = async () => {
    const used = S.bom.filter((b) => b.lines.some((l) => l.no === p.no)).length;
    const msg = `Hapus part ${p.no} (${p.name})?` + (Number(p.qty) > 0 ? ` Stok ${p.qty} akan hilang.` : '') + (used ? ` Part ini dipakai di ${used} BOM.` : '');
    m.close();
    if (await confirmDialog(msg, 'Hapus part', true)) {
      const r = await deletePart(p.no);
      if (r.ok) toast(`Part ${p.no} dihapus`, 'ok'); else toast(r.error, 'error');
    }
  };
}
