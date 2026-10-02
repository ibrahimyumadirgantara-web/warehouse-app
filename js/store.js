// store.js — state aplikasi + aksi. Perubahan langsung terlihat (lokal), lalu masuk antrean sync.
import * as db from './db.js';
import * as sync from './sync.js';
import { applyOp, uid, codeOf, clampRack, hashPassword, randomSalt, makeUser, bomCheck, kindOf, bomKind, inAsmOf, IN_REASONS, OUT_REASONS, REASON_SHORT } from './core.js';

export const S = { parts: [], racks: [], users: [], bom: [], user: null };
const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const emit = () => subs.forEach((f) => f());

export async function loadLocal() {
  S.parts = await db.getAll('parts');
  S.racks = (await db.getAll('racks')).sort((a, b) => a.id.localeCompare(b.id));
  S.users = await db.getAll('users');
  S.bom = (await db.getAll('bom')).sort((a, b) => String(a.product_no).localeCompare(String(b.product_no), undefined, { numeric: true }));
  if (S.user) {
    const u = S.users.find((x) => x.username === S.user.username);
    S.user = u && u.active !== false ? u : null;
  }
}

const H = (action, fields = {}) => ({ id: uid(), ts: new Date().toISOString(), by: S.user.username, action, ...fields });

async function commit(op) {
  op.msg = `${op.msg} (${S.user.username})`;
  for (const kind of ['parts', 'racks', 'users', 'bom']) applyOp(op, kind, S[kind]);
  const t = op.type;
  if (t === 'rack.delete') await db.del('racks', op.id);
  else if (t === 'rack.upsert') await db.put('racks', S.racks.find((r) => r.id === op.rack.id));
  else if (t === 'user.upsert') await db.put('users', S.users.find((u) => u.username === op.user.username));
  else if (t === 'bom.delete') await db.del('bom', op.id);
  else if (t === 'bom.upsert') {
    await db.put('bom', S.bom.find((b) => b.id === op.bom.id));
    if ((op.newParts && op.newParts.length) || op.output) await db.replaceAll('parts', S.parts);
  } else if (t === 'part.import') await db.replaceAll('parts', S.parts);
  else if (t === 'part.delete') await db.del('parts', op.no);
  else if (t === 'stock.batch') {
    if (op.adjusts.length > 20) await db.replaceAll('parts', S.parts);
    else for (const a of op.adjusts) { const rec = S.parts.find((p) => p.no === a.no); if (rec) await db.put('parts', rec); }
    if (op.asm) { const rec = S.parts.find((p) => p.no === op.asm.no); if (rec) await db.put('parts', rec); }
    if (op.rackOpname) { const r = S.racks.find((x) => x.id === op.rackOpname.id); if (r) await db.put('racks', r); }
  } else {
    const rec = S.parts.find((p) => p.no === (op.part ? op.part.no : op.no));
    if (rec) await db.put('parts', rec);
  }
  S.racks.sort((a, b) => a.id.localeCompare(b.id));
  S.bom.sort((a, b) => String(a.product_no).localeCompare(String(b.product_no), undefined, { numeric: true }));
  await sync.enqueue(op);
  emit();
}

// Part yang baru jatuh ke/di bawah stok minimum akibat perubahan ini (sebelumnya masih di atas).
const crossedLow = (p, before, after) => (Number(p.min) > 0 && before > Number(p.min) && after <= Number(p.min) ? [{ no: p.no, name: p.name, qty: after, min: Number(p.min) }] : []);

// reason: status pergerakan (lihat IN_REASONS / OUT_REASONS). closeAsm: saat menerima hasil assembly, tutup sisa yang masih "di assembly".
export async function adjustStock(no, delta, note = '', reason = '', closeAsm = false) {
  const p = S.parts.find((x) => x.no === no);
  if (!p) return { ok: false, error: 'Part tidak ditemukan.' };
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: 'Jumlah harus bilangan bulat.' };
  const dir = delta > 0 ? 'in' : 'out';
  if (!(dir === 'in' ? IN_REASONS : OUT_REASONS).some(([c]) => c === reason)) return { ok: false, error: 'Pilih status pergerakan stok dulu.' };
  note = String(note || '').trim();
  if (reason === 'lain' && !note) return { ok: false, error: 'Status “Lainnya” wajib diberi alasan.' };
  const before = Number(p.qty) || 0, after = before + delta;
  if (after < 0) return { ok: false, error: 'Stok tidak cukup.' };
  const low = crossedLow(p, before, after);
  const closing = !!closeAsm && dir === 'in' && reason === 'assembly' && !!kindOf(p) && inAsmOf(p) > 0;
  await commit({
    type: 'stock.adjust', no, delta, reason, ...(closing ? { closeAsm: true } : {}),
    msg: `Stok ${no} ${delta > 0 ? '+' : ''}${delta} (${REASON_SHORT[dir][reason]})`,
    history: H(delta > 0 ? 'stock_in' : 'stock_out', { no, name: p.name, delta, after, loc: codeOf(p), reason, note: closing ? [note, 'sisa di assembly ditutup'].filter(Boolean).join(' · ') : note }),
  });
  return { ok: true, after, low };
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

