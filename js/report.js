// report.js — riwayat aksi per user (dibaca dari data/history-YYYY-MM.json di GitHub).
import { S } from './store.js';
import * as sync from './sync.js';
import { writeWorkbook, downloadBytes } from './xlsx.js';
import { $, esc, icon, toast } from './ui.js';

const LABEL = {
  stock_in: ['Stok masuk', 'in'], stock_out: ['Stok keluar', 'out'], part_add: ['Part baru', 'chg'], part_edit: ['Ubah part', 'chg'],
  part_delete: ['Hapus part', 'out'], import_parts: ['Impor part', 'chg'], bom_import: ['Impor BOM', 'chg'], bom_delete: ['Hapus BOM', 'out'],
  rack_add: ['Rak baru', 'chg'], rack_move: ['Geser rak', 'chg'], rack_edit: ['Ubah rak', 'chg'], rack_delete: ['Hapus rak', 'out'],
  bom_use: ['Produksi', 'out'], bom_edit: ['Ubah BOM', 'chg'], opname_adjust: ['Opname: selisih', 'chg'], opname_done: ['Opname selesai', 'chg'],
  user_add: ['User baru', 'chg'], user_edit: ['Ubah user', 'chg'], user_password: ['Ganti password', 'chg'], user_reset: ['Reset password', 'chg'],
};
const GROUPS = [['', 'Semua aksi'], ['stock', 'Stok masuk/keluar'], ['part', 'Part & impor'], ['bom', 'BOM'], ['opname', 'Opname'], ['rack', 'Rak'], ['user', 'User']];
const inGroup = (a, g) => !g || (g === 'stock' ? a.startsWith('stock_') : g === 'part' ? a.startsWith('part_') || a === 'import_parts' : a.startsWith(g + '_'));
const monthNow = () => new Date().toISOString().slice(0, 7);
const fmt = (ts) => new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const userName = (u) => (S.users.find((x) => x.username === u) || {}).name || u;
// Nama aksi. Untuk pemakaian BOM, tampilkan nama produknya (data lama: diambil dari catatan "N × Nama (NO)").
const actLabel = (h) => {
  if (h.action !== 'bom_use') return (LABEL[h.action] || [h.action])[0];
  if (h.product) return h.product;
  const m = /^\d+ × (.+) \([^)]*\)$/.exec(h.note || '');
  return m ? m[1] : 'Produksi';
};
const isQty = (a) => a === 'stock_in' || a === 'stock_out' || a === 'bom_use' || a === 'opname_adjust';
const change = (h) => (isQty(h.action) ? `${h.delta > 0 ? '+' : ''}${h.delta}` : h.note || '');

