// app.js — boot, tema, mode tampilan (mobile/desktop), koneksi GitHub, login, menu.
import * as db from './db.js';
import * as gh from './github.js';
import * as sync from './sync.js';
import * as store from './store.js';
import { S } from './store.js';
import { can, isAdmin, hashPassword, lowParts } from './core.js';
import { $, $$, esc, icon, logoSvg, modal, toast } from './ui.js';
import { mountDashboard } from './dashboard.js';
import { mountParts } from './parts.js';
import { mountUsers } from './users.js';
import { mountReport } from './report.js';

const root = document.documentElement;
const app = document.getElementById('app');
let current = 'dashboard', viewApi = null;

// ---------- Tema & tampilan ----------
const getTheme = () => root.dataset.theme || 'light';
function setTheme(t) {
  localStorage.setItem('swl.theme', t);
  root.dataset.theme = t;
  $('meta[name=theme-color]').content = t === 'dark' ? '#18212A' : '#1D5FD1';
  const b = $('#theme');
  if (b) b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
}
const viewMode = () => localStorage.getItem('swl.view') || 'auto';
function applyLayout() {
  const m = viewMode();
  root.dataset.layout = m === 'auto' ? (innerWidth < 820 ? 'mobile' : 'desktop') : m;
  $('meta[name=viewport]').content = m === 'desktop' ? 'width=1100' : 'width=device-width, initial-scale=1, viewport-fit=cover';
}
addEventListener('resize', applyLayout);

const VIEWS = {
  dashboard: { label: 'Dashboard', icon: 'dashboard', perm: 'dashboard', mount: mountDashboard },
  parts: { label: 'Part & BOM', icon: 'box', perm: 'parts', mount: mountParts },
  users: { label: 'User', icon: 'users', admin: true, mount: mountUsers },
  report: { label: 'Riwayat', icon: 'history', perm: 'report', mount: mountReport },
};

