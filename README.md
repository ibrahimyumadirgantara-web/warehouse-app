# Smart Warehouse — Lengkap (Tahap 1–5)

Aplikasi web statis (HTML/CSS/JS + IndexedDB + PWA). Data disimpan sebagai JSON di repo GitHub private.

## Pasang (sekali, ±10 menit)

> Sudah memasang Tahap 1 atau 2? Cukup ganti semua file di repo aplikasi dengan isi zip ini. Data di repo private tidak berubah.
> Setelah GitHub Pages memperbarui situs, tutup dan buka lagi aplikasinya (di HP: tutup lalu buka ulang) agar versi baru dimuat.

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

## Tahap 2: Part & BOM
- **Template**: `templates/template-part.xlsx` dan `templates/template-bom.xlsx` (juga tombol *Template* di aplikasi).
  Baris contoh berawalan `CONTOH-` dilewati otomatis saat impor.
- **Part**: kolom `No Item, Nama Part, Spesifikasi, Total Qty, Rak, Kolom, Baris`. Impor menampilkan pratinjau (baru / sudah ada / baris bermasalah) sebelum disimpan.
  Part yang sudah ada dilewati; admin bisa memilih *perbarui* (nama, lokasi, dan qty diganti sesuai file).
- **BOM**: baris 1 = `Nama Produk` + `No Item Produk`, lalu tabel part yang sama. `Total Qty` di BOM = kebutuhan per 1 produk.
  Satu file boleh berisi banyak produk (satu sheet per produk). Part yang belum ada dibuat otomatis dengan stok 0.
- Detail BOM menampilkan kebutuhan vs stok untuk jumlah produksi tertentu, dan berapa unit yang bisa dibuat dari stok sekarang.
- Ekspor menghasilkan file dengan format yang sama, jadi bisa diedit lalu diimpor kembali.
- Impor/hapus part: perlu izin ubah data. Hapus part dan hapus BOM: khusus admin.
- Pencarian ada di `js/search.js` (terpisah dari `core.js`). Bila Anda sudah punya versi perbaikan sendiri, tempel fungsi `matchParts` Anda di file itu.

## Tahap 3: User, Riwayat, Scan QR code
- **User** (khusus admin): buat user, atur akses menu (Dashboard, Part & BOM, Riwayat) dan izin *Ubah data* (stok, part, impor Excel, BOM), nonaktifkan akun, reset password.
  User baru wajib mengganti password saat login pertama. Admin tidak bisa menurunkan/menonaktifkan dirinya sendiri, dan harus selalu ada minimal satu admin aktif.
  Perubahan hak akses berlaku otomatis di perangkat user (paling lambat ±30 detik atau saat aplikasi dibuka lagi).
- **Riwayat**: semua aksi per user (stok masuk/keluar dengan stok akhir, part, impor, rak, BOM, user), per bulan.
  Filter bulan, user, jenis aksi, dan kata kunci; ekspor ke Excel. Tetap tampil (data terakhir) saat offline.
- **Scan QR code**: ikon kamera di kolom pencarian dan di isian *No item* pada form Part baru.
  - Kamera otomatis zoom **3x** dan hanya area di dalam **kotak** yang dibaca. Tombol "Zoom 3×/1×" untuk beralih bila QR besar atau Anda terlalu dekat.
  - Memakai zoom kamera asli bila perangkat mendukung (Android), sisanya zoom digital (iPhone/Safari).
  - Bila browser punya `BarcodeDetector` (Chrome Android) dipakai lebih dulu; bila tidak, pembaca QR bawaan (`js/qr.js`) yang bekerja, termasuk di iPhone/Safari dan Firefox.
  - Barcode 1D (Code128, EAN, dll.) hanya terbaca di browser yang punya `BarcodeDetector`. Pembaca 1D bawaan sudah dihapus.
  - Tahan QR yang miring/berputar dan QR terbalik (terang di atas gelap). Ada isian "atau ketik kode" bila QR rusak.
  - Scanner barcode fisik (USB/Bluetooth) juga bisa: klik kolom pencarian lalu pindai. Scanner biasanya mengetik kode + Enter.
  - Kamera butuh HTTPS. GitHub Pages sudah HTTPS.
  - Kode yang tidak ada di sistem menampilkan tombol "Tambah part dengan no item ini".

