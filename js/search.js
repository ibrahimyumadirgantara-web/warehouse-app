// search.js — pencarian part. Terpisah dari core.js agar mudah diganti/disetel.
import { codeOf } from './core.js';

// Aturan:
//  1. Setiap kata pencarian harus cocok dengan AWAL sebuah kata di no item / nama / spesifikasi / kode lokasi.
//     "baut 3" → hanya "baut 3", bukan "baut1" atau no item "12356".
//  2. Kata yang mengandung simbol (mis. "p-001", "m8x20") dicocokkan sebagai teks utuh.
//  3. Jika langkah 1-2 tidak menemukan apa pun, cari sebagai potongan teks (untuk potongan kode di tengah).
const wordsOf = (s) => s.split(/[^a-z0-9]+/).filter(Boolean);

export function matchParts(parts, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/);
  const rows = parts.map((p) => {
    const no = String(p.no).toLowerCase();
    const name = String(p.name || '').toLowerCase();
    const code = codeOf(p).toLowerCase();
    const hay = `${no} ${name} ${String(p.spec || '').toLowerCase()} ${code}`;
    return { p, no, name, code, hay, words: wordsOf(hay) };
  });

  const strict = (r) => tokens.every((t) => (/^[a-z0-9]+$/.test(t) ? r.words.some((w) => w.startsWith(t)) : r.hay.includes(t)));
  const loose = (r) => tokens.every((t) => r.hay.includes(t));

  let hits = rows.filter(strict);
  if (!hits.length) hits = rows.filter(loose);

  const score = (r) => {
    if (r.no === q || (r.code && r.code === q)) return 100;
    if (r.no.startsWith(tokens[0])) return 80;
    if (r.name === q) return 90;
    if (r.name.startsWith(tokens[0])) return 60;
    return 40;
  };
  return hits
    .map((r) => [score(r), r.p])
    .sort((a, b) => b[0] - a[0] || String(a[1].no).localeCompare(String(b[1].no), undefined, { numeric: true }))
    .map((x) => x[1]);
}
