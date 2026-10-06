// bom.js — tab BOM: daftar produk, detail kebutuhan vs stok, impor/ekspor Excel.
import { S, saveBom, deleteBom, editBom } from './store.js';
import { can, isAdmin, bomCheck, bomKind, KIND_TAG, inAsmOf } from './core.js';
import { useBom, openPartForm, receiveBom } from './forms.js';
import { matchParts } from './search.js';
import { readWorkbook, writeWorkbook, downloadBytes } from './xlsx.js';
import { parseBomSheets, bomsToSheets, bomTemplate } from './sheets.js';
import { esc, icon, modal, toast, confirmDialog, pickFile, today, safeName } from './ui.js';

const errs = (list, max = 4) => (list.length
  ? `<ul class="errlist">${list.slice(0, max).map((e) => `<li>Baris ${e.line}${e.no ? ` (${esc(e.no)})` : ''}: ${esc(e.msg)}</li>`).join('')}${list.length > max ? `<li>…dan ${list.length - max} lainnya</li>` : ''}</ul>` : '');

// Berapa unit produk yang bisa dibuat dari stok sekarang (null jika ada part yang tidak ada di sistem).
function buildable(bom) {
  let min = Infinity;
  for (const l of bom.lines) {
    const p = S.parts.find((x) => x.no === l.no);
    if (!p) return null;
    min = Math.min(min, Math.floor((Number(p.qty) || 0) / l.qty));
  }
  return Number.isFinite(min) ? min : 0;
}

