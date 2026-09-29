# Smart Warehouse — Tahap 1 (Fondasi + Dashboard)

Aplikasi web statis (HTML/CSS/JS + IndexedDB + PWA). Data disimpan sebagai JSON di repo GitHub private.

## Pasang (sekali, ±10 menit)

**1. Repo aplikasi (publik)**
- GitHub → New repository → nama `warehouse-app` → Public.
- Upload seluruh isi folder ini (index.html, css/, js/, icons/, manifest.json, sw.js).
- Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)` → Save.
- Alamat aplikasi: `https://USERNAME.github.io/warehouse-app/`

**2. Repo data (private)**
- New repository → nama `warehouse-data` → **Private** → centang *Add a README file*.
- Biarkan kosong. Aplikasi membuat folder `data/` sendiri saat pertama terhubung.

**3. Token akses**
- GitHub → Settings → Developer settings → Personal access tokens → *Fine-grained tokens* → Generate.
- Repository access: *Only select repositories* → pilih `warehouse-data`.
- Permissions → Repository permissions → **Contents: Read and write**.
- Salin token. Token hanya boleh dipakai untuk repo data ini.

**4. Pertama kali dibuka**
- Buka alamat aplikasi → isi akun GitHub, `warehouse-data`, branch `main`, token → *Hubungkan*.
- Masuk dengan `admin` / `admin123` → aplikasi meminta password baru.
- Ulangi langkah "Hubungkan" (isi token) di setiap perangkat lain.

## Cara pakai
- **Cari**: ketik no item, nama, atau kode lokasi (mis. `A13`). Kode muncul berkedip di rak.
- **Ketuk sel rak** yang terisi untuk melihat part di sel itu.
- **Ubah stok**: ikon ↕ di baris part → Tambah / Kurang.
- **Part baru**: tombol "Part baru" di panel daftar.
- **Admin**: "Atur rak" → geser rak, ketuk rak untuk ubah ukuran/hapus, "Rak baru" untuk menambah.
- **Tampilan**: ikon bulan/matahari = gelap/terang. ⋯ → Pengaturan → Otomatis / Mobile / Desktop.

## Catatan penting
- Setiap aksi langsung di-commit ke repo data. Tanda di kanan atas menunjukkan status sinkronisasi.
- Offline: aksi masuk antrean dan terkirim otomatis saat online lagi.
- Login/role di web statis bukan keamanan tingkat tinggi. Pengaman utamanya adalah token dan repo private.
- Baris 1 ada di paling atas rak. Jika di gudang Anda baris 1 = paling bawah, ubah `ROW1_ON_TOP` di `js/core.js`.
- Kolom dan baris dibatasi 1–9 agar kode lokasi (mis. A13) tidak ambigu.

## Struktur
```
index.html  manifest.json  sw.js
css/   themes.css  main.css
js/    app.js  core.js  db.js  github.js  sync.js  store.js
       ui.js  map.js  dashboard.js
icons/
```
Data di repo private: `data/parts.json`, `racks.json`, `users.json`, `history-YYYY-MM.json`.

## Tahap berikutnya
- Tahap 2: menu Part & BOM, import/export Excel, template contoh.
- Tahap 3: user management, laporan riwayat, scan barcode kamera.