export function mountReport(root) {
  let month = monthNow(), months = [], data = { items: [], error: '', offline: false }, f = { user: '', group: '', q: '' }, loading = false, alive = true;
  root.innerHTML = `<section class="pv"><div class="pv-top">
      <select id="rmonth" aria-label="Bulan"></select>
      <select id="ruser" aria-label="Filter user"></select>
      <select id="rgroup" aria-label="Filter jenis aksi">${GROUPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <div class="filter"><input id="rq" type="search" placeholder="Cari no item / nama / catatan…" autocomplete="off" aria-label="Cari riwayat"></div>
      <button class="btn small" id="rexp">${icon('download')}Ekspor</button></div>
    <div class="pv-body panel" id="rbody"></div></section>`;
  const body = $('#rbody', root);

  function fillMonths() {
    const set = new Set([...months, monthNow(), month]);
    const list = [...set].sort().reverse();
    const sel = $('#rmonth', root);
    sel.innerHTML = list.map((m) => `<option value="${m}"${m === month ? ' selected' : ''}>${new Date(m + '-15').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</option>`).join('');
  }
  function fillUsers() {
    const names = new Set([...S.users.map((u) => u.username), ...data.items.map((h) => h.by)]);
    $('#ruser', root).innerHTML = '<option value="">Semua user</option>' + [...names].sort().map((u) => `<option value="${esc(u)}"${u === f.user ? ' selected' : ''}>${esc(userName(u))}</option>`).join('');
  }

  const filtered = () => {
    const q = f.q.toLowerCase();
    return data.items.filter((h) => (!f.user || h.by === f.user) && inGroup(h.action, f.group) &&
      (!q || `${h.no || ''} ${h.name || ''} ${h.note || ''} ${h.product || ''} ${h.loc || ''} ${userName(h.by)}`.toLowerCase().includes(q)))
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
  };

  function render() {
    if (loading) { body.innerHTML = '<div class="empty"><span>Memuat riwayat…</span></div>'; return; }
    const list = filtered();
    const inn = list.filter((h) => h.action === 'stock_in').reduce((s, h) => s + h.delta, 0);
    const out = list.filter((h) => h.action === 'stock_out' || h.action === 'bom_use').reduce((s, h) => s - h.delta, 0);
    const notice = data.error ? `<div class="notice">${data.offline ? 'Offline — menampilkan data tersimpan terakhir.' : esc(data.error)}</div>` : '';
    if (!list.length) { body.innerHTML = `${notice}<div class="empty"><b>Tidak ada aksi</b><span>${data.items.length ? 'Tidak ada yang cocok dengan filter.' : 'Belum ada aksi tercatat pada bulan ini.'}</span></div>`; return; }
    body.innerHTML = `${notice}<div class="tcount" aria-live="polite">${list.length} aksi · <span class="okc">masuk ${inn}</span> · <span class="badc">keluar ${out}</span></div>
      <div class="tbl"><div class="hrow thead"><span>Waktu / User</span><span>Aksi</span><span>Part / Objek</span><span class="r">Perubahan</span><span class="r hide-m">Stok akhir</span></div>` +
      list.slice(0, 500).map((h) => {
        const lab = actLabel(h), kind = (LABEL[h.action] || [0, 'chg'])[1];
        const noteLine = isQty(h.action) && h.note ? `<span class="hnote">${esc(h.note)}</span>` : '';
        return `<div class="hrow"><span class="hwho"><b>${fmt(h.ts)}</b><span class="muted">${esc(userName(h.by))}</span></span>
          <span><span class="act ${kind}">${esc(lab)}</span></span>
          <span class="hitem"><b>${esc(h.no && h.no !== '-' ? h.no : '')}</b> <span class="muted">${h.name && h.name !== h.no ? esc(h.name) : ''}</span>${h.loc ? ` <span class="loc">${esc(h.loc)}</span>` : ''}${noteLine}</span>
          <span class="r hchg ${kind}">${esc(change(h))}</span><span class="r hide-m mono">${h.after === undefined || h.after === null ? '' : h.after}</span></div>`;
      }).join('') + (list.length > 500 ? `<div class="more muted">Menampilkan 500 dari ${list.length}. Persempit filter atau ekspor ke Excel.</div>` : '') + '</div>';
  }

  async function load() {
    loading = true; render();
    const mine = month;
    const res = await sync.loadHistory(month);
    if (!alive || mine !== month) return;
    data = res; loading = false; fillUsers(); render();
  }

  $('#rmonth', root).addEventListener('change', (e) => { month = e.target.value; load(); });
  $('#ruser', root).addEventListener('change', (e) => { f.user = e.target.value; render(); });
  $('#rgroup', root).addEventListener('change', (e) => { f.group = e.target.value; render(); });
  $('#rq', root).addEventListener('input', (e) => { f.q = e.target.value.trim(); render(); });
  $('#rexp', root).onclick = () => {
    const list = filtered();
    if (!list.length) return toast('Tidak ada data untuk diekspor.', 'warn');
    const H = ['Waktu', 'User', 'Aksi', 'No Item', 'Nama', 'Perubahan', 'Stok Akhir', 'Lokasi', 'Catatan'].map((v) => ({ v, s: 'h' }));
    const rows = list.map((h) => [new Date(h.ts).toLocaleString('id-ID', { hour12: false }), userName(h.by), actLabel(h), h.no || '', h.name || '',
      isQty(h.action) ? h.delta : '', h.after ?? '', h.loc || '', h.note || '']);
    downloadBytes(writeWorkbook([{ name: 'Riwayat', freeze: 1, widths: [20, 22, 16, 18, 30, 12, 12, 10, 40], rows: [H, ...rows] }]), `riwayat-${month}.xlsx`);
  };

  fillMonths(); fillUsers();
  load();
  sync.historyMonths().then((m) => { if (alive) { months = m; fillMonths(); } });
  return { refresh() {}, destroy() { alive = false; } };
}
