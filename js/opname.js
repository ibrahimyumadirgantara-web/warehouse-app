// opname.js — tab "Opname": stok opname per rak.
// Alur: pilih rak → isi hitungan fisik tiap part → tinjau selisih → simpan (stok sistem diganti sesuai hitungan).
// Hitungan yang belum selesai disimpan sebagai draf di perangkat ini, jadi aman bila aplikasi tertutup.
import { S, saveOpname } from './store.js';
import { codeOf } from './core.js';
import { $, esc, icon, modal, toast, confirmDialog } from './ui.js';
import { scanBarcode } from './scanner.js';
import { notifyLow } from './forms.js';

const draftKey = (id) => `swl.opname.${id}`;
function loadDraft(id) {
  try { const d = JSON.parse(localStorage.getItem(draftKey(id))); return d && d.counts ? d : null; } catch { return null; }
}
const saveDraft = (id, counts) => {
  const keep = Object.fromEntries(Object.entries(counts).filter(([, v]) => v !== ''));
  if (Object.keys(keep).length) localStorage.setItem(draftKey(id), JSON.stringify({ t: Date.now(), counts: keep }));
  else localStorage.removeItem(draftKey(id));
};
const clearDraft = (id) => localStorage.removeItem(draftKey(id));

const userName = (u) => (S.users.find((x) => x.username === u) || {}).name || u;
const fmtDate = (ts) => new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const DAY = 86400000;

// Urutan jalan di rak: baris dulu (atas → bawah), lalu kolom.
const partsOf = (rackId) => S.parts.filter((p) => p.rack === rackId)
  .sort((a, b) => a.row - b.row || a.col - b.col || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));

// "" = belum dihitung, null = bukan bilangan bulat ≥ 0, selain itu angka.
const parseCount = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return '';
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