// ---------- Tahap 2: hapus part, impor Part, BOM ----------
export async function deletePart(no) {
  const p = S.parts.find((x) => x.no === no);
  if (!p) return { ok: false, error: 'Part tidak ditemukan.' };
  await commit({
    type: 'part.delete', no, msg: `Part ${no} dihapus`,
    history: H('part_delete', { no, name: p.name, loc: codeOf(p), delta: -(Number(p.qty) || 0), after: 0 }),
  });
  return { ok: true };
}

// rows: [{no,name,spec,qty,rack,col,row}] — update=true: part yang sudah ada diperbarui (qty diganti sesuai file).
export async function importParts(rows, update, fileName) {
  const have = new Set(S.parts.map((p) => p.no));
  const added = rows.filter((r) => !have.has(r.no)).length;
  const updated = update ? rows.length - added : 0;
  if (!added && !updated) return { ok: false, error: 'Tidak ada part untuk diimpor.' };
  await commit({
    type: 'part.import', rows, update: !!update, msg: `Impor part: ${added} baru, ${updated} diperbarui`,
    history: H('import_parts', { no: '-', name: fileName || 'file Excel', delta: added + updated, note: `${added} baru, ${updated} diperbarui` }),
  });
  return { ok: true, added, updated };
}

export async function saveBom(bom, newParts, fileName) {
  const replaced = S.bom.some((b) => b.id === bom.id);
  bom = { ...bom, kind: bomKind(bom) };
  await commit({
    type: 'bom.upsert', bom, newParts, output: { no: bom.product_no, name: bom.product_name, kind: bom.kind },
    msg: `BOM ${bom.product_no} ${replaced ? 'diganti' : 'diimpor'}`,
    history: H('bom_import', { no: bom.product_no, name: bom.product_name, delta: bom.lines.length, note: `${bom.lines.length} part${newParts.length ? `, ${newParts.length} part baru` : ''}${replaced ? ', menggantikan BOM lama' : ''}${fileName ? ` · ${fileName}` : ''}` }),
  });
  return { ok: true, replaced };
}

// Ubah BOM yang sudah ada: nama produk dan daftar part (tambah/hapus part, ubah qty per unit). No item produk tetap.
// lines: [{ no, qty, name? }]
export async function editBom(id, name, lines, kind) {
  const old = S.bom.find((b) => b.id === id);
  if (!old) return { ok: false, error: 'BOM tidak ditemukan.' };
  name = String(name || '').trim();
  if (!name) return { ok: false, error: 'Nama produk wajib diisi.' };
  if (!lines.length) return { ok: false, error: 'BOM minimal punya satu part.' };
  const seen = new Set();
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1) return { ok: false, error: `Qty ${l.no} harus bilangan bulat, minimal 1.` };
    if (seen.has(l.no)) return { ok: false, error: `Part ${l.no} muncul dua kali.` };
    seen.add(l.no);
  }
  const before = new Map(old.lines.map((l) => [l.no, l.qty]));
  const added = lines.filter((l) => !before.has(l.no)).length;
  const removed = old.lines.filter((l) => !seen.has(l.no)).length;
  const changed = lines.filter((l) => before.has(l.no) && before.get(l.no) !== l.qty).length;
  const renamed = name !== old.product_name;
  const newKind = kind === 'jadi' || kind === 'wip' ? kind : bomKind(old), kindChanged = newKind !== bomKind(old);
  if (!added && !removed && !changed && !renamed && !kindChanged) return { ok: true, unchanged: true };
  const bom = { ...old, kind: newKind, product_name: name, lines: lines.map((l) => ({ no: l.no, qty: l.qty, name: (S.parts.find((p) => p.no === l.no) || {}).name || l.name || '' })) };
  const bits = [added && `${added} part ditambah`, removed && `${removed} part dihapus`, changed && `${changed} qty diubah`, renamed && 'nama diubah', kindChanged && `hasil jadi ${newKind === 'jadi' ? 'produk jadi' : 'WIP'}`].filter(Boolean);
  await commit({
    type: 'bom.upsert', bom, output: { no: bom.product_no, name: bom.product_name, kind: newKind }, msg: `BOM ${bom.product_no} diubah`,
    history: H('bom_edit', { no: bom.product_no, name: bom.product_name, delta: bom.lines.length, note: bits.join(', ') }),
  });
  return { ok: true, added, removed, changed };
}