export function bomTab(acts, body) {
  const canEdit = can(S.user, 'stock');
  acts.innerHTML = `${canEdit ? `<button class="btn small" id="imp">${icon('upload')}Impor BOM</button>` : ''}
    <button class="btn small" id="expall">${icon('download')}Ekspor semua</button>
    ${canEdit ? `<button class="btn small" id="tpl">${icon('file')}Template</button>` : ''}`;

  function render() {
    if (!S.bom.length) {
      body.innerHTML = `<div class="empty"><b>Belum ada BOM</b><span>${canEdit ? 'Unduh Template BOM, isi produk dan daftar part-nya, lalu ketuk Impor BOM.' : 'Minta admin mengimpor BOM.'}</span></div>`;
      return;
    }
    body.innerHTML = `<div class="tcount">${S.bom.length} produk</div><div class="bomgrid">${S.bom.map((b) => {
      const n = buildable(b);
      const info = n === null ? 'Ada part yang belum ada di daftar Part' : n > 0 ? `Stok cukup untuk ${n} unit` : 'Stok belum cukup untuk 1 unit';
      const k = bomKind(b), out = S.parts.find((x) => x.no === b.product_no), asm = out ? inAsmOf(out) : 0;
      return `<button class="bomcard" data-id="${esc(b.id)}"><b>${esc(b.product_name)}</b><span class="muted">${esc(b.product_no)} · ${b.lines.length} part · hasil <span class="ktag ${k}">${KIND_TAG[k]}</span></span>
        <span class="${n ? 'okc' : 'badc'}">${info}</span>
        <span class="muted">Hasil di gudang: ${out ? Number(out.qty) || 0 : 0}${asm ? ` · <b class="asmc">di assembly ${asm}</b>` : ''}</span></button>`;
    }).join('')}</div>`;
  }

  body.addEventListener('click', (e) => {
    const c = e.target.closest('.bomcard');
    if (c) openDetail(c.dataset.id);
  });
  acts.querySelector('#expall').onclick = () => {
    if (!S.bom.length) return toast('Belum ada BOM untuk diekspor.', 'warn');
    downloadBytes(writeWorkbook(bomsToSheets(S.bom, S.parts)), `bom-semua-${today()}.xlsx`);
  };
  if (canEdit) {
    acts.querySelector('#tpl').onclick = () => downloadBytes(writeWorkbook(bomTemplate()), 'template-bom.xlsx');
    acts.querySelector('#imp').onclick = startImport;
  }

  function openDetail(id) {
    const b = S.bom.find((x) => x.id === id);
    if (!b) return;
    const m = modal({
      title: b.product_name, wide: true,
      body: `<p class="muted" style="margin-top:0">${esc(b.product_no)} · ${b.lines.length} part · hasil <span class="ktag ${bomKind(b)}">${KIND_TAG[bomKind(b)]}</span></p>
        <p class="bh-out" id="outline"></p>
        <div class="form" style="flex-direction:row;align-items:end;gap:12px;flex-wrap:wrap">
          <label style="width:150px">Jumlah produksi<input id="units" type="number" inputmode="numeric" min="1" step="1" value="1"></label>
          <p class="preview" id="sum" style="flex:1"></p></div>
        <div class="tblwrap"><table class="btbl"><thead><tr><th>No Item</th><th>Nama Part</th><th class="r">Butuh</th><th class="r">Stok</th><th>Lokasi</th><th class="r">Kurang</th></tr></thead><tbody id="rows"></tbody></table></div>`,
      footer: `${canEdit && isAdmin(S.user) ? '<button class="btn danger" id="del">Hapus BOM</button>' : ''}${canEdit ? '<button class="btn" id="edit">Edit BOM</button>' : ''}<button class="btn" id="exp">${icon('download')}Ekspor Excel</button>${canEdit ? '<button class="btn" id="recv">Terima hasil</button><button class="btn primary" id="use">Kirim ke assembly</button>' : '<button class="btn primary" data-close>Tutup</button>'}`,
    });
    const units = m.$('#units');
    function paint() {
      const u = Math.max(1, Math.floor(Number(units.value)) || 1);
      let short = 0;
      m.$('#rows').innerHTML = b.lines.map((l) => {
        const p = S.parts.find((x) => x.no === l.no);
        const need = l.qty * u, stock = p ? Number(p.qty) || 0 : null, lack = p ? Math.max(0, need - stock) : need;
        if (lack > 0) short++;
        return `<tr class="${lack > 0 ? 'short' : ''}"><td class="mono">${esc(l.no)}</td><td>${esc(p ? p.name : l.name || '')}${p ? '' : ' <span class="muted">(belum ada di Part)</span>'}</td>
          <td class="r">${need}</td><td class="r">${stock === null ? '–' : stock}</td>
          <td>${p && p.rack ? `<span class="loc">${esc(p.rack)}${p.col}${p.row}</span>` : '–'}</td><td class="r"><b>${lack || ''}</b></td></tr>`;
      }).join('');
      const n = buildable(b);
      m.$('#sum').textContent = short ? `Untuk ${u} unit, ${short} part kurang.` : `Stok cukup untuk ${u} unit.`;
      m.$('#sum').className = 'preview ' + (short ? 'badc' : 'okc');
      if (n !== null && short) m.$('#sum').textContent += ` Stok sekarang cukup untuk ${n} unit.`;
      const use = m.$('#use');
      if (use) use.disabled = !bomCheck(b, S.parts, u).ok;
      const out = S.parts.find((x) => x.no === b.product_no);
      m.$('#outline').innerHTML = `Hasil ${KIND_TAG[bomKind(b)]} di gudang: <b>${out ? Number(out.qty) || 0 : 0}</b> · sedang di assembly: <b class="${out && inAsmOf(out) ? 'asmc' : ''}">${out ? inAsmOf(out) : 0}</b>`;
    }
    units.addEventListener('input', paint);
    paint();
    m.$('#exp').onclick = () => downloadBytes(writeWorkbook(bomsToSheets([b], S.parts)), `bom-${safeName(b.product_no)}-${today()}.xlsx`);
    const ed = m.$('#edit');
    if (ed) ed.onclick = () => { m.close(); openBomEdit(b.id, () => openDetail(b.id)); };
    const recv = m.$('#recv');
    if (recv) recv.onclick = async () => { m.close(); await receiveBom(b); };
    const use = m.$('#use');
    if (use) use.onclick = async () => {
      const u = Math.max(1, Math.floor(Number(units.value)) || 1);
      m.close();
      await useBom(b, u);
    };
    const del = m.$('#del');
    if (del) del.onclick = async () => {
      m.close();
      if (await confirmDialog(`Hapus BOM ${b.product_name} (${b.product_no})? Tindakan ini tercatat di riwayat.`, 'Hapus BOM', true)) {
        const r = await deleteBom(b.id);
        if (r.ok) toast('BOM dihapus', 'ok'); else toast(r.error, 'error');
      }
    };
  }

  async function startImport() {
    const file = await pickFile('.xlsx,.csv');
    if (!file) return;
    let sheets;
    try { sheets = await readWorkbook(file); } catch (e) { toast(e.message || 'File tidak bisa dibaca.', 'error'); return; }
    const results = parseBomSheets(sheets, S.racks, S.parts);
    if (!results.length) { toast('Tidak ada sheet BOM di file ini.', 'error'); return; }
    const okRes = results.filter((r) => r.ok);
    const m = modal({
      title: 'Pratinjau impor BOM', wide: true,
      body: `<p class="muted" style="margin-top:0">${esc(file.name)} · ${results.length} sheet</p>` + results.map((r) => r.ok
        ? `<div class="bomprev"><b>${esc(r.bom.product_name)}</b> <span class="muted">${esc(r.bom.product_no)} · sheet “${esc(r.sheet)}”</span> <span class="ktag ${bomKind(r.bom)}">hasil ${KIND_TAG[bomKind(r.bom)]}</span>
            <div>${r.bom.lines.length} part${r.newParts.length ? `, <b>${r.newParts.length} part baru</b> dibuat dengan stok 0` : ''}</div>
            ${S.bom.some((b) => b.id === r.bom.id) ? '<div class="warnc">BOM dengan No Item Produk ini sudah ada dan akan diganti.</div>' : ''}
            ${errs(r.errors)}${errs(r.warnings)}${r.errors.length ? '<div class="muted">Baris bermasalah dilewati.</div>' : ''}</div>`
        : `<div class="bomprev bad"><b>Sheet “${esc(r.sheet)}” dilewati</b><div>${esc(r.error)}</div></div>`).join(''),
      footer: '<button class="btn" data-close>Batal</button><button class="btn primary" id="go"></button>',
    });
    const go = m.$('#go');
    go.textContent = `Impor ${okRes.length} BOM`;
    go.disabled = !okRes.length;
    go.onclick = async () => {
      go.disabled = true;
      let n = 0;
      for (const r of okRes) { const x = await saveBom(r.bom, r.newParts, file.name); if (x.ok) n++; else toast(x.error, 'error'); }
      m.close();
      toast(`${n} BOM diimpor`, 'ok');
    };
  }

  render();
  return { refresh: render, destroy() {} };
}

