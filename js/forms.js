// forms.js — dialog bersama: ubah stok dan tambah/edit/hapus part (dipakai Dashboard dan Part & BOM).
import { S, adjustStock, savePart, deletePart, consumeBom, ensureBomOutput } from './store.js';
import { codeOf, can, isAdmin, bomCheck, kindOf, KIND_TAG, KIND_LABEL, bomKind, inAsmOf, inReasonsFor, OUT_REASONS, invStatus, STATUS_TEXT, histEnds, histStatus, bomOfItem, whereUsed, traceTree } from './core.js';
import * as sync from './sync.js';
import { LABEL, statusText } from './report.js';
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
    body: `<div class="part-head"><strong>${k ? `<span class="ktag ${k}">${KIND_TAG[k]}</span> ` : ''}${esc(p.name)}</strong><span class="muted">${esc(p.no)}${p.spec ? ' · ' + esc(p.spec) : ''} · <b>${STATUS_TEXT[invStatus(p)]}</b></span></div>
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
    footer: `<button class="btn" id="detailbtn" style="margin-right:auto">Detail</button>${can(S.user, 'stock') ? '<button class="btn" id="editpart">Edit</button>' : ''}<button class="btn" data-close>Batal</button><button class="btn primary" id="ssave">Simpan</button>`,
  });
  const amt = m.$('#amt'), reasonSel = m.$('#reason');
  const val = () => Number(amt.value);
  const delta = () => (mode === 'in' ? val() : -val());
  const reasons = () => (mode === 'in' ? inReasonsFor(p) : OUT_REASONS);
  function fillReasons(keep) {
    reasonSel.innerHTML = '<option value="">Pilih status…</option>' + reasons().map(([c, l]) => {
      const none = mode === 'in' && c === 'assembly' && k && asm <= 0; // tidak ada produksi yang sedang berjalan
      return `<option value="${c}"${none ? ' disabled' : ''}>${l}${none ? ' (tidak ada yang di assembly)' : mode === 'in' && c === 'assembly' ? ` (maks. ${asm})` : ''}</option>`;
    }).join('');
    if (keep && reasons().some(([c]) => c === keep)) reasonSel.value = keep;
  }
  fillReasons(preset.reason || (mode === 'in' && asm ? 'assembly' : ''));
  if (preset.mode === 'in' && asm && preset.reason === 'assembly') amt.value = asm; // terima hasil: isi otomatis sebanyak yang di assembly
  const locRow = m.$('#locrow');
  function update() {
    const ok = Number.isInteger(val()) && val() > 0, reason = reasonSel.value;
    const after = qty + delta();
    const capErr = ok && mode === 'in' && reason === 'assembly' && k && val() > asm ? `Hanya ${asm} unit yang masih di assembly. Maksimal diterima ${asm}.` : '';
    m.$('#after').textContent = ok ? after : '–';
    m.$('#serr').textContent = capErr || (ok && after < 0 ? `Stok hanya ${qty}, tidak bisa dikurangi ${val()}.` : '');
    m.$('#rhint').textContent = reason ? '' : '(wajib dipilih)';
    m.$('#notetxt').textContent = NOTE_LABEL[reason] || NOTE_LABEL[''];
    const noteOk = reason !== 'lain' || m.$('#note').value.trim() !== '';
    m.$('#ssave').disabled = !ok || after < 0 || !reason || !noteOk || !!capErr;
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
    const lrk = locRow && !locRow.hidden ? locRow.querySelector('[name=lrack]').value : '';
    const dest = lrk ? `${lrk}${locRow.querySelector('[name=lcol]').value}${locRow.querySelector('[name=lrow]').value}` : '';
    const r = await adjustStock(no, delta(), m.$('#note').value.trim(), reasonSel.value, !!(closeBox && closeBox.checked && !m.$('#closerow').hidden), dest);
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
  m.$('#detailbtn').onclick = () => { m.close(); openItemDetail(no); };
  update(); amt.select();
}

// ---------- Detail item: kode, nama, jenis, qty, status, lokasi, di assembly, asal material, riwayat ----------
const monthsBack = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7); });
const fmtTs = (ts) => new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function traceHtml(n, root = true) {
  const tag = n.kind ? `<span class="ktag ${n.kind}">${KIND_TAG[n.kind]}</span> ` : '';
  const me = root ? '' : `<span class="tn">${tag}<b>${esc(n.name || n.no)}</b> <span class="muted">${esc(n.no)}</span> <span class="tq">× ${n.per}</span> <span class="muted">stok ${n.stock === null ? '–' : n.stock}</span>${n.cycle ? ' <b class="badc">(siklus)</b>' : ''}${n.stock === null ? ' <span class="muted">(belum ada di Part)</span>' : ''}</span>`;
  const kids = n.children.length ? `<ul class="trace">${n.children.map((c) => traceHtml(c, false)).join('')}</ul>` : '';
  return root ? kids : `<li>${me}${kids}</li>`;
}

export function openItemDetail(no) {
  const p = S.parts.find((x) => x.no === no);
  if (!p) return;
  const k = kindOf(p), asm = inAsmOf(p), qty = Number(p.qty) || 0, canEdit = can(S.user, 'stock');
  const own = bomOfItem(S.bom, p.no), used = whereUsed(S.bom, p.no), tree = own ? traceTree(p.no, S.bom, S.parts) : null;
  const kv = (l, v) => `<div class="kv"><span class="muted">${l}</span><span>${v}</span></div>`;
  const m = modal({
    title: 'Detail item', wide: true,
    body: `<div class="part-head"><strong>${k ? `<span class="ktag ${k}">${KIND_TAG[k]}</span> ` : ''}${esc(p.name)}</strong><span class="muted">${esc(p.spec || '')}</span></div>
      <div class="dgrid">
        ${kv('Kode', `<b class="mono">${esc(p.no)}</b>`)}${kv('Jenis', esc(KIND_LABEL[k]))}${kv('Qty di gudang', `<b>${qty}</b>`)}
        ${kv('Status', `<b>${STATUS_TEXT[invStatus(p)]}</b>`)}${kv('Lokasi', codeOf(p) ? `<span class="loc">${codeOf(p)}</span>` : '–')}
        ${k || asm ? kv('Sedang assembly', `<b class="${asm ? 'asmc' : ''}">${asm} unit</b>`) : ''}
        ${Number(p.sold) > 0 ? kv('Terjual (SOLD) total', `<b>${Number(p.sold)}</b>`) : ''}${Number(p.min) > 0 ? kv('Stok minimum', Number(p.min)) : ''}
      </div>
      ${canEdit ? `<div class="dact"><button class="btn small" id="dstock">Ubah stok</button><button class="btn small" id="dedit">Edit item</button>
        ${k ? '<button class="btn small" id="dsend">Kirim ke assembly</button>' : ''}${k && asm ? '<button class="btn small" id="drecv">Terima dari assembly</button>' : ''}</div>` : ''}
      ${tree && tree.children.length ? `<p class="section-title">Tersusun dari — ${esc(own.product_name)} (per 1 unit)</p>${traceHtml(tree)}` : ''}
      ${used.length ? `<p class="section-title">Dipakai di BOM</p><ul class="usedin">${used.map((b) => `<li><span class="ktag ${b.kind === 'jadi' ? 'jadi' : 'wip'}">${KIND_TAG[b.kind === 'jadi' ? 'jadi' : 'wip']}</span> ${esc(b.product_name)} <span class="muted">${esc(b.product_no)} · ${(b.lines.find((l) => l.no === p.no) || {}).qty} per unit</span></li>`).join('')}</ul>` : ''}
      <p class="section-title">Riwayat item (3 bulan terakhir)</p><div id="ihist" class="ihist"><span class="muted">Memuat…</span></div>`,
    footer: '<button class="btn primary" data-close>Tutup</button>',
  });
  const go = (fn) => () => { m.close(); fn(); };
  if (canEdit) {
    m.$('#dstock').onclick = go(() => openStock(no));
    m.$('#dedit').onclick = go(() => openPartForm(p));
    if (k) m.$('#dsend').onclick = go(() => openStock(no, { mode: 'out', reason: 'assembly' }));
    if (k && asm) m.$('#drecv').onclick = go(() => openStock(no, { mode: 'in', reason: 'assembly' }));
  }
  Promise.all(monthsBack(3).map((mo) => sync.loadHistory(mo))).then((res) => {
    const box = m.$('#ihist');
    if (!box || !box.isConnected) return;
    const all = res.flatMap((r) => r.items).filter((h) => h.no === no || h.productNo === no).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 25);
    if (!all.length) { box.innerHTML = '<span class="muted">Belum ada riwayat.</span>'; return; }
    box.innerHTML = '<ul class="hlist">' + all.map((h) => {
      const mat = h.productNo === no && h.no !== no; // bahan yang dipakai untuk memproduksi item ini
      const e = histEnds(h), st = h.status || histStatus(h) || '', lab = mat ? 'Bahan produksi' : (LABEL[h.action] || [h.action])[0];
      const qtyTxt = h.action === 'asm_send' ? `${h.delta} unit` : typeof h.delta === 'number' && h.delta ? `${h.delta > 0 ? '+' : ''}${h.delta}` : '';
      return `<li><b>${fmtTs(h.ts)}</b> · ${esc(lab)}${mat ? ` <span class="mono">${esc(h.no)}</span>` : ''} ${qtyTxt ? `<b>${qtyTxt}</b>` : ''}
        ${statusText(h) ? `<span class="muted"> · ${esc(statusText(h))}</span>` : ''}${st ? ` <span class="ktag">${st}</span>` : ''}
        ${e.from || e.to ? `<span class="muted"> · ${esc(e.from)} → ${esc(e.to)}</span>` : ''}${h.run ? ` <span class="muted">· run ${esc(h.run)}</span>` : ''}${h.note ? `<span class="muted"> · ${esc(h.note)}</span>` : ''}</li>`;
    }).join('') + '</ul>';
  }).catch(() => { const box = m.$('#ihist'); if (box) box.innerHTML = '<span class="muted">Riwayat tidak bisa dimuat.</span>'; });
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
      <label>Jenis${S.bom.some((b) => String(b.product_no) === String(p.no)) ? ' <span class="hint" style="color:var(--ink-2)">(ikut BOM)</span>' : ''}<select name="kind"${S.bom.some((b) => String(b.product_no) === String(p.no)) ? ' disabled' : ''}><option value="">Part (komponen)</option><option value="wip"${kindOf(p) === 'wip' ? ' selected' : ''}>WIP (setengah jadi)</option><option value="jadi"${kindOf(p) === 'jadi' ? ' selected' : ''}>Produk jadi</option></select></label>
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
    const part2 = { no, name, spec: el('spec').value.trim(), qty, min, kind: el('kind').disabled ? kindOf(p) : el('kind').value, rack, col: rack ? Number(el('col').value) : null, row: rack ? Number(el('row').value) : null };
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
