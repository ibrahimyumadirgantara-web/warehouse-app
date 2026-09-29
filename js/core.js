// core.js — logika murni (tanpa DOM / jaringan). Dipakai UI, store, dan sync.

export const MAP_W = 720, MAP_H = 480;
export const CELL_W = 46, CELL_H = 34, RACK_HEAD = 24, GRID = 10, MAX_DIM = 9;
// true: baris 1 di paling atas rak. Ubah ke false jika baris 1 = paling bawah.
export const ROW1_ON_TOP = true;

export const PATHS = {
  parts: 'data/parts.json',
  racks: 'data/racks.json',
  users: 'data/users.json',
};

export const ADMIN_PERMS = { dashboard: true, parts: true, users: true, report: true, stock: true };
export const DEFAULT_PERMS = { dashboard: true, parts: true, users: false, report: false, stock: true };

export const can = (u, k) => !!u && (u.role === 'admin' || !!(u.perms && u.perms[k]));
export const isAdmin = (u) => !!u && u.role === 'admin';

export const uid = () =>
  (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// ---------- Lokasi & rak ----------
export const codeOf = (p) => (p && p.rack ? `${String(p.rack).toUpperCase()}${p.col}${p.row}` : '');

export function rackSize(r) {
  return { w: r.cols * CELL_W, h: RACK_HEAD + r.rows * CELL_H };
}
export const snap = (v) => Math.round(v / GRID) * GRID;
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export function clampRack(r) {
  const { w, h } = rackSize(r);
  r.x = clamp(r.x, 0, MAP_W - w);
  r.y = clamp(r.y, 0, MAP_H - h);
  return r;
}

export function findFreeSpot(racks, cols, rows) {
  const w = cols * CELL_W, h = RACK_HEAD + rows * CELL_H, pad = 12;
  for (let y = 20; y <= MAP_H - h; y += GRID * 2) {
    for (let x = 20; x <= MAP_W - w; x += GRID * 2) {
      const clash = racks.some((r) => {
        const s = rackSize(r);
        return x < r.x + s.w + pad && x + w + pad > r.x && y < r.y + s.h + pad && y + h + pad > r.y;
      });
      if (!clash) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

export function nextRackId(racks) {
  const used = new Set(racks.map((r) => r.id));
  for (let i = 65; i <= 90; i++) if (!used.has(String.fromCharCode(i))) return String.fromCharCode(i);
  return '';
}

export const defaultRacks = () => [
  { id: 'A', x: 40, y: 40, cols: 4, rows: 4 },
  { id: 'B', x: 260, y: 40, cols: 4, rows: 4 },
  { id: 'C', x: 480, y: 40, cols: 3, rows: 5 },
];

// ---------- Pencarian ----------
export function matchParts(parts, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/);
  const out = [];
  for (const p of parts) {
    const no = String(p.no).toLowerCase();
    const name = String(p.name || '').toLowerCase();
    const code = codeOf(p).toLowerCase();
    const hay = `${no} ${name} ${String(p.spec || '').toLowerCase()} ${code}`;
    if (!tokens.every((t) => hay.includes(t))) continue;
    let s = 40;
    if (no === q || (code && code === q)) s = 100;
    else if (no.startsWith(tokens[0])) s = 80;
    else if (name.startsWith(tokens[0])) s = 60;
    out.push([s, p]);
  }
  return out
    .sort((a, b) => b[0] - a[0] || String(a[1].no).localeCompare(String(b[1].no), undefined, { numeric: true }))
    .map((x) => x[1]);
}

// ---------- Operasi (dipakai lokal DAN saat sync ke GitHub) ----------
export const historyPath = (ts) => `data/history-${String(ts).slice(0, 7)}.json`;

export function kindOfPath(p) {
  if (p === PATHS.parts) return 'parts';
  if (p === PATHS.racks) return 'racks';
  if (p === PATHS.users) return 'users';
  if (String(p).startsWith('data/history-')) return 'history';
  return null;
}

export function targetsOf(op) {
  const t = [];
  const k = op.type.split('.')[0];
  if (k === 'part' || k === 'stock') t.push(PATHS.parts);
  if (k === 'rack') t.push(PATHS.racks);
  if (k === 'user') t.push(PATHS.users);
  if (op.history) t.push(historyPath(op.history.ts));
  return t;
}

// Mengubah `items` di tempat. Stok memakai selisih (delta) agar dua user
// yang mengubah stok bersamaan tidak saling menimpa.
export function applyOp(op, kind, items) {
  if (kind === 'history') {
    if (op.history && !items.some((h) => h.id === op.history.id)) items.push(op.history);
    return items;
  }
  if (kind === 'parts') {
    if (op.type === 'part.upsert') {
      const p = op.part;
      const cur = items.find((x) => x.no === p.no);
      if (cur) Object.assign(cur, { name: p.name, spec: p.spec, rack: p.rack, col: p.col, row: p.row });
      else if (op.isNew) items.push({ ...p });
    } else if (op.type === 'stock.adjust') {
      const cur = items.find((x) => x.no === op.no);
      if (cur) cur.qty = Math.max(0, (Number(cur.qty) || 0) + op.delta);
    }
  } else if (kind === 'racks') {
    if (op.type === 'rack.upsert') {
      const i = items.findIndex((x) => x.id === op.rack.id);
      if (i >= 0) items[i] = { ...items[i], ...op.rack };
      else items.push({ ...op.rack });
    } else if (op.type === 'rack.delete') {
      const i = items.findIndex((x) => x.id === op.id);
      if (i >= 0) items.splice(i, 1);
    }
  } else if (kind === 'users') {
    if (op.type === 'user.upsert') {
      const i = items.findIndex((x) => x.username === op.user.username);
      if (i >= 0) items[i] = { ...items[i], ...op.user };
      else items.push({ ...op.user });
    }
  }
  return items;
}

// Satu record per baris → diff commit rapi dan file lebih kecil.
export function serialize(items) {
  return '{"version":1,"items":[\n' + items.map((i) => JSON.stringify(i)).join(',\n') + '\n]}\n';
}

// ---------- Password ----------
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function hashPassword(pw, salt) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pw}`)));
}
export const randomSalt = () => hex(crypto.getRandomValues(new Uint8Array(12)));

export async function makeUser({ username, name, role = 'user', password, perms, mustChange = false }) {
  const salt = randomSalt();
  return {
    username: String(username).trim().toLowerCase(),
    name, role,
    perms: perms || { ...DEFAULT_PERMS },
    salt, hash: await hashPassword(password, salt),
    mustChange, active: true,
  };
}