// ---------- Edit BOM: ubah nama produk, tambah/hapus part, ubah qty per unit ----------
// onDone dipanggil setelah dialog ditutup (disimpan atau dibatalkan).
export function openBomEdit(id, onDone) {
  const src = S.bom.find((x) => x.id === id);
  if (!src) return;
  let lines = src.lines.map((l) => ({ ...l }));
  const m = modal({
    title: 'Edit BOM', wide: true, onClose: () => { if (onDone) onDone(); },
    body: `<div class="form">
        <label>Nama produk<input id="bname" value="${esc(src.product_name)}" autocomplete="off"></label>
        <p class="muted" style="margin:0">No item produk: <b class="mono">${esc(src.product_no)}</b> (tidak bisa diubah)</p>
        <label>Hasil BOM ini<select id="bkind"><option value="wip"${bomKind(src) === 'wip' ? ' selected' : ''}>WIP (setengah jadi) — kembali ke gudang, lalu dirakit lagi</option><option value="jadi"${bomKind(src) === 'jadi' ? ' selected' : ''}>Produk jadi — siap dijual</option></select></label>
        <label>Tambah part ke BOM<span class="inrow"><input id="badd" type="search" placeholder="Cari no item atau nama part…" autocomplete="off">
          <button type="button" class="btn small" id="bnew">${icon('plus')}Part baru</button></span></label>
        <div id="bres" class="bres" hidden></div>
        <div class="tblwrap"><table class="btbl"><thead><tr><th>No Item</th><th>Nama Part</th><th class="r">Stok</th><th class="r">Qty / unit</th><th></th></tr></thead><tbody id="blines"></tbody></table></div>
        <p class="err" id="berr" role="alert"></p></div>`,
    footer: '<button class="btn" data-close>Batal</button><button class="btn primary" id="bsave">Simpan perubahan</button>',
  });
  const paint = () => {
    m.$('#blines').innerHTML = lines.length ? lines.map((l, i) => {
      const p = S.parts.find((x) => x.no === l.no);
      return `<tr><td class="mono">${esc(l.no)}</td><td>${esc(p ? p.name : l.name || '')}${p ? '' : ' <span class="muted">(belum ada di Part)</span>'}</td>
        <td class="r">${p ? Number(p.qty) || 0 : '–'}</td>
        <td class="r"><input class="bqty" type="number" inputmode="numeric" min="1" step="1" value="${l.qty}" data-i="${i}" aria-label="Qty per unit ${esc(l.no)}"></td>
        <td class="r"><button class="icon-btn" data-rm="${i}" aria-label="Hapus ${esc(l.no)} dari BOM">${icon('x')}</button></td></tr>`;
    }).join('') : '<tr><td colspan="5" class="muted">BOM kosong. Tambahkan minimal satu part.</td></tr>';
  };
  paint();

  const add = (no) => {
    if (lines.some((l) => l.no === no)) return;
    const p = S.parts.find((x) => x.no === no);
    lines.push({ no, qty: 1, name: p ? p.name : '' });
    m.$('#badd').value = ''; m.$('#bres').hidden = true;
    paint();
    const inputs = m.el.querySelectorAll('.bqty');
    const last = inputs[inputs.length - 1];
    if (last) { last.scrollIntoView({ block: 'nearest' }); last.focus(); last.select(); }
  };
  m.$('#badd').addEventListener('input', (e) => {
    const q = e.target.value.trim(), box = m.$('#bres');
    if (!q) { box.hidden = true; return; }
    const have = new Set(lines.map((l) => l.no));
    const hits = matchParts(S.parts, q).filter((p) => !have.has(p.no)).slice(0, 8);
    box.hidden = false;
    box.innerHTML = hits.length ? hits.map((p) => `<button type="button" class="bhit" data-add="${esc(p.no)}"><span><b>${esc(p.name)}</b><span class="muted mono"> ${esc(p.no)}</span></span><span class="loc">${esc(p.rack ? `${p.rack}${p.col}${p.row}` : '–')}</span></button>`).join('')
      : `<div class="muted" style="padding:8px 10px">Tidak ada part cocok yang belum ada di BOM.</div>`;
  });
  m.el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-add]');
    if (a) { add(a.dataset.add); return; }
    const r = e.target.closest('[data-rm]');
    if (r) { lines.splice(Number(r.dataset.rm), 1); paint(); }
  });
  m.el.addEventListener('input', (e) => {
    const q = e.target.closest('.bqty');
    if (q) lines[Number(q.dataset.i)].qty = q.value === '' ? 0 : Number(q.value);
  });
  m.$('#bnew').onclick = () => openPartForm(null, { preset: { no: m.$('#badd').value.trim() }, onSaved: (no) => add(no) });
  m.$('#bsave').onclick = async () => {
    const r = await editBom(id, m.$('#bname').value, lines, m.$('#bkind').value);
    if (!r.ok) { m.$('#berr').textContent = r.error; return; }
    m.close();
    toast(r.unchanged ? 'Tidak ada perubahan' : 'BOM diperbarui', r.unchanged ? 'info' : 'ok');
  };
}