// ---------- Rangka utama ----------
function renderShell() {
  const items = Object.entries(VIEWS).filter(([, v]) => (v.admin ? isAdmin(S.user) : can(S.user, v.perm)));
  if (!items.length) { app.innerHTML = '<div class="stub"><div><h2>Tidak ada akses</h2><p>Akun ini belum diberi akses menu apa pun. Hubungi admin.</p></div></div>'; return; }
  if (!items.some(([k]) => k === current)) current = items[0][0];
  app.innerHTML = `<div id="shell">
    <div class="brand">${logoSvg}<span>Smart Warehouse</span></div>
    <nav class="nav" aria-label="Menu utama">${items.map(([k, v]) =>
      `<button data-view="${k}"${k === current ? ' aria-current="page"' : ''}>${icon(v.icon)}<span>${v.label}</span>${k === 'parts' ? '<b class="nbadge" id="nlow" hidden></b>' : ''}</button>`).join('')}</nav>
    <div class="tools"><button class="chip" id="sync"></button>
      <button class="icon-btn" id="theme" aria-label="Ganti tema terang/gelap"></button>
      <button class="icon-btn" id="menu" aria-label="Pengaturan">${icon('menu')}</button></div>
    <main id="view"></main></div>`;
  $('#theme').innerHTML = icon(getTheme() === 'dark' ? 'sun' : 'moon');
  $('#theme').onclick = () => setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  $('#menu').onclick = openSettings;
  $('#sync').onclick = () => { if (sync.state.error) toast(sync.state.error, 'error'); sync.flush().then(() => sync.pull()); };
  $$('.nav button').forEach((b) => b.addEventListener('click', () => openView(b.dataset.view)));
  renderSync();
  updateLowBadge();
  openView(current);
}
// Lencana jumlah part yang stoknya di bawah/sama dengan stok minimum.
function updateLowBadge() {
  const el = $('#nlow');
  if (!el) return;
  const n = lowParts(S.parts).length;
  el.hidden = !n;
  el.textContent = n > 99 ? '99+' : n;
  el.title = `${n} part stok rendah`;
  el.setAttribute('aria-label', `${n} part stok rendah`);
}
function openView(k) {
  current = k;
  if (viewApi && viewApi.destroy) viewApi.destroy();
  $$('.nav button').forEach((b) => (b.dataset.view === k ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  const host = $('#view');
  host.innerHTML = '';
  viewApi = VIEWS[k].mount(host) || null;
}

function renderSync() {
  const el = $('#sync');
  if (!el) return;
  const s = sync.state;
  const map = { ok: ['', 'Tersinkron'], idle: ['', 'Siap'], syncing: ['busy', 'Menyimpan…'], offline: ['warn', 'Offline'], error: ['err', 'Gagal sinkron'] };
  const [cls, base] = map[s.status] || map.idle;
  const text = s.pending && !['syncing', 'error'].includes(s.status) ? `${s.pending} menunggu` : base;
  el.className = 'chip ' + cls;
  el.innerHTML = `<i></i><span>${text}</span>`;
  el.title = s.error || text;
  el.setAttribute('aria-label', `Status sinkronisasi: ${text}`);
}

// ---------- Setup koneksi GitHub ----------
function showSetup(message = '') {
  const c = gh.cfg.get() || {};
  app.innerHTML = `<div class="auth"><form class="panel auth-card" id="setup" novalidate>
    <h1>${logoSvg}Hubungkan ke GitHub</h1>
    <p class="muted">Data gudang disimpan di repo GitHub <b>private</b> milik Anda. Isi sekali di setiap perangkat.</p>
    <details><summary>Belum punya repo dan token?</summary><ol>
      <li>Buat repo baru (mis. <b>warehouse-data</b>), pilih <b>Private</b>, centang <b>Add a README</b>.</li>
      <li>GitHub → Settings → Developer settings → Fine-grained tokens → Generate.</li>
      <li>Repository access: <b>Only select repositories</b> → pilih repo data tadi.</li>
      <li>Permissions → Repository → <b>Contents: Read and write</b>. Salin token.</li></ol></details>
    <div class="form">
      <label>Akun / organisasi GitHub<input name="owner" value="${esc(c.owner || '')}" autocomplete="off" autocapitalize="off"></label>
      <label>Nama repo data<input name="repo" value="${esc(c.repo || '')}" autocomplete="off" autocapitalize="off"></label>
      <label>Branch<input name="branch" value="${esc(c.branch || 'main')}" autocomplete="off" autocapitalize="off"></label>
      <label>Token<input name="token" type="password" value="${esc(c.token || '')}" autocomplete="off"></label>
      <p class="err" id="serr" role="alert">${esc(message)}</p>
      <button class="btn primary" id="go" type="submit">Hubungkan</button></div></form></div>`;
  const f = $('#setup');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (n) => f.elements[n].value.trim();
    const conf = { owner: v('owner'), repo: v('repo'), branch: v('branch') || 'main', token: v('token') };
    if (!conf.owner || !conf.repo || !conf.token) { $('#serr').textContent = 'Akun, nama repo, dan token wajib diisi.'; return; }
    const btn = $('#go');
    btn.disabled = true; btn.textContent = 'Menghubungkan…'; $('#serr').textContent = '';
    try {
      const info = await gh.testRepo(conf);
      if (!info.canPush) throw new Error('Token tidak punya izin menulis. Beri izin Contents: Read and write.');
      const prev = gh.cfg.get();
      if (!prev || prev.owner !== conf.owner || prev.repo !== conf.repo || prev.branch !== conf.branch) await db.clearAll();
      gh.cfg.set(conf);
      await sync.ensureSeed();
      await sync.pull();
      await store.loadLocal();
      if (!info.isPrivate) toast('Peringatan: repo ini publik, data stok bisa dilihat siapa saja.', 'warn');
      showLogin();
    } catch (err) {
      $('#serr').textContent = err.message || 'Gagal terhubung.';
      btn.disabled = false; btn.textContent = 'Hubungkan';
    }
  });
}

// ---------- Login ----------
const SESSION = 'swl.session', SESSION_MS = 12 * 3600 * 1000;
function showLogin(message = '') {
  S.user = null;
  localStorage.removeItem(SESSION);
  app.innerHTML = `<div class="auth"><form class="panel auth-card" id="login" novalidate>
    <h1>${logoSvg}Smart Warehouse</h1>
    <div class="form">
      <label>Username<input name="u" autocomplete="username" autocapitalize="off" autofocus></label>
      <label>Password<input name="p" type="password" autocomplete="current-password"></label>
      <p class="err" id="lerr" role="alert">${esc(message)}</p>
      <button class="btn primary" type="submit">Masuk</button>
      <button class="btn" type="button" id="conn">Ubah koneksi GitHub</button></div></form></div>`;
  $('#conn').onclick = () => showSetup();
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const u = S.users.find((x) => x.username === f.elements.u.value.trim().toLowerCase() && x.active !== false);
    const ok = u && (await hashPassword(f.elements.p.value, u.salt)) === u.hash;
    if (!ok) { $('#lerr').textContent = S.users.length ? 'Username atau password salah.' : 'Data user belum tersedia. Periksa koneksi lalu coba lagi.'; return; }
    enter(u);
  });
}
function enter(u) {
  S.user = u;
  localStorage.setItem(SESSION, JSON.stringify({ u: u.username, t: Date.now() }));
  renderShell();
  const low = lowParts(S.parts).length;
  if (low && can(u, 'parts')) toast(`${low} part stok rendah. Buka Part & BOM → Stok rendah.`, 'warn');
  sync.startAuto();
  sync.ensureSeed().then(() => sync.pull()).catch(() => {}); // repo lama: buat data/bom.json bila belum ada
  if (u.mustChange) passwordModal(true);
}

