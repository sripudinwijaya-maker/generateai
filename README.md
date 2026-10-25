# Studio Cover

Web untuk membuat cover lagu lewat API musik (model `suno/upload-and-cover-audio`).
Bisa dijalankan lokal atau di-deploy ke Vercel.

## API key sendiri

Di halaman, tempel API key sendiri (satu key per baris) atau upload file TXT berisi key. Jika key ditolak karena autentikasi (401) atau saldo habis (402), browser mencoba key berikutnya. Opsi "Ingat di browser ini" menyimpan daftar key di localStorage perangkat tersebut. Jangan aktifkan pada perangkat bersama.

Aplikasi tidak menggunakan key default server. Key dikirim ke backend melalui header `x-api-key`, lalu backend meneruskannya ke Emix.

## Deploy ke GitHub dan Vercel

1. Upload folder project ke GitHub.
2. Di Vercel, pilih **Add New Project**, pilih repo, lalu deploy dengan preset **Other**.
3. Pengguna memasukkan API key mereka sendiri di halaman atau mengunggah TXT. Tidak perlu menyiapkan key default server.

**Jangan taruh API key di dalam repo.** Kalau repo publik, key akan terbaca orang lain dan kreditnya habis dipakai. Kalau sudah terlanjur ter-commit, buat key baru di emix.ai/api-key.

## Jalan lokal

1. Pasang Node.js 18 atau lebih baru.
2. Jalankan `npm start`, lalu buka http://localhost:3000.
3. Masukkan API key sendiri di halaman.

## Catatan

- Endpoint ini adalah **cover**: wajib ada `uploadUrl` berisi link publik ke audio sumber (maks 8 menit, 50 MB). Dokumen Emix yang dipakai tidak punya endpoint upload file.
- Link hasil bisa kedaluwarsa (dokumen Emix menyebut sekitar 24 jam, dokumen lain menyebut 14 hari), jadi segera unduh.
- Status tugas dicek lewat `GET /api/v1/client/tasks?taskId=...` (dokumen Get Task Details). Kalau Emix menjawab 404, server mencoba `GET /api/v1/jobs/recordInfo` sebagai cadangan.
- Batas default Emix: 20 request baru per 10 detik.
- Key yang diunggah TXT dibaca di browser dan dicoba berurutan jika Emix mengembalikan 401 atau 402.