export async function deleteBom(id) {
  const b = S.bom.find((x) => x.id === id);
  if (!b) return { ok: false, error: 'BOM tidak ditemukan.' };
  await commit({ type: 'bom.delete', id, msg: `BOM ${b.product_no} dihapus`, history: H('bom_delete', { no: b.product_no, name: b.product_name }) });
  return { ok: true };
}

// ---------- Tahap 3: user management ----------
const activeAdmins = () => S.users.filter((u) => u.role === 'admin' && u.active !== false);

// user: { username, name, role, perms, active, password? } — password hanya untuk user baru.
export async function saveUser(user, isNew) {
  const username = String(user.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,20}$/.test(username)) return { ok: false, error: 'Username 3–20 karakter: huruf kecil, angka, titik, garis bawah, atau strip.' };
  if (!String(user.name || '').trim()) return { ok: false, error: 'Nama wajib diisi.' };
  const exists = S.users.find((u) => u.username === username);
  if (isNew && exists) return { ok: false, error: 'Username sudah dipakai.' };
  if (!isNew && !exists) return { ok: false, error: 'User tidak ditemukan.' };
  const willBeAdmin = user.role === 'admin' && user.active !== false;
  if (!isNew) {
    const wasAdmin = exists.role === 'admin' && exists.active !== false;
    if (wasAdmin && !willBeAdmin && activeAdmins().length <= 1) return { ok: false, error: 'Harus ada minimal satu admin yang aktif.' };
    if (username === S.user.username && !willBeAdmin) return { ok: false, error: 'Anda tidak bisa menurunkan atau menonaktifkan akun Anda sendiri.' };
  }
  const perms = { dashboard: !!user.perms.dashboard, parts: !!user.perms.parts, report: !!user.perms.report, stock: !!user.perms.stock, users: false };
  let rec;
  if (isNew) {
    if (String(user.password || '').length < 6) return { ok: false, error: 'Password awal minimal 6 karakter.' };
    rec = await makeUser({ username, name: user.name.trim(), role: user.role, password: user.password, perms, mustChange: true });
  } else {
    rec = { username, name: user.name.trim(), role: user.role, perms, active: user.active !== false };
  }
  await commit({
    type: 'user.upsert', user: rec,
    msg: `User ${username} ${isNew ? 'dibuat' : 'diubah'}`,
    history: H(isNew ? 'user_add' : 'user_edit', { no: username, name: rec.name, note: `${rec.role}${rec.active === false ? ', nonaktif' : ''}` }),
  });
  return { ok: true };
}

export async function resetPassword(username, password) {
  if (String(password || '').length < 6) return { ok: false, error: 'Password minimal 6 karakter.' };
  const salt = randomSalt();
  await commit({
    type: 'user.upsert', user: { username, salt, hash: await hashPassword(password, salt), mustChange: true },
    msg: `Reset password ${username}`,
    history: H('user_reset', { no: username, name: (S.users.find((u) => u.username === username) || {}).name || username }),
  });
  return { ok: true };
}