export function opnameTab(acts, body) {
  let rackId = null, counts = {};
  acts.innerHTML = '<span class="muted" style="font-size:13px">Hitung stok fisik per rak, lalu samakan dengan stok sistem.</span>';

  // ---------- Daftar rak ----------
  function renderRacks() {
    rackId = null;
    if (!S.racks.length) {
      body.innerHTML = '<div class="empty"><b>Belum ada rak</b><span>Buat rak dulu di Dashboard → Atur rak.</span></div>';
      return;
    }
    body.innerHTML = `<div class="tcount">Pilih rak yang akan dihitung</div><div class="bomgrid">${S.racks.map((r) => {
      const n = partsOf(r.id).length, d = loadDraft(r.id), last = r.lastOpname;
      const old = last && Date.now() - new Date(last.ts).getTime() > 30 * DAY;
      const lastTxt = last
        ? `Opname terakhir ${fmtDate(last.ts)} oleh ${esc(userName(last.by))} · ${last.diff ? `${last.diff} selisih` : 'sesuai'}`
        : 'Belum pernah di-opname';
      return `<button class="bomcard" data-rack="${esc(r.id)}"${n ? '' : ' disabled'}>
        <b>Rak ${esc(r.id)}</b><span class="muted">${n ? `${n} part` : 'Tidak ada part'} · ${r.cols} kolom × ${r.rows} baris</span>
        <span class="${last ? (old ? 'warnc' : 'muted') : 'warnc'}">${lastTxt}</span>
        ${d ? `<span class="okc">Draf tersimpan · ${Object.keys(d.counts).length} part terisi</span>` : ''}</button>`;
    }).join('')}</div>`;
  }

  // ---------- Lembar hitung ----------
  function startSheet(id) {
    const d = loadDraft(id);
    rackId = id;
    counts = d ? { ...d.counts } : {};
    renderSheet();
    if (d) toast('Melanjutkan hitungan yang tersimpan', 'info');
  }

  function renderSheet() {
    const parts = partsOf(rackId);
    body.innerHTML = `<div class="osheet-head">
        <div class="oh-row"><button class="btn small" id="oback">‹ Pilih rak</button>
          <div class="oh-title"><b>Opname Rak ${esc(rackId)}</b><span class="muted" id="oprog"></span></div></div>
        <div class="oh-row oh-acts"><button class="btn small" id="oscan">${icon('camera')}Pindai part</button>
          <button class="btn small" id="ofill">Sisanya sesuai sistem</button>
          <button class="btn small danger" id="oreset">Ulangi</button>
          <button class="btn primary" id="ofinish">Selesai · tinjau</button></div></div>
      <div class="tbl"><div class="orow thead"><span>Part</span><span>Lokasi</span><span class="r">Sistem</span><span class="r">Hitung</span></div>
      ${parts.map((p) => `<div class="orow" data-no="${esc(p.no)}">
        <span class="oname"><b>${esc(p.name)}</b><span class="muted mono">${esc(p.no)}${p.spec ? ' · ' + esc(p.spec) : ''}</span></span>
        <span><span class="loc">${esc(codeOf(p))}</span></span>
        <span class="r mono">${Number(p.qty) || 0}</span>
        <span class="r ocell"><span class="odiff" aria-live="polite"></span><input class="ocount" type="number" inputmode="numeric" enterkeyhint="next" min="0" step="1" data-no="${esc(p.no)}" value="${esc(counts[p.no] ?? '')}" aria-label="Hitungan ${esc(p.name)}"></span></div>`).join('')}</div>`;
    body.querySelectorAll('.orow[data-no]').forEach(paintRow);
    paintProgress();
  }

  function paintRow(rowEl) {
    const no = rowEl.dataset.no, p = S.parts.find((x) => x.no === no);
    const v = parseCount(counts[no]), tag = rowEl.querySelector('.odiff');
    rowEl.classList.remove('bad', 'diff', 'same');
    if (v === '' || !p) { tag.textContent = ''; return; }
    if (v === null) { tag.textContent = '!'; rowEl.classList.add('bad'); return; }
    const d = v - (Number(p.qty) || 0);
    tag.textContent = d === 0 ? '✓' : d > 0 ? `+${d}` : `−${-d}`;
    rowEl.classList.add(d === 0 ? 'same' : 'diff');
    tag.className = 'odiff ' + (d === 0 ? 'okc' : d > 0 ? 'okc' : 'badc');
  }

  function stats() {
    const parts = partsOf(rackId);
    let counted = 0, diff = 0, bad = 0;
    for (const p of parts) {
      const v = parseCount(counts[p.no]);
      if (v === '') continue;
      if (v === null) { bad++; continue; }
      counted++;
      if (v !== (Number(p.qty) || 0)) diff++;
    }
    return { total: parts.length, counted, diff, bad, skipped: parts.length - counted - bad };
  }
  function paintProgress() {
    const s = stats();
    const el = $('#oprog', body);
    if (el) el.textContent = `${s.counted} dari ${s.total} terisi · ${s.diff} selisih`;
  }

  // ---------- Tinjau & simpan ----------
  function review() {
    const s = stats();
    if (s.bad) { toast('Ada hitungan yang bukan bilangan bulat (ditandai !). Perbaiki dulu.', 'error'); return; }
    if (!s.counted) { toast('Belum ada part yang dihitung.', 'warn'); return; }
    const parts = partsOf(rackId);
    const entries = [], diffs = [];
    for (const p of parts) {
      const v = parseCount(counts[p.no]);
      if (v === '' || v === null) continue;
      entries.push({ no: p.no, counted: v });
      const sys = Number(p.qty) || 0;
      if (v !== sys) diffs.push({ p, sys, v });
    }
    const m = modal({
      title: `Tinjau opname Rak ${rackId}`, wide: true,
      body: `<div class="stats"><div><b>${s.counted}</b><span>part dihitung</span></div><div class="${s.diff ? 'bad' : ''}"><b>${s.diff}</b><span>selisih</span></div><div><b>${s.skipped}</b><span>dilewati</span></div></div>
        ${s.skipped ? `<p class="muted">${s.skipped} part belum diisi dan <b>tidak diubah</b>.</p>` : ''}
        ${diffs.length ? `<p class="section-title">Stok sistem akan diganti menjadi hitungan fisik</p>
          <div class="tblwrap"><table class="btbl"><thead><tr><th>Part</th><th>Lokasi</th><th class="r">Sistem</th><th class="r">Hitung</th><th class="r">Selisih</th></tr></thead><tbody>
          ${diffs.map(({ p, sys, v }) => `<tr><td>${esc(p.name)} <span class="muted mono">${esc(p.no)}</span></td><td><span class="loc">${esc(codeOf(p))}</span></td><td class="r">${sys}</td><td class="r">${v}</td>
            <td class="r"><b class="${v > sys ? 'okc' : 'badc'}">${v > sys ? '+' : '−'}${Math.abs(v - sys)}</b></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="okc">Semua hitungan sama dengan stok sistem. Opname tetap dicatat.</p>'}
        <p class="err" id="oerr" role="alert"></p>`,
      footer: '<button class="btn" data-close>Kembali</button><button class="btn primary" id="osave">Simpan opname</button>',
    });
    m.$('#osave').onclick = async () => {
      m.$('#osave').disabled = true;
      const r = await saveOpname(rackId, entries, s.skipped);
      if (!r.ok) { m.$('#oerr').textContent = r.error; m.$('#osave').disabled = false; return; }
      const id = rackId;
      clearDraft(id);
      m.close();
      toast(`Opname Rak ${id} selesai: ${r.counted} dihitung, ${r.diff} selisih`, 'ok');
      notifyLow(r.low);
      renderRacks();
    };
  }

  // ---------- Interaksi ----------
  body.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-rack]');
    if (card && !rackId) { startSheet(card.dataset.rack); return; }
    if (!rackId) return;
    if (e.target.closest('#oback')) { saveDraft(rackId, counts); renderRacks(); return; }
    if (e.target.closest('#ofinish')) { review(); return; }
    if (e.target.closest('#oreset')) {
      if (await confirmDialog(`Kosongkan semua hitungan Rak ${rackId} dan mulai dari awal?`, 'Kosongkan', true)) {
        counts = {}; clearDraft(rackId); renderSheet();
      }
      return;
    }
    if (e.target.closest('#ofill')) {
      const blanks = partsOf(rackId).filter((p) => parseCount(counts[p.no]) === '');
      if (!blanks.length) { toast('Semua part sudah terisi.', 'info'); return; }
      if (await confirmDialog(`Isi ${blanks.length} part yang belum dihitung dengan stok sistem? Pakai hanya bila fisiknya sudah Anda periksa dan cocok.`, 'Isi sesuai sistem')) {
        for (const p of blanks) counts[p.no] = String(Number(p.qty) || 0);
        saveDraft(rackId, counts); renderSheet();
      }
      return;
    }
    if (e.target.closest('#oscan')) {
      const code = await scanBarcode();
      if (!code) return;
      const lc = String(code).trim().toLowerCase();
      const mine = partsOf(rackId).find((p) => String(p.no).toLowerCase() === lc);
      if (mine) {
        const inp = body.querySelector(`.ocount[data-no="${CSS.escape(mine.no)}"]`);
        if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); inp.select(); }
        return;
      }
      const other = S.parts.find((p) => String(p.no).toLowerCase() === lc);
      toast(other ? `${other.name} ada di ${codeOf(other) || 'tanpa lokasi'}, bukan di Rak ${rackId}.` : `Kode ${code} tidak ditemukan.`, 'warn');
    }
  });
  body.addEventListener('input', (e) => {
    const inp = e.target.closest('.ocount');
    if (!inp || !rackId) return;
    counts[inp.dataset.no] = inp.value;
    saveDraft(rackId, counts);
    paintRow(inp.closest('.orow'));
    paintProgress();
  });
  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.classList.contains('ocount')) return;
    e.preventDefault();
    const all = [...body.querySelectorAll('.ocount')];
    const next = all[all.indexOf(e.target) + 1];
    if (next) { next.focus(); next.select(); } else e.target.blur();
  });

  renderRacks();
  return {
    refresh() { if (!rackId) renderRacks(); },
    destroy() { if (rackId) saveDraft(rackId, counts); },
  };
}
