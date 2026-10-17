# GenetikaAI — Suno Studio

Web app untuk Suno dan Kling Motion Control. Semua fitur memakai endpoint `POST /api/v1/client/tasks` dan status `GET /api/v1/client/tasks?taskId=...` dari emix.ai.

## Fitur

| Fitur | Model | Input audio |
| --- | --- | --- |
| Generate Music | `suno/generate` | Tidak perlu |
| Upload Cover Audio | `suno/upload-and-cover-audio` | Link audio (`uploadUrl`) |
| Upload and Extend Audio | `suno/upload-and-extend-audio` | Link audio (`uploadUrl`), `continueAt` > 0 |
| Add Vocals | `suno/add-vocals` | Link audio instrumental (`uploadUrl`) |
| Generate Music Cover | `suno/cover-generate` | ID task lagu Suno yang sudah ada |
| Kling Motion Control | `kling/v2-6-motion-control` | Link gambar dan link video |

Upload file langsung belum didukung. Semua audio, gambar, dan video harus berupa URL publik.

## Cara pakai

1. Jalankan `npm start` lalu buka `http://localhost:3000`.
2. Tempel API key kamu di kolom **API key**.
3. Pilih fitur, isi form, lalu tekan tombol.

API key dikirim ke server hanya saat permintaan dibuat (header `Authorization: Bearer`). Server tidak menyimpan atau membaca file key apa pun, dan tidak ada login.

## Catatan

- Generate Music Cover, Add Vocals, dan Kling belum diuji terhadap server emix. Spec Add Vocals dan Generate Music Cover dari emix belum berhasil dibuka saat pengembangan. Field yang dipakai mengikuti spec Suno yang umum.

## Deploy

Project memakai Node.js 18+ dan API routes di folder `/api` (Vercel). Tidak ada Environment Variables yang wajib diisi.