function passwordModal(forced) {
  const m = modal({
    title: forced ? 'Ganti password bawaan' : 'Ganti password', dismissible: !forced,
    body: `<form class="form" id="pw" novalidate>${forced ? '<p class="muted" style="margin:0">Password bawaan harus diganti sebelum melanjutkan.</p>' : ''}
      <label>Password baru<input name="a" type="password" autocomplete="new-password"></label>
      <label>Ulangi password<input name="b" type="password" autocomplete="new-password"></label>
      <p class="err" id="perr" role="alert"></p></form>`,
    footer: '<button class="btn primary" id="ok">Simpan password</button>',
  });
  const f = m.$('#pw');
  async function save() {
    const a = f.elements.a.value, b = f.elements.b.value;
    if (a.length < 6) { m.$('#perr').textContent = 'Minimal 6 karakter.'; return; }
    if (a !== b) { m.$('#perr').textContent = 'Kedua password tidak sama.'; return; }
    await store.changePassword(S.user.username, a);
    m.close(); toast('Password diganti', 'ok');
  }
  m.$('#ok').onclick = save;
  f.addEventListener('submit', (e) => { e.preventDefault(); save(); });
}

// ---------- Pengaturan ----------
function openSettings() {
  const c = gh.cfg.get() || {};
  const m = modal({
    title: 'Pengaturan',
    body: `<div class="section-title">Tampilan</div>
      <div class="segset" id="vm">${[['auto', 'Otomatis'], ['mobile', 'Mobile'], ['desktop', 'Desktop']].map(([k, l]) =>
        `<button data-v="${k}" aria-pressed="${viewMode() === k}">${l}</button>`).join('')}</div>
      <div class="section-title">Sinkronisasi GitHub</div>
      <div class="kv"><span class="muted">Repo data</span><span>${esc(c.owner)}/${esc(c.repo)}</span></div>
      <div class="kv"><span class="muted">Status</span><span id="st"></span></div>
      <div class="section-title">Akun</div>
      <div class="kv"><span class="muted">Masuk sebagai</span><span>${esc(S.user.name)} (${esc(S.user.username)})</span></div>`,
    footer: '<button class="btn danger" id="out">Keluar</button><button class="btn" id="cpw">Ganti password</button><button class="btn" id="now">Sinkron sekarang</button>',
  });
  const st = () => { const s = sync.state; m.$('#st').textContent = s.error ? s.error : ({ ok: 'Tersinkron', idle: 'Siap', syncing: 'Menyimpan…', offline: 'Offline' }[s.status] || s.status) + (s.pending ? ` · ${s.pending} menunggu` : ''); };
  st();
  m.el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('swl.view', b.dataset.v); applyLayout();
    m.el.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  m.$('#now').onclick = async () => { await sync.flush(); await sync.pull(); st(); toast('Sinkronisasi selesai', 'ok'); };
  m.$('#cpw').onclick = () => { m.close(); passwordModal(false); };
  m.$('#out').onclick = () => { m.close(); if (viewApi && viewApi.destroy) viewApi.destroy(); viewApi = null; showLogin(); };
}

// ---------- Boot ----------
async function boot() {
  setTheme(getTheme());
  applyLayout();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  sync.onStatus(renderSync);
  store.onChange(updateLowBadge);
  sync.setRemoteHandler(async () => {
    const sig = () => JSON.stringify(S.user ? [S.user.role, S.user.perms] : null);
    const before = sig();
    await store.loadLocal();
    if (!S.user && $('#shell')) { showLogin('Sesi berakhir atau akun dinonaktifkan. Masuk kembali.'); return; }
    if (S.user && sig() !== before && $('#shell')) { renderShell(); return; } // hak akses diubah admin
    store.emit();
  });

  await store.loadLocal();
  if (!gh.cfg.get()) return showSetup();
  if (!S.users.length) {
    try { await sync.pull(); await store.loadLocal(); } catch { /* ditangani di bawah */ }
    if (!S.users.length) return showSetup('Data belum bisa diambil dari GitHub. Periksa koneksi dan token.');
  } else {
    sync.pull(); // segarkan di latar belakang
  }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SESSION)); } catch { /* abaikan */ }
  const u = saved && Date.now() - saved.t < SESSION_MS && S.users.find((x) => x.username === saved.u && x.active !== false);
  if (u) enter(u); else showLogin();
}
boot();
