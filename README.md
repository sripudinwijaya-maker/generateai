# Studio Cover

Web untuk membuat cover lagu lewat Emix API (model `suno/upload-and-cover-audio`).
Bisa dijalankan lokal atau di-deploy ke Vercel.

## API key

Di halaman ada dua pilihan:

- **Default (dari server)**: memakai daftar key yang kamu simpan di server.
- **API key sendiri**: pengunjung menempel key-nya, dikirim lewat server ini ke Emix dan tidak disimpan di server. Ada opsi "Ingat di browser ini".

### Rotasi otomatis

Saat membuat cover dengan key default, server mencoba key pertama. Kalau Emix menjawab saldo habis (402) atau key tidak valid (401), server otomatis pindah ke key berikutnya. Key yang sudah habis dilewati untuk request selanjutnya. Server tidak menghitung kredit sendiri, jadi yang jadi patokan adalah jawaban Emix. Dengan 80 kredit per key dan 12 kredit per cover, satu key cukup untuk sekitar 6 cover.

Status tugas dicek dengan key yang sama dengan yang membuatnya.

## Tanpa environment variable (khusus pemakaian pribadi)

Kalau repo GitHub kamu **privat**, key boleh ditaruh di file `keys.txt` di dalam repo:

1. Salin `keys.example.txt` jadi `keys.txt`, isi key satu per baris.
2. Hapus baris `keys.txt` di file `.gitignore` supaya ikut ter-commit.
3. Push ke repo privat, lalu deploy di Vercel seperti biasa. Tidak perlu mengisi environment variable.

Siapa pun yang punya akses ke repo bisa membaca key itu. Jangan lakukan ini di repo publik.

## Deploy ke GitHub dan Vercel

1. Upload folder ini ke GitHub. `keys.txt` dan `.env` sudah masuk `.gitignore`, jadi tidak ikut terunggah.
2. Di Vercel: **Add New Project**, pilih repo itu, lalu Deploy (framework preset: Other).
3. Buka **Settings > Environment Variables**, tambah:
   - `EMIX_API_KEYS` berisi semua key, satu per baris atau dipisah koma.
   - `ACCESS_CODE` (opsional tapi disarankan) berisi kode rahasia. Tanpa ini, siapa saja yang membuka linkmu bisa memakai kreditmu.
4. Klik **Redeploy** supaya variabel terbaca.

**Jangan taruh API key di dalam repo.** Kalau repo publik, key akan terbaca orang lain dan kreditnya habis dipakai. Kalau sudah terlanjur ter-commit, buat key baru di emix.ai/api-key.

## Jalan lokal

1. Pasang Node.js 18 atau lebih baru.
2. Salin `keys.example.txt` jadi `keys.txt` dan isi key, satu per baris (atau pakai `.env` dari `.env.example`).
3. Jalankan `npm start`, buka http://localhost:3000

## Catatan

- Endpoint ini adalah **cover**: wajib ada `uploadUrl` berisi link publik ke audio sumber (maks 8 menit, 50 MB). Dokumen Emix yang dipakai tidak punya endpoint upload file.
- Link hasil bisa kedaluwarsa (dokumen Emix menyebut sekitar 24 jam, dokumen lain menyebut 14 hari), jadi segera unduh.
- Status tugas dicek lewat `GET /api/v1/client/tasks?taskId=...` (dokumen Get Task Details). Kalau Emix menjawab 404, server mencoba `GET /api/v1/jobs/recordInfo` sebagai cadangan.
- Batas default Emix: 20 request baru per 10 detik.
- Di Vercel, daftar key yang habis hanya diingat sementara oleh tiap instance. Kalau instance baru menyala, key habis akan dicoba lagi sekali lalu dilewati lagi. Ini aman, hanya menambah satu request.

## Kling 2.6 Motion Control

Form Studio bisa beralih antara Suno V6 dan Kling 2.6 Motion Control. Kling memakai endpoint terbaru `POST /api/v1/client/tasks` dengan model `kling/v2-6-motion-control`; status dicek melalui `GET /api/v1/client/tasks?taskId=...` dengan fallback ke endpoint jobs lama. Masukkan URL publik gambar dan video, termasuk URL Image2URL. Dokumentasi belum menyertakan URL endpoint upload, jadi website memakai URL file yang sudah di-host. Mode resolusi mengikuti contoh request (`720p` / `1080p`), meski deskripsi skema juga menyebut `std` / `pro`. API key dikirim dari backend sebagai Bearer token dan harus disimpan di Environment Variables Vercel, bukan frontend.
