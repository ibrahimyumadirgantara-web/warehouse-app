// db.js — pembungkus IndexedDB (cache lokal + antrean sinkronisasi).

const NAME = 'smart-warehouse', VERSION = 1;
const STORES = {
  parts: { keyPath: 'no' },
  racks: { keyPath: 'id' },
  users: { keyPath: 'username' },
  bom: { keyPath: 'id' },
  queue: { keyPath: 'qid', autoIncrement: true },
  meta: { keyPath: 'k' },
};

let dbp;
export function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [n, o] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, o);
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export async function getAll(store) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).getAll());
}
export async function put(store, value) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).put(value);
  await done(t);
}
export async function del(store, key) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).delete(key);
  await done(t);
}
export async function replaceAll(store, items) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const s = t.objectStore(store);
  s.clear();
  for (const i of items) s.put(i);
  await done(t);
}
export async function clearAll() {
  for (const n of Object.keys(STORES)) await replaceAll(n, []);
}
export async function getMeta(k, fallback = null) {
  const db = await open();
  const r = await req(db.transaction('meta').objectStore('meta').get(k));
  return r ? r.v : fallback;
}
export const setMeta = (k, v) => put('meta', { k, v });