// ---------- Tahap 4/5: kirim ke assembly (potong stok sesuai BOM), stok opname ----------
// Memotong stok semua part BOM untuk `units` unit produk dalam SATU operasi (semua berhasil atau tidak sama sekali).
// Part keluar dengan status "Ke proses assembly"; hasilnya (WIP / produk jadi) tercatat "sedang di assembly" sampai diterima kembali.
export async function consumeBom(bomId, units) {
  const bom = S.bom.find((b) => b.id === bomId);
  if (!bom) return { ok: false, error: 'BOM tidak ditemukan.' };
  if (!Number.isInteger(units) || units < 1) return { ok: false, error: 'Jumlah produksi harus bilangan bulat, minimal 1.' };
  const chk = bomCheck(bom, S.parts, units);
  if (chk.missing) return { ok: false, error: `${chk.missing} part belum ada di daftar Part. Tambahkan dulu.` };
  if (!chk.ok) return { ok: false, error: `Stok kurang untuk ${chk.short} part: ${chk.lines.filter((l) => l.lack > 0).slice(0, 3).map((l) => `${l.no} (kurang ${l.lack})`).join(', ')}${chk.short > 3 ? ', …' : ''}` };
  const ts = new Date().toISOString(), note = `${units} unit · ${bom.product_no}`, kind = bomKind(bom);
  const adjusts = [], histories = [], low = [];
  for (const l of chk.lines) {
    adjusts.push({ no: l.no, delta: -l.need });
    histories.push(H('bom_use', { ts, no: l.no, name: l.part.name, delta: -l.need, after: l.stock - l.need, loc: codeOf(l.part), reason: 'assembly', note, product: bom.product_name, productNo: bom.product_no, units }));
    low.push(...crossedLow(l.part, l.stock, l.stock - l.need));
  }
  histories.push(H('asm_send', { ts, no: bom.product_no, name: bom.product_name, delta: units, note: `${units} unit ${kind === 'jadi' ? 'produk jadi' : 'WIP'} dikerjakan di assembly · ${chk.lines.length} part dikirim` }));
  await commit({ type: 'stock.batch', adjusts, histories, asm: { no: bom.product_no, name: bom.product_name, kind, units }, msg: `Kirim ke assembly ${units} × ${bom.product_no}` });
  return { ok: true, count: adjusts.length, units, low, kind };
}

// Pastikan item hasil BOM (WIP / produk jadi) ada di daftar part supaya bisa diterima, dicari, dan diberi lokasi.
export async function ensureBomOutput(bomId) {
  const bom = S.bom.find((b) => b.id === bomId);
  if (!bom) return { ok: false, error: 'BOM tidak ditemukan.' };
  const cur = S.parts.find((p) => p.no === bom.product_no);
  if (cur && kindOf(cur)) return { ok: true, created: false };
  await commit({ type: 'part.ensure', no: bom.product_no, output: { no: bom.product_no, name: bom.product_name, kind: bomKind(bom) }, msg: `Item hasil ${bom.product_no}` });
  return { ok: true, created: true };
}

// entries: [{ no, counted }] — hanya part di rak ini yang sudah dihitung. skipped: jumlah part yang belum diisi (tidak diubah).
// Stok sistem diganti sesuai hitungan fisik (selisih dihitung dari stok saat ini), semua dalam SATU operasi.
export async function saveOpname(rackId, entries, skipped = 0) {
  const rack = S.racks.find((r) => r.id === rackId);
  if (!rack) return { ok: false, error: 'Rak tidak ditemukan.' };
  const ts = new Date().toISOString();
  const adjusts = [], histories = [], low = [];
  let counted = 0, plus = 0, minus = 0;
  for (const e of entries) {
    const p = S.parts.find((x) => x.no === e.no);
    if (!p || p.rack !== rackId) continue;
    if (!Number.isInteger(e.counted) || e.counted < 0) return { ok: false, error: `Hitungan ${e.no} harus bilangan bulat, minimal 0.` };
    const before = Number(p.qty) || 0, delta = e.counted - before;
    counted++;
    if (!delta) continue;
    adjusts.push({ no: p.no, delta });
    if (delta > 0) plus += delta; else minus -= delta;
    histories.push(H('opname_adjust', { ts, no: p.no, name: p.name, delta, after: e.counted, loc: codeOf(p), note: `Opname Rak ${rackId}: sistem ${before}, hitung ${e.counted}` }));
    low.push(...crossedLow(p, before, e.counted));
  }
  if (!counted) return { ok: false, error: 'Belum ada part yang dihitung.' };
  const diff = adjusts.length;
  histories.push(H('opname_done', { ts, no: rackId, name: `Rak ${rackId}`, delta: diff,
    note: `${counted} part dihitung, ${diff ? `${diff} selisih (+${plus} / −${minus})` : 'tidak ada selisih'}${skipped ? `, ${skipped} dilewati` : ''}` }));
  await commit({ type: 'stock.batch', adjusts, histories, rackOpname: { id: rackId, ts, by: S.user.username, counted, diff, skipped }, msg: `Opname Rak ${rackId}` });
  return { ok: true, counted, diff, plus, minus, low };
}