## Tahap 4: Cari produk, Stok minimum, Opname
- **Cari produk (BOM) di Dashboard**: ketik no item atau nama produk yang sudah diimpor lewat BOM (mis. `x100`).
  - Hasil pencarian memisahkan **Produk (BOM)** dan **Part**. Bila yang cocok hanya satu produk, seluruh part-nya langsung tampil, dan lokasinya berkedip di denah.
  - Isi jumlah produksi, lalu ketuk **Konfirmasi · potong stok**. Setelah dialog konfirmasi, stok semua part dipotong sesuai BOM × jumlah dalam satu operasi: semua berhasil atau tidak sama sekali.
  - Part yang kurang ditandai merah dan tombol dikunci. Part yang belum terdaftar di daftar Part juga memblokir pemotongan.
  - Tombol **Potong stok** juga ada di detail BOM (Part & BOM → BOM). Setiap pemotongan tercatat di Riwayat per part; kolom Aksi berisi **nama produknya** dan catatannya "N unit · no item produk".
  - **Edit BOM** (tombol di detail BOM dan di Dashboard saat produk dibuka): ubah nama produk, hapus part, ubah qty per unit, dan tambah part dengan mencari no item/nama (atau "Part baru" bila belum terdaftar). Tercatat di Riwayat sebagai "Ubah BOM".
  - Perbandingan panel denah : daftar tetap 70 : 30 saat produk dibuka.
  - Mengetik nama part (mis. `baut`) tetap hanya menampilkan part.
- **Notifikasi stok minimum**: isi *Stok minimum* di form part atau kolom **Stok Min** pada Excel (template Part sudah punya kolom ini; kosong = tidak diubah, 0 = tanpa batas).
  - Part dengan stok ≤ minimum: angka berwarna kuning, ada lencana merah di menu Part & BOM, dan toast saat login.
  - Toast juga muncul tepat saat stok baru turun melewati batas (ubah stok, potong BOM, atau opname).
  - Tombol "⚠ N stok rendah" di Dashboard dan "Stok rendah (N)" di tab Part menyaring daftar. Ekspor Part menyertakan Stok Min.
- **Stok opname per rak** (Part & BOM → Opname):
  - Pilih rak, isi hitungan fisik tiap part (urut baris lalu kolom), selisih tampil langsung. Tombol "Pindai part" melompat ke part yang QR-nya dipindai.
  - Part yang dikosongkan **tidak diubah**. "Sisanya sesuai sistem" mengisi sisa dengan stok sistem (hanya bila fisiknya sudah diperiksa).
  - Draf hitungan tersimpan di perangkat dan dilanjutkan otomatis bila aplikasi ditutup.
  - Tinjau selisih lalu simpan: stok sistem diganti menjadi hitungan fisik. Riwayat mencatat tiap selisih dan ringkasan opname. Kartu rak menampilkan opname terakhir (kapan dan oleh siapa).
  - Hitungan didasarkan pada selisih, jadi perubahan stok oleh user lain saat Anda menghitung tidak saling menimpa.

## Tahap 5: Status masuk/keluar, assembly, WIP
Alur: **Part → (keluar ke assembly) → dikerjakan di assembly → WIP kembali ke gudang → dirakit lagi → produk jadi → dijual ke customer.**

- **Status setiap barang masuk/keluar** (wajib dipilih di dialog *Ubah stok*; tombol Simpan terkunci sebelum dipilih):
  - **Masuk**: Pembelian · Dari proses assembly · Lainnya (retur / koreksi, wajib isi alasan)
  - **Keluar**: Ke proses assembly · Ke customer · Lainnya (rusak / koreksi, wajib isi alasan)
  - Kolom catatan menyesuaikan status: supplier / no PO, no SPK, customer / no DO.
  - Riwayat menampilkan status di bawah nama aksi, ada filter **Status** (mis. Keluar · Ke customer), dan kolom *Status* ikut di ekspor Excel.
    Data lama tanpa status ditampilkan kosong (filter "Tanpa status"); pemakaian BOM lama dianggap "Ke assembly".
