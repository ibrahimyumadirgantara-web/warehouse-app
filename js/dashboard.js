// dashboard.js — pencarian + denah rak (70) + daftar part (30).
import { S, onChange, saveRack, deleteRack } from './store.js';
import { codeOf, can, isAdmin, nextRackId, findFreeSpot, MAX_DIM } from './core.js';
import { matchParts } from './search.js';
import { $, esc, icon, modal, toast, confirmDialog } from './ui.js';
import { createMap } from './map.js';
import { openStock, openPartForm } from './forms.js';
import { scanBarcode } from './scanner.js';

const byNo = (a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true });
const opts = (n, sel) => Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${i + 1 === sel ? ' selected' : ''}>${i + 1}</option>`).join('');

export function mountDashboard(root) {
  let q = '', selected = null, edit = false, shown = 200, timer = null;
  const admin = isAdmin(S.user), canStock = can(S.user, 'stock');

  root.innerHTML = `<section class="dash">
    <div class="panel searchbar">${icon('search')}
      <input id="q" type="search" placeholder="Cari no item, nama, atau lokasi (mis. A13)" autocomplete="off" enterkeyhint="search" aria-label="Cari part">
      <button class="icon-btn" id="qclear" aria-label="Hapus pencarian" hidden>${icon('x')}</button>
      <button class="icon-btn" id="scan" aria-label="Pindai barcode dengan kamera">${icon('camera')}</button>
    </div>
    <div class="split">
      <div class="panel map-panel">
        <div id="map" class="map-host"></div>
        ${admin ? `<div class="map-tools">
          <button class="btn small primary" id="addrack" hidden>${icon('plus')}Rak baru</button>
          <button class="btn small" id="edit" aria-pressed="false">${icon('move')}Atur rak</button></div>
          <p class="map-hint" id="hint" hidden>Geser rak untuk memindahkan. Ketuk rak untuk mengubah atau menghapus.</p>` : ''}
      </div>
      <div class="panel list-panel">
        <div class="list-head"><span id="count" aria-live="polite"></span>
          ${canStock ? `<button class="btn small" id="addpart">${icon('plus')}Part baru</button>` : ''}</div>
        <ul class="list" id="list"></ul>
      </div>
    </div></section>`;

  const input = $('#q', root), list = $('#list', root);

  const map = createMap($('#map', root), {
    onCellTap: (code) => { q = code; input.value = code; selected = null; shown = 200; refresh(); },
    onRackTap: (r) => openRackForm(r),
    onRackMove: async (r, x, y) => {
      const res = await saveRack({ ...r, x, y }, 'move');
      if (!res.ok) { toast(res.error, 'error'); refresh(); }
    },
  });

  // ---------- Render ----------
  const results = () => (q ? matchParts(S.parts, q) : S.parts.slice().sort(byNo));

  function hitCodes() {
    const set = new Set();
    if (selected) {
      const p = S.parts.find((x) => x.no === selected);
      if (p && codeOf(p)) set.add(codeOf(p));
    } else if (q) {
      results().slice(0, 60).forEach((p) => { const c = codeOf(p); if (c) set.add(c); });
    }
    return set;
  }

  function row(p) {
    const qty = Number(p.qty) || 0, loc = codeOf(p);
    return `<li class="row${p.no === selected ? ' sel' : ''}" data-no="${esc(p.no)}" tabindex="0" role="button" aria-pressed="${p.no === selected}">
      <div class="row-main"><span class="row-name">${esc(p.name)}</span><span class="row-meta">${esc(p.no)}${p.spec ? ' · ' + esc(p.spec) : ''}</span></div>
      <span class="loc">${loc || '–'}</span><span class="qty${qty <= 0 ? ' zero' : ''}">${qty}</span>
      ${canStock ? `<button class="icon-btn" data-act="stock" aria-label="Ubah stok ${esc(p.name)}">${icon('swap')}</button>` : '<span></span>'}</li>`;
  }

  function renderList() {
    const res = results();
    $('#count', root).textContent = q ? `${res.length} part ditemukan` : `${S.parts.length} part`;
    if (!S.parts.length) {
      list.innerHTML = `<li class="empty"><b>Belum ada part</b><span>${canStock ? 'Ketuk “Part baru” untuk menambahkan part pertama.' : 'Minta admin menambahkan part.'}</span></li>`;
    } else if (!res.length) {
      list.innerHTML = `<li class="empty"><b>Tidak ada hasil untuk “${esc(q)}”</b><span>Coba no item, nama part, atau kode lokasi seperti A13.</span>
        ${canStock ? '<button class="btn small" id="addq" style="align-self:flex-start;margin-top:6px">Tambah part dengan no item ini</button>' : ''}</li>`;
    } else {
      list.innerHTML = res.slice(0, shown).map(row).join('') +
        (res.length > shown ? `<li class="more"><button class="btn small" id="more">Tampilkan ${res.length - shown} lagi</button></li>` : '');
    }
  }

  function renderMap() {
    map.render(S.racks, new Set(S.parts.map(codeOf).filter(Boolean)), hitCodes(), edit);
  }
  function refresh() {
    $('#qclear', root).hidden = !q;
    renderMap(); renderList();
  }

  // ---------- Interaksi ----------
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { q = input.value.trim(); selected = null; shown = 200; refresh(); }, 120);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  $('#qclear', root).onclick = () => { q = ''; input.value = ''; selected = null; refresh(); input.focus(); };

  $('#scan', root).onclick = async () => {
    const code = await scanBarcode();
    if (!code) return;
    q = code; input.value = code; shown = 200;
    const exact = S.parts.find((p) => String(p.no).toLowerCase() === code.toLowerCase());
    selected = exact ? exact.no : null;
    refresh();
    if (!exact && !matchParts(S.parts, code).length) toast(`Kode ${code} tidak ditemukan.`, 'warn');
  };

  function pick(li) {
    const no = li.dataset.no;
    selected = selected === no ? null : no;
    refresh();
  }
  list.addEventListener('click', (e) => {
    if (e.target.closest('#more')) { shown += 200; renderList(); return; }
    if (e.target.closest('#addq')) { openPartForm(null, { preset: { no: q }, onSaved: (no) => { q = no; input.value = no; selected = no; refresh(); } }); return; }
    const li = e.target.closest('.row');
    if (!li) return;
    if (e.target.closest('[data-act=stock]')) openStock(li.dataset.no); else pick(li);
  });
  list.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('row')) { e.preventDefault(); pick(e.target); }
  });

  if (canStock) {
    $('#addpart', root).onclick = () => openPartForm(null, {
      onSaved: (no, isNew) => { if (isNew) { q = no; input.value = no; selected = no; refresh(); } },
    });
  }
  if (admin) {
    $('#edit', root).onclick = (e) => {
      edit = !edit;
      e.currentTarget.setAttribute('aria-pressed', edit);
      e.currentTarget.classList.toggle('primary', edit);
      $('#addrack', root).hidden = !edit;
      $('#hint', root).hidden = !edit;
      renderMap();
    };
    $('#addrack', root).onclick = () => openRackForm(null);
  }

  // ---------- Rak baru / edit (admin) ----------
  function openRackForm(rack) {
    if (!admin || !edit) return;
    const isNew = !rack;
    const id = isNew ? nextRackId(S.racks) : rack.id;
    if (!id) { toast('Batas 26 rak (A–Z) sudah tercapai.', 'warn'); return; }
    const cur = rack || { id, cols: 4, rows: 4 };
    const m = modal({
      title: isNew ? 'Rak baru' : `Rak ${id}`,
      body: `<form class="form" id="rf" novalidate>
        <label>Kode rak (satu huruf)<input name="id" value="${esc(id)}" maxlength="1" ${isNew ? '' : 'readonly'} autocomplete="off"></label>
        <div class="grid3" style="grid-template-columns:1fr 1fr"><label>Jumlah kolom<select name="cols">${opts(MAX_DIM, cur.cols)}</select></label>
          <label>Jumlah baris<select name="rows">${opts(MAX_DIM, cur.rows)}</select></label></div>
        <p class="preview">Kode lokasi = rak + kolom + baris, contoh <span class="loc">${esc(id)}13</span> (kolom 1, baris 3).</p>
        <p class="err" id="rerr" role="alert"></p></form>`,
      footer: `${isNew ? '' : '<button class="btn danger" id="rdel">Hapus rak</button>'}<button class="btn" data-close>Batal</button><button class="btn primary" id="rsave">Simpan</button>`,
    });
    const f = m.$('#rf');
    async function save() {
      const rid = f.elements.id.value.trim().toUpperCase();
      if (!/^[A-Z]$/.test(rid)) { m.$('#rerr').textContent = 'Kode rak harus satu huruf A–Z.'; return; }
      const cols = Number(f.elements.cols.value), rows = Number(f.elements.rows.value);
      const next = isNew ? { id: rid, cols, rows, ...findFreeSpot(S.racks, cols, rows) } : { ...rack, cols, rows };
      const r = await saveRack(next, isNew ? 'add' : 'edit');
      if (!r.ok) { m.$('#rerr').textContent = r.error; return; }
      m.close();
    }
    m.$('#rsave').onclick = save;
    f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    const del = m.$('#rdel');
    if (del) del.onclick = async () => {
      const r0 = S.parts.some((p) => p.rack === id);
      if (r0) { m.$('#rerr').textContent = 'Masih ada part di rak ini. Pindahkan dulu.'; return; }
      m.close();
      if (await confirmDialog(`Hapus Rak ${id}? Tindakan ini tercatat di riwayat.`, 'Hapus rak', true)) {
        const r = await deleteRack(id);
        if (!r.ok) toast(r.error, 'error');
      }
    };
  }

  const off = onChange(refresh);
  refresh();
  return { refresh, destroy() { off(); clearTimeout(timer); } };
}
