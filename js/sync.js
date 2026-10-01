// sync.js — antrean aksi → commit ke GitHub, plus penarikan data terbaru.
import * as db from './db.js';
import * as gh from './github.js';
import { PATHS, targetsOf, kindOfPath, applyOp, defaultRacks, makeUser, ADMIN_PERMS, historyPath } from './core.js';

export const state = { status: 'idle', pending: 0, error: '' };
const listeners = new Set();
export const onStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((f) => f(state));
function setStatus(s) { state.status = s; emit(); }
export async function refreshPending() { state.pending = (await db.getAll('queue')).length; emit(); }

let remoteHandler = null;
export const setRemoteHandler = (fn) => { remoteHandler = fn; };

const PULL = { parts: PATHS.parts, racks: PATHS.racks, users: PATHS.users, bom: PATHS.bom };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Antrean ----------
let timer = null, running = false, rerun = false;
export function schedule(ms = 800) { clearTimeout(timer); timer = setTimeout(flush, ms); }

export async function enqueue(op) {
  op.targets = targetsOf(op);
  op.done = [];
  await db.put('queue', op);
  await refreshPending();
  schedule();
}

async function pushFile(path, ops) {
  const kind = kindOfPath(path);
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await gh.readFile(path);
    const items = r.missing ? [] : r.items;
    const sha = r.missing ? null : r.sha;
    for (const o of ops) applyOp(o, kind, items);
    const msg = ops.length === 1 ? ops[0].msg : `${ops.length} perubahan`;
    try {
      await gh.writeFile(path, items, sha, msg || 'Perubahan data');
      return;
    } catch (e) {
      if (e.status === 409 && attempt < 4) { await sleep(300 + Math.random() * 600); continue; }
      throw e;
    }
  }
}

async function flushOnce() {
  if (!gh.cfg.get()) return;
  if (!navigator.onLine) { setStatus('offline'); return; }
  const ops = (await db.getAll('queue')).sort((a, b) => a.qid - b.qid);
  if (!ops.length) { if (state.status !== 'ok') setStatus('ok'); return; }
  setStatus('syncing');
  try {
    const paths = [...new Set(ops.flatMap((o) => o.targets.filter((t) => !o.done.includes(t))))];
    for (const path of paths) {
      const mine = ops.filter((o) => o.targets.includes(path) && !o.done.includes(path));
      await pushFile(path, mine);
      for (const o of mine) {
        o.done.push(path);
        if (o.targets.every((t) => o.done.includes(t))) await db.del('queue', o.qid);
        else await db.put('queue', o);
      }
    }
    state.error = '';
    await refreshPending();
    setStatus('ok');
    if (!(await db.getAll('queue')).length) await pull();
  } catch (e) {
    rerun = false;
    await refreshPending();
    if (e.status === 0) { setStatus('offline'); schedule(15000); return; }
    state.error = e.message;
    setStatus('error');
    if (e.status !== 401 && e.status !== 403) schedule(30000);
  }
}

export async function flush() {
  if (running) { rerun = true; return; }
  running = true;
  try {
    do { rerun = false; await flushOnce(); } while (rerun);
  } finally { running = false; }
}

// ---------- Tarik data terbaru ----------
export async function pull() {
  if (!gh.cfg.get() || !navigator.onLine) return false;
  if ((await db.getAll('queue')).length) return false; // aksi lokal belum terkirim
  let changed = false;
  try {
    for (const [store, path] of Object.entries(PULL)) {
      const etag = await db.getMeta('etag:' + path);
      const r = await gh.readFile(path, etag);
      if (r.notModified || r.missing) continue;
      await db.replaceAll(store, r.items);
      await db.setMeta('etag:' + path, r.etag);
      changed = true;
    }
    if (['error', 'offline', 'idle'].includes(state.status)) { state.error = ''; setStatus('ok'); }
  } catch (e) {
    if (e.status === 0) setStatus('offline');
    else { state.error = e.message; setStatus('error'); }
    return false;
  }
  if (changed && remoteHandler) remoteHandler();
  return changed;
}

// ---------- Inisialisasi repo data (sekali) ----------
export async function ensureSeed() {
  const seeds = {
    [PATHS.parts]: async () => [],
    [PATHS.racks]: async () => defaultRacks(),
    [PATHS.bom]: async () => [],
    [PATHS.users]: async () => [await makeUser({
      username: 'admin', name: 'Administrator', role: 'admin',
      password: 'admin123', perms: { ...ADMIN_PERMS }, mustChange: true,
    })],
  };
  for (const [path, make] of Object.entries(seeds)) {
    if (await db.getMeta('seed:' + path)) continue; // sudah dicek di perangkat ini
    const r = await gh.readFile(path);
    if (r.missing) {
      try { await gh.writeFile(path, await make(), null, `Inisialisasi ${path}`); }
      catch (e) { if (e.status !== 409) throw e; }
    }
    await db.setMeta('seed:' + path, 1);
  }
}

// ---------- Riwayat (dibaca dari GitHub per bulan, di-cache untuk offline) ----------
export async function historyMonths() {
  try {
    const names = await gh.listDir('data');
    const months = names.map((n) => (/^history-(\d{4}-\d{2})\.json$/.exec(n) || [])[1]).filter(Boolean);
    await db.setMeta('hist:months', months);
    return months;
  } catch { return db.getMeta('hist:months', []); }
}

// Hasil: { items, error, offline } — sudah digabung dengan aksi lokal yang belum terkirim.
export async function loadHistory(month) {
  const path = historyPath(month + '-01');
  const key = 'hist:' + month;
  const cached = await db.getMeta(key, null);
  let items = cached ? cached.items : [], error = '', offline = false;
  try {
    const r = await gh.readFile(path, cached && cached.etag);
    if (r.items) { items = r.items; await db.setMeta(key, { etag: r.etag, items }); }
    else if (r.missing) items = [];
  } catch (e) { error = e.message; offline = e.status === 0; }
  const seen = new Set(items.map((h) => h.id));
  for (const o of await db.getAll('queue')) {
    if (o.done.includes(path)) continue;
    // Satu operasi bisa membawa banyak catatan riwayat (potong stok BOM, opname).
    for (const h of o.histories || (o.history ? [o.history] : [])) {
      if (h.ts.slice(0, 7) === month && !seen.has(h.id)) { items = items.concat(h); seen.add(h.id); }
    }
  }
  return { items, error, offline };
}

// ---------- Otomatis ----------
let auto = null;
export function startAuto() {
  if (auto) return;
  auto = setInterval(() => { if (!document.hidden) flush().then(() => pull()); }, 30000);
  window.addEventListener('online', () => flush());
  window.addEventListener('offline', () => setStatus('offline'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  refreshPending();
  flush();
}