- **Jenis item**: *Part (komponen)*, *WIP (setengah jadi)*, *Produk jadi*. Diatur di form part (kolom Jenis) atau otomatis dari BOM.
- **Hasil BOM**: tiap BOM punya jenis hasil **WIP** atau **Produk jadi** (Edit BOM → *Hasil BOM ini*, atau sel `Jenis Hasil` di baris 1 Excel BOM; kosong = WIP).
  Item hasil dibuat otomatis dengan no item = no item produk BOM, stok 0, dan bisa diberi lokasi rak. BOM produk jadi boleh berisi WIP + part biasa.
- **Kirim ke assembly** (tombol di mode produk Dashboard dan di detail BOM; dulu bernama "Potong stok"): stok semua part dipotong dengan status *Ke proses assembly*,
  hasilnya dicatat **sedang di assembly** (jumlah unit tampil di daftar, kartu BOM, dan Part & BOM).
- **Terima hasil**: tombol di mode produk / detail BOM membuka dialog stok masuk berstatus *Dari proses assembly*, jumlah terisi otomatis sebanyak yang masih di assembly,
  dan bisa langsung memilih rak untuk item yang belum punya lokasi. Terima sebagian diperbolehkan (sisa tetap tercatat di assembly);
  centang *Tutup sisa di assembly* bila sisanya tidak akan kembali. Tombol *Terima semua* ada di dialog stok item WIP/Jadi.
- **Pencarian Dashboard**: pilihan **Semua · Part · BOM · WIP · Jadi** di samping kolom pencarian (pilihan diingat).
  *Semua* menampilkan BOM (resep) dan stok part/WIP/produk jadi sekaligus; *Part* hanya komponen; *WIP* hanya setengah jadi yang sudah kembali ke gudang; *BOM* hanya resep produk.
  Tab Part punya filter jenis yang sama.
- Perubahan data memakai selisih (delta) seperti sebelumnya, jadi dua perangkat yang bekerja bersamaan tidak saling menimpa, termasuk jumlah "di assembly".

## Catatan penting
- Setiap aksi langsung di-commit ke repo data. Tanda di kanan atas menunjukkan status sinkronisasi.
- Offline: aksi masuk antrean dan terkirim otomatis saat online lagi.
- Login/role di web statis bukan keamanan tingkat tinggi: siapa pun yang memegang token GitHub dapat mengubah data langsung di repo. Pengaman utamanya adalah token (fine-grained, hanya repo data) dan repo private. Jangan bagikan token ke orang yang tidak perlu; cabut token di GitHub bila perangkat hilang.
- Baris 1 ada di paling atas rak. Jika di gudang Anda baris 1 = paling bawah, ubah `ROW1_ON_TOP` di `js/core.js`.
- Kolom dan baris dibatasi 1–9 agar kode lokasi (mis. A13) tidak ambigu.

## Struktur
```
index.html  manifest.json  sw.js
css/   themes.css  main.css
js/    app.js  core.js  db.js  github.js  sync.js  store.js  ui.js
       search.js  map.js  dashboard.js  forms.js
       parts.js  bom.js  opname.js  sheets.js  xlsx.js
       users.js  report.js  scanner.js  qr.js
icons/  templates/
```
Data di repo private: `data/parts.json`, `racks.json`, `users.json`, `bom.json`, `history-YYYY-MM.json`.

## Ide lanjutan (belum ada)
- Daftar surat perintah kerja (SPK) assembly dengan nomor dan batas waktu, cetak label QR per part/rak, laporan stok rendah ke Excel, notifikasi di luar aplikasi (email/WhatsApp).
