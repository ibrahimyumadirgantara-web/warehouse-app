// forms.js — dialog bersama: ubah stok dan tambah/edit/hapus part (dipakai Dashboard dan Part & BOM).
import { S, adjustStock, savePart, deletePart, consumeBom, ensureBomOutput } from './store.js';
import { codeOf, can, isAdmin, bomCheck, kindOf, KIND_TAG, bomKind, inAsmOf, IN_REASONS, OUT_REASONS } from './core.js';
import { esc, icon, modal, toast, confirmDialog } from './ui.js';
import { scanBarcode } from './scanner.js';

const opts = (n, sel) => Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${i + 1 === sel ? ' selected' : ''}>${i + 1}</option>`).join('');

const NOTE_LABEL = {
  '': 'Referensi / catatan (opsional)', pembelian: 'Supplier / no PO (opsional)', assembly: 'No SPK / catatan (opsional)',
  customer: 'Customer / no DO (opsional)', lain: 'Alasan (wajib diisi)',
};

// preset: { mode: 'in' | 'out', reason } — mis. dari tombol "Terima hasil" di BOM.
export function openStock(no, preset = {}) {
  const p = S.parts.find((x) => x.no === no);
  if (!p) return;
  const qty = Number(p.qty) || 0, k = kindOf(p), asm = k ? inAsmOf(p) : 0;
  const canLoc = !p.rack && S.racks.length > 0;
  let mode = preset.mode === 'out' ? 'out' : 'in';
  const m = modal({
    title: 'Ubah stok',
    body: `<div class="part-head"><strong>${k ? `<span class="ktag ${k}">${KIND_TAG[k]}</span> ` : ''}${esc(p.name)}</strong><span class="muted">${esc(p.no)}${p.spec ? ' · ' + esc(p.spec) : ''}</span></div>
      <div class="stock-now"><span>Lokasi <span class="loc">${codeOf(p) || '–'}</span></span><span>Stok <b>${qty}</b></span></div>
      ${asm ? `<p class="asmline">Sedang di assembly: <b>${asm}</b> unit <button type="button" class="linkbtn" id="allasm">Terima semua</button></p>` : ''}
      <div class="seg"><button data-mode="in" aria-pressed="${mode === 'in'}">Masuk</button><button data-mode="out" aria-pressed="${mode === 'out'}">Keluar</button></div>
      <form class="form" id="sf" novalidate>
        <label><span>Status <span class="hint" id="rhint"></span></span><select id="reason"></select></label>
        <label>Jumlah<div class="stepper"><button type="button" data-step="-1" aria-label="Kurangi">−</button>
          <input id="amt" type="number" inputmode="numeric" min="1" step="1" value="1"><button type="button" data-step="1" aria-label="Tambah">+</button></div></label>
        <label><span id="notetxt">${NOTE_LABEL['']}</span><input id="note" maxlength="80" autocomplete="off"></label>
        ${asm ? '<label class="radio" id="closerow" hidden><input type="checkbox" id="closeasm"> Tutup sisa di assembly (sisanya tidak kembali ke gudang)</label>' : ''}
        ${canLoc ? `<div class="grid3" id="locrow"><label>Simpan di rak<select name="lrack"><option value="">— nanti saja —</option>${S.racks.map((r) => `<option value="${esc(r.id)}">Rak ${esc(r.id)}</option>`).join('')}</select></label>
          <label>Kolom<select name="lcol" disabled></select></label><label>Baris<select name="lrow" disabled></select></label></div>` : ''}
        <p class="preview">Stok setelah disimpan: <b id="after"></b></p><p class="err" id="serr" role="alert"></p></form>`,
    footer: `${can(S.user, 'stock') ? '<button class="btn" id="editpart" style="margin-right:auto">Edit part</button>' : ''}<button class="btn" data-close>Batal</button><button class="btn primary" id="ssave">Simpan</button>`,
  });
  const amt = m.$('#amt'), reasonSel = m.$('#reason');
  const val = () => Number(amt.value);
  const delta = () => (mode === 'in' ? val() : -val());
  const reasons = () => (mode === 'in' ? IN_REASONS : OUT_REASONS);
  function fillReasons(keep) {
    reasonSel.innerHTML = '<option value="">Pilih status…</option>' + reasons().map(([c, l]) => `<option value="${c}">${l}</option>`).join('');
    if (keep && reasons().some(([c]) => c === keep)) reasonSel.value = keep;
  }
  fillReasons(preset.reason || (mode === 'in' && asm ? 'assembly' : ''));
  if (preset.mode === 'in' && asm && preset.reason === 'assembly') amt.value = asm; // terima hasil: isi otomatis sebanyak yang di assembly
  const locRow = m.$('#locrow');
  function update() {
    const ok = Number.isInteger(val()) && val() > 0, reason = reasonSel.value;
    const after = qty + delta();
    m.$('#after').textContent = ok ? after : '–';
    m.$('#serr').textContent = ok && after < 0 ? `Stok hanya ${qty}, tidak bisa dikurangi ${val()}.` : '';
    m.$('#rhint').textContent = reason ? '' : '(wajib dipilih)';
    m.$('#notetxt').textContent = NOTE_LABEL[reason] || NOTE_LABEL[''];
    const noteOk = reason !== 'lain' || m.$('#note').value.trim() !== '';
    m.$('#ssave').disabled = !ok || after < 0 || !reason || !noteOk;
    const cr = m.$('#closerow');
    if (cr) cr.hidden = !(mode === 'in' && reason === 'assembly');
    if (locRow) locRow.hidden = mode !== 'in';
  }
  m.el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    m.el.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    fillReasons(reasonSel.value);
    update();
  }));
  m.el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    amt.value = Math.max(1, (val() || 0) + Number(b.dataset.step)); update();
  }));
  amt.addEventListener('input', update);
  reasonSel.addEventListener('change', update);
  m.$('#note').addEventListener('input', update);
  const all = m.$('#allasm');
  if (all) all.onclick = () => {
    mode = 'in';
    m.el.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.mode === 'in'));
    fillReasons('assembly'); amt.value = asm; update();
  };
  if (locRow) {
    const lr = locRow.querySelector('[name=lrack]'), lc = locRow.querySelector('[name=lcol]'), lw = locRow.querySelector('[name=lrow]');
    lr.addEventListener('change', () => {
      const r = S.racks.find((x) => x.id === lr.value);
      lc.innerHTML = r ? opts(r.cols, 1) : ''; lw.innerHTML = r ? opts(r.rows, 1) : '';
      lc.disabled = lw.disabled = !r;
    });
  }
  async function save() {
    if (m.$('#ssave').disabled) return;
    const closeBox = m.$('#closeasm');
    const r = await adjustStock(no, delta(), m.$('#note').value.trim(), reasonSel.value, !!(closeBox && closeBox.checked && !m.$('#closerow').hidden));
    if (!r.ok) { m.$('#serr').textContent = r.error; return; }
    if (locRow && !locRow.hidden && locRow.querySelector('[name=lrack]').value) { // barang masuk tanpa lokasi: simpan sekalian di rak yang dipilih
      const cur = S.parts.find((x) => x.no === no) || p;
      await savePart({ no, name: cur.name, spec: cur.spec || '', qty: Number(cur.qty) || 0, min: Number(cur.min) || 0, kind: kindOf(cur),
        rack: locRow.querySelector('[name=lrack]').value, col: Number(locRow.querySelector('[name=lcol]').value), row: Number(locRow.querySelector('[name=lrow]').value) }, false);
    }
    m.close();
    toast(`${p.name}: ${qty} → ${r.after}`, 'ok');
    notifyLow(r.low);
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
      <label>Jenis<select name="kind"><option value="">Part (komponen)</option><option value="wip"${kindOf(p) === 'wip' ? ' selected' : ''}>WIP (setengah jadi)</option><option value="jadi"${kindOf(p) === 'jadi' ? ' selected' : ''}>Produk jadi</option></select></label>
      ${isNew ? `<label>Qty awal<input name="qty" type="number" inputmode="numeric" min="0" step="1" value="${p.qty}"></label>` : ''}
      <label>Stok minimum (opsional)<input name="min" type="number" inputmode="numeric" min="0" step="1" value="${Number(p.min) > 0 ? Number(p.min) : ''}" placeholder="kosong / 0 = tanpa peringatan"></label>
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
    const min = el('min').value.trim() === '' ? 0 : Number(el('min').value);
    if (!Number.isInteger(min) || min < 0) return err('Stok minimum harus bilangan bulat, minimal 0.');
    const rack = el('rack').value;
    const part2 = { no, name, spec: el('spec').value.trim(), qty, min, kind: el('kind').value, rack, col: rack ? Number(el('col').value) : null, row: rack ? Number(el('row').value) : null };
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

// Toast peringatan untuk part yang baru jatuh ke/di bawah stok minimum. low: [{ no, name, qty, min }]
export function notifyLow(low) {
  if (!low || !low.length) return;
  const one = low[0];
  toast(low.length === 1 ? `Stok rendah: ${one.name} tinggal ${one.qty} (minimum ${one.min})` : `Stok rendah: ${low.length} part di bawah minimum (${low.slice(0, 2).map((x) => x.name).join(', ')}, …)`, 'warn');
}

// Konfirmasi lalu kirim ke assembly: stok semua part BOM dipotong untuk `units` unit. Resolve true bila jadi dikirim.
export async function useBom(bom, units) {
  const chk = bomCheck(bom, S.parts, units);
  if (chk.missing) { toast(`${chk.missing} part belum ada di daftar Part. Tambahkan dulu.`, 'error'); return false; }
  if (!chk.ok) { toast(`Stok kurang untuk ${chk.short} part. Tidak dikirim.`, 'error'); return false; }
  const total = chk.lines.reduce((a, l) => a + l.need, 0), kind = bomKind(bom) === 'jadi' ? 'produk jadi' : 'WIP';
  const ok = await confirmDialog(`Kirim ke assembly: ${chk.lines.length} part (total ${total} pcs) untuk ${units} unit ${bom.product_name} (${bom.product_no}). Stok part dipotong dengan status “Ke proses assembly”. Hasilnya (${kind}) dicatat sedang di assembly sampai diterima kembali ke gudang. Tercatat di riwayat.`, 'Kirim ke assembly');
  if (!ok) return false;
  const r = await consumeBom(bom.id, units);
  if (!r.ok) { toast(r.error, 'error'); return false; }
  toast(`Dikirim ke assembly: ${r.count} part untuk ${units} unit ${bom.product_name}`, 'ok');
  notifyLow(r.low);
  return true;
}

// Terima hasil assembly (WIP / produk jadi) kembali ke gudang: buka dialog stok masuk dengan status "Dari proses assembly".
export async function receiveBom(bom) {
  const r = await ensureBomOutput(bom.id);
  if (!r.ok) { toast(r.error, 'error'); return; }
  openStock(bom.product_no, { mode: 'in', reason: 'assembly' });
}
