// store.js — state aplikasi + aksi. Perubahan langsung terlihat (lokal), lalu masuk antrean sync.
import * as db from './db.js';
import * as sync from './sync.js';
import { applyOp, uid, codeOf, clampRack, hashPassword, randomSalt } from './core.js';

export const S = { parts: [], racks: [], users: [], user: null };
const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const emit = () => subs.forEach((f) => f());

export async function loadLocal() {
  S.parts = await db.getAll('parts');
  S.racks = (await db.getAll('racks')).sort((a, b) => a.id.localeCompare(b.id));
  S.users = await db.getAll('users');
  if (S.user) {
    const u = S.users.find((x) => x.username === S.user.username);
    S.user = u && u.active !== false ? u : null;
  }
}

const H = (action, fields = {}) => ({ id: uid(), ts: new Date().toISOString(), by: S.user.username, action, ...fields });

async function commit(op) {
  op.msg = `${op.msg} (${S.user.username})`;
  for (const kind of ['parts', 'racks', 'users']) applyOp(op, kind, S[kind]);
  if (op.type === 'rack.delete') await db.del('racks', op.id);
  else if (op.type === 'rack.upsert') await db.put('racks', S.racks.find((r) => r.id === op.rack.id));
  else if (op.type === 'user.upsert') await db.put('users', S.users.find((u) => u.username === op.user.username));
  else {
    const rec = S.parts.find((p) => p.no === (op.part ? op.part.no : op.no));
    if (rec) await db.put('parts', rec);
  }
  S.racks.sort((a, b) => a.id.localeCompare(b.id));
  await sync.enqueue(op);
  emit();
}

export async function adjustStock(no, delta, note = '') {
  const p = S.parts.find((x) => x.no === no);
  if (!p) return { ok: false, error: 'Part tidak ditemukan.' };
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: 'Jumlah harus bilangan bulat.' };
  const after = (Number(p.qty) || 0) + delta;
  if (after < 0) return { ok: false, error: 'Stok tidak cukup.' };
  await commit({
    type: 'stock.adjust', no, delta,
    msg: `Stok ${no} ${delta > 0 ? '+' : ''}${delta}`,
    history: H(delta > 0 ? 'stock_in' : 'stock_out', { no, name: p.name, delta, after, loc: codeOf(p), note }),
  });
  return { ok: true, after };
}

export async function savePart(part, isNew) {
  if (isNew && S.parts.some((p) => p.no === part.no)) return { ok: false, error: 'No item sudah dipakai part lain.' };
  await commit({
    type: 'part.upsert', part, isNew,
    msg: `${isNew ? 'Part baru' : 'Ubah part'} ${part.no}`,
    history: H(isNew ? 'part_add' : 'part_edit', { no: part.no, name: part.name, loc: codeOf(part), delta: isNew ? part.qty : 0, after: part.qty }),
  });
  return { ok: true };
}

export async function saveRack(rack, mode) {
  if (mode === 'add' && S.racks.some((r) => r.id === rack.id)) return { ok: false, error: `Rak ${rack.id} sudah ada.` };
  if (mode === 'edit' && S.parts.some((p) => p.rack === rack.id && (p.col > rack.cols || p.row > rack.rows))) {
    return { ok: false, error: 'Ada part di kolom/baris yang akan hilang. Pindahkan part itu dulu.' };
  }
  clampRack(rack);
  await commit({
    type: 'rack.upsert', rack,
    msg: `Rak ${rack.id} ${mode === 'add' ? 'ditambah' : mode === 'move' ? 'digeser' : 'diubah'}`,
    history: H('rack_' + mode, { no: rack.id, name: `Rak ${rack.id}`, note: `${rack.cols}x${rack.rows} @ ${rack.x},${rack.y}` }),
  });
  return { ok: true };
}

export async function deleteRack(id) {
  if (S.parts.some((p) => p.rack === id)) return { ok: false, error: 'Masih ada part di rak ini. Pindahkan dulu.' };
  await commit({ type: 'rack.delete', id, msg: `Rak ${id} dihapus`, history: H('rack_delete', { no: id, name: `Rak ${id}` }) });
  return { ok: true };
}

export async function changePassword(username, password) {
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  await commit({
    type: 'user.upsert', user: { username, salt, hash, mustChange: false },
    msg: `Ganti password ${username}`,
    history: H('user_password', { no: username, name: username }),
  });
  if (S.user && S.user.username === username) S.user = S.users.find((u) => u.username === username) || S.user;
}
