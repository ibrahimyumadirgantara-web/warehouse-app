// github.js — baca/tulis file JSON di repo data (private) lewat GitHub Contents API.
import { serialize } from './core.js';

const API = 'https://api.github.com';
const KEY = 'swl.cfg';

export const cfg = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set(c) { localStorage.setItem(KEY, JSON.stringify(c)); },
  clear() { localStorage.removeItem(KEY); },
};

export class GhError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function gh(path, { method = 'GET', body, etag, conf } = {}) {
  const c = conf || cfg.get();
  if (!c) throw new GhError(0, 'Belum terhubung ke GitHub.');
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${c.token}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (etag) headers['If-None-Match'] = etag;
  try {
    return await fetch(API + path, { method, headers, cache: 'no-store', body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new GhError(0, 'Tidak ada koneksi internet.');
  }
}

async function fail(res) {
  let m = '';
  try { m = (await res.json()).message; } catch { /* abaikan */ }
  const known = {
    401: 'Token ditolak GitHub. Periksa token atau masa berlakunya.',
    403: 'Akses ditolak atau batas request GitHub tercapai. Coba lagi sebentar.',
    404: 'Repo atau file tidak ditemukan. Periksa nama repo dan izin token.',
  };
  return new GhError(res.status, known[res.status] || m || `GitHub error ${res.status}`);
}

function enc(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function dec(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(u);
}

const base = (c) => `/repos/${c.owner}/${c.repo}`;

export async function testRepo(conf) {
  const res = await gh(base(conf), { conf });
  if (!res.ok) throw await fail(res);
  const j = await res.json();
  return { isPrivate: !!j.private, canPush: j.permissions ? !!j.permissions.push : true };
}

// Hasil: {notModified} | {missing} | {items, sha, etag}
export async function readFile(path, etag) {
  const c = cfg.get();
  const res = await gh(`${base(c)}/contents/${path}?ref=${encodeURIComponent(c.branch || 'main')}`, { etag });
  if (res.status === 304) return { notModified: true };
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw await fail(res);
  const j = await res.json();
  let text;
  if (j.content) text = dec(j.content);
  else { // file > 1 MB: ambil lewat blob API
    const b = await gh(`${base(c)}/git/blobs/${j.sha}`);
    if (!b.ok) throw await fail(b);
    text = dec((await b.json()).content);
  }
  const data = JSON.parse(text);
  return { items: Array.isArray(data.items) ? data.items : [], sha: j.sha, etag: res.headers.get('ETag') };
}

export async function writeFile(path, items, sha, message) {
  const c = cfg.get();
  const body = { message, content: enc(serialize(items)), branch: c.branch || 'main' };
  if (sha) body.sha = sha;
  const res = await gh(`${base(c)}/contents/${path}`, { method: 'PUT', body });
  if (res.status === 409 || res.status === 422) throw new GhError(409, 'Data di GitHub baru saja berubah (konflik).');
  if (!res.ok) throw await fail(res);
  return { sha: (await res.json()).content.sha };
}
