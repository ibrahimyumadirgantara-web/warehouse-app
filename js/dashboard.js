// dashboard.js — pencarian (part & produk BOM) + denah rak (70) + daftar hasil (30).
import { S, onChange, saveRack, deleteRack } from './store.js';
import { codeOf, can, isAdmin, nextRackId, findFreeSpot, MAX_DIM, bomCheck, isLow, minOf } from './core.js';
import { matchParts, matchBoms, isExactBom } from './search.js';
import { $, esc, icon, modal, toast, confirmDialog } from './ui.js';
import { createMap } from './map.js';
import { openStock, openPartForm, useBom } from './forms.js';
import { scanBarcode } from './scanner.js';

const byNo = (a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true });
const opts = (n, sel) => Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${i + 1 === sel ? ' selected' : ''}>${i + 1}</option>`).join('');

export function mountDashboard(root) {
  let q = '', selected = null, edit = false, shown = 200, timer = null;
  let activeBom = null, units = 1, lowOnly = false; // mode produk: tampilkan semua part sebuah BOM
  const admin = isAdmin(S.user), canStock = can(S.user, 'stock');

  root.innerHTML = `<section class="dash">
    <div class="panel searchbar">${icon('search')}
      <input id="q" type="search" placeholder="Cari part, produk, atau lokasi (mis. A13)" autocomplete="off" enterkeyhint="search" aria-label="Cari part atau produk">
      <button class="icon-btn" id="qclear" aria-label="Hapus pencarian" hidden>${icon('x')}</button>
      <button class="icon-btn" id="scan" aria-label="Pindai QR code dengan kamera">${icon('camera')}</button>
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
          <button class="btn small" id="lowbtn" hidden></button>
          ${canStock ? `<button class="btn small" id="addpart">${icon('plus')}Part baru</button>` : ''}</div>
        <ul class="list" id="list"></ul>
      </div>
    </div></section>`;

  const input = $('#q', root), list = $('#list', root), split = $('.split', root);

  const map = createMap($('#map', root), {
    onCellTap: (code) => setQuery(code),
    onRackTap: (r) => openRackForm(r),
    onRackMove: async (r, x, y) => {
      const res = await saveRack({ ...r, x, y }, 'move');
      if (!res.ok) { toast(res.error, 'error'); refresh(); }
    },
  });

  // Ganti kata kunci. Bila kata kunci cocok dengan tepat satu produk (dan tidak ada part yang cocok, atau no/nama produknya persis),
  // langsung masuk mode produk: seluruh part produk itu ditampilkan.
  function setQuery(v, fromInput = false) {
    q = v;
    if (!fromInput) input.value = v;
    selected = null; shown = 200; activeBom = null; units = 1;
    if (q) {
      const hits = matchBoms(S.bom, q);
      if (hits.length === 1 && (isExactBom(hits[0], q) || !matchParts(S.parts, q).length)) activeBom = hits[0].id;
    }
    refresh();
  }
  const curBom = () => (activeBom ? S.bom.find((b) => b.id === activeBom) || null : null);

  // ---------- Render ----------
  const results = () => {
    const all = q ? matchParts(S.parts, q) : S.parts.slice().sort(byNo);
    return lowOnly ? all.filter(isLow) : all;
  };

  function hitCodes() {
    const set = new Set();
    const bom = curBom();
    if (bom) {
      for (const l of bomCheck(bom, S.parts, 1).lines) {
        const c = l.part ? codeOf(l.part) : '';
        if (c && (!selected || l.no === selected)) set.add(c);
      }
    } else if (selected) {
      const p = S.parts.find((x) => x.no === selected);
      if (p && codeOf(p)) set.add(codeOf(p));
    } else if (q) {
      results().slice(0, 60).forEach((p) => { const c = codeOf(p); if (c) set.add(c); });
    }
    return set;
  }

  function row(p) {
    const qty = Number(p.qty) || 0, loc = codeOf(p), low = qty > 0 && isLow(p);
    return `<li class="row${p.no === selected ? ' sel' : ''}" data-no="${esc(p.no)}" tabindex="0" role="button" aria-pressed="${p.no === selected}">
      <div class="row-main"><span class="row-name">${esc(p.name)}</span><span class="row-meta">${esc(p.no)}${p.spec ? ' · ' + esc(p.spec) : ''}${low ? ` · <b class="warnc">stok rendah (min ${minOf(p)})</b>` : ''}</span></div>
      <span class="loc">${loc || '–'}</span><span class="qty${qty <= 0 ? ' zero' : low ? ' low' : ''}"${isLow(p) ? ` title="Stok minimum ${minOf(p)}"` : ''}>${qty}</span>
      ${canStock ? `<button class="icon-btn" data-act="stock" aria-label="Ubah stok ${esc(p.name)}">${icon('swap')}</button>` : '<span></span>'}</li>`;
  }

  function prodCard(b) {
    const chk = bomCheck(b, S.parts, 1);
    const info = chk.missing ? 'ada part belum terdaftar' : chk.ok ? 'stok cukup' : `${chk.short} part kurang`;
    return `<li class="row prodhit" data-bom="${esc(b.id)}" tabindex="0" role="button" aria-label="Lihat part produk ${esc(b.product_name)}">
      <div class="row-main"><span class="row-name">${esc(b.product_name)}</span>
        <span class="row-meta">${esc(b.product_no)} · ${b.lines.length} part · <span class="${chk.ok ? 'okc' : 'badc'}">${info}</span></span></div>
      <span class="ptag">Produk</span><span class="chev" aria-hidden="true">›</span><span></span></li>`;
  }

  function brow(l) {
    const loc = l.part ? codeOf(l.part) : '';
    return `<li class="row brow${l.lack > 0 ? ' short' : ''}${l.no === selected ? ' sel' : ''}" data-no="${esc(l.no)}" tabindex="0" role="button" aria-pressed="${l.no === selected}">
      <div class="row-main"><span class="row-name">${esc(l.name || l.no)}${l.missing ? ' <span class="muted">(belum ada di Part)</span>' : ''}</span>
        <span class="row-meta">${esc(l.no)} · stok ${l.stock === null ? '–' : l.stock}${l.lack > 0 ? ` · <b class="badc">kurang ${l.lack}</b>` : ''}</span></div>
      <span class="loc">${loc || '–'}</span><span class="qty${l.lack > 0 ? ' zero' : ''}">−${l.need}</span>
      ${canStock && l.part ? `<button class="icon-btn" data-act="stock" aria-label="Ubah stok ${esc(l.name)}">${icon('swap')}</button>` : '<span></span>'}</li>`;
  }

  function renderBomMode(bom) {
    $('#count', root).textContent = `${bom.lines.length} part untuk ${bom.product_name}`;
    list.innerHTML = `<li class="bomhead">
        <div class="bh-top"><button class="btn small" id="bback">‹ Hasil pencarian</button>
          <div class="bh-title"><b>${esc(bom.product_name)}</b><span class="muted">${esc(bom.product_no)} · ${bom.lines.length} part</span></div></div>
        <div class="bh-ctl"><label class="bh-units">Jumlah produksi
            <span class="ustep"><button type="button" data-ustep="-1" aria-label="Kurangi jumlah">−</button><input id="bunits" type="number" inputmode="numeric" min="1" step="1" value="${units}"><button type="button" data-ustep="1" aria-label="Tambah jumlah">+</button></span></label>
          ${canStock ? '<button class="btn primary" id="bgo">Konfirmasi · potong stok</button>' : ''}</div>
        <p class="preview" id="bsum" role="status"></p>
        ${canStock ? '' : '<p class="muted bh-note">Hanya user dengan izin “ubah data” yang dapat memotong stok.</p>'}
      </li>
      <li class="bcap" aria-hidden="true"><span>Part</span><span>Lokasi</span><span>Potong</span><span></span></li>`;
    paintBom();
  }

  // Isi ulang baris part + ringkasan tanpa menyentuh kolom jumlah (supaya ketikan tidak hilang).
  function paintBom() {
    const bom = curBom();
    if (!bom) return;
    const valid = Number.isInteger(units) && units >= 1;
    const chk = bomCheck(bom, S.parts, valid ? units : 1);
    list.querySelectorAll('.brow').forEach((n) => n.remove());
    list.insertAdjacentHTML('beforeend', chk.lines.map(brow).join(''));
    const total = chk.lines.reduce((a, l) => a + l.need, 0);
    let msg, cls = 'preview ';
    if (!valid) { msg = 'Jumlah produksi minimal 1.'; cls += 'badc'; }
    else if (chk.missing) { msg = `${chk.missing} part belum ada di daftar Part. Tambahkan dulu sebelum memotong stok.`; cls += 'badc'; }
    else if (!chk.ok) { msg = `Stok kurang untuk ${chk.short} part (ditandai merah). Stok tidak bisa dipotong.`; cls += 'badc'; }
    else { msg = `Siap dipotong: ${chk.lines.length} part, total ${total} pcs untuk ${units} unit.`; cls += 'okc'; }
    const sum = $('#bsum', list);
    sum.textContent = msg; sum.className = cls;
    const go = $('#bgo', list);
    if (go) go.disabled = !valid || !chk.ok;
  }

  function renderList() {
    const bom = curBom();
    if (bom) { renderBomMode(bom); return; }
    const res = results(), boms = q && !lowOnly ? matchBoms(S.bom, q) : [];
    $('#count', root).textContent = q ? `${boms.length ? `${boms.length} produk · ` : ''}${res.length} part ditemukan` : `${S.parts.length} part`;
    if (!S.parts.length && !S.bom.length) {
      list.innerHTML = `<li class="empty"><b>Belum ada part</b><span>${canStock ? 'Ketuk “Part baru” untuk menambahkan part pertama.' : 'Minta admin menambahkan part.'}</span></li>`;
    } else if (lowOnly && !res.length) {
      list.innerHTML = '<li class="empty"><b>Tidak ada part dengan stok rendah</b><span>Semua stok di atas batas minimum.</span></li>';
    } else if (!res.length && !boms.length) {
      list.innerHTML = `<li class="empty"><b>Tidak ada hasil untuk “${esc(q)}”</b><span>Coba no item, nama part atau produk, atau kode lokasi seperti A13.</span>
        ${canStock ? '<button class="btn small" id="addq" style="align-self:flex-start;margin-top:6px">Tambah part dengan no item ini</button>' : ''}</li>`;
    } else {
      list.innerHTML = (boms.length ? `<li class="seclabel">Produk (BOM)</li>${boms.slice(0, 20).map(prodCard).join('')}${res.length ? '<li class="seclabel">Part</li>' : ''}` : '') +
        res.slice(0, shown).map(row).join('') +
        (res.length > shown ? `<li class="more"><button class="btn small" id="more">Tampilkan ${res.length - shown} lagi</button></li>` : '');
    }
  }

  function renderMap() {
    map.render(S.racks, new Set(S.parts.map(codeOf).filter(Boolean)), hitCodes(), edit);
  }
  function refresh() {
    if (activeBom && !curBom()) activeBom = null; // BOM dihapus/berubah dari perangkat lain
    split.classList.toggle('bommode', !!activeBom);
    const nLow = S.parts.filter(isLow).length, lb = $('#lowbtn', root);
    lb.hidden = (!nLow && !lowOnly) || !!activeBom;
    lb.textContent = lowOnly ? `Stok rendah · ${nLow} ✕` : `⚠ ${nLow} stok rendah`;
    lb.classList.toggle('primary', lowOnly);
    $('#qclear', root).hidden = !q;
    renderMap(); renderList();
  }

  // ---------- Interaksi ----------
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => setQuery(input.value.trim(), true), 120);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  $('#qclear', root).onclick = () => { setQuery(''); input.focus(); };

  $('#scan', root).onclick = async () => {
    const code = await scanBarcode();
    if (!code) return;
    setQuery(code);
    const exact = S.parts.find((p) => String(p.no).toLowerCase() === code.toLowerCase());
    if (exact && !activeBom) { selected = exact.no; refresh(); }
    if (!exact && !matchParts(S.parts, code).length && !matchBoms(S.bom, code).length) toast(`Kode ${code} tidak ditemukan.`, 'warn');
  };

  $('#lowbtn', root).onclick = () => { lowOnly = !lowOnly; selected = null; shown = 200; refresh(); };

  function pick(li) {
    const no = li.dataset.no;
    selected = selected === no ? null : no;
    refresh();
  }
  function openProduct(id) { activeBom = id; units = 1; selected = null; refresh(); }

  list.addEventListener('click', (e) => {
    if (e.target.closest('#more')) { shown += 200; renderList(); return; }
    if (e.target.closest('#addq')) { openPartForm(null, { preset: { no: q }, onSaved: (no) => { setQuery(no); selected = no; refresh(); } }); return; }
    if (e.target.closest('#bback')) { activeBom = null; selected = null; refresh(); return; }
    const st = e.target.closest('[data-ustep]');
    if (st) {
      units = Math.max(1, (Number.isInteger(units) ? units : 0) + Number(st.dataset.ustep));
      $('#bunits', list).value = units; paintBom(); return;
    }
    if (e.target.closest('#bgo')) {
      const bom = curBom();
      if (bom) useBom(bom, units).then((ok) => { if (ok) refresh(); });
      return;
    }
    const card = e.target.closest('.prodhit');
    if (card) { openProduct(card.dataset.bom); return; }
    const li = e.target.closest('.row');
    if (!li) return;
    if (e.target.closest('[data-act=stock]')) openStock(li.dataset.no); else pick(li);
  });
  list.addEventListener('input', (e) => {
    if (e.target.id !== 'bunits') return;
    units = e.target.value === '' ? 0 : Number(e.target.value);
    paintBom();
  });
  list.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('row')) {
      e.preventDefault();
      if (e.target.classList.contains('prodhit')) openProduct(e.target.dataset.bom); else pick(e.target);
    }
  });

  if (canStock) {
    $('#addpart', root).onclick = () => openPartForm(null, {
      onSaved: (no, isNew) => { if (isNew) { setQuery(no); selected = no; refresh(); } },
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
