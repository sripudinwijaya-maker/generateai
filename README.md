# Sonora Studio — Simple Static Website

Tidak membutuhkan Termux, Node.js, atau server lokal.

## Cara pakai
1. Ekstrak ZIP.
2. Buka folder `sonora_studio_simple`.
3. Buka `index.html` menggunakan Chrome atau HTML Preview.

## Menu
- Generate Musik
- Upload & Cover Audio
- Upload & Extend Cover
- Kling 2.6 Motion Control (placeholder untuk update berikutnya)

## Catatan penting
Versi ini mengirim request langsung ke endpoint Emix Market `https://api.emix.ai/api/v1/client/tasks` dengan header `Authorization: Bearer <API_KEY>`, lalu mengecek daftar task melalui endpoint yang sama dengan parameter pagination wajib `?pageSize=50&pageNum=1` dan mencoba mencocokkan task ID. Endpoint diperbarui berdasarkan dokumentasi/implementasi Emix Market yang kita cocokkan.

Penting: belum diuji dengan API key aktif milikmu. Jika tetap muncul `Token is invalid`, berarti provider menolak autentikasi atau key tidak valid/aktif; cek status key di dashboard Emix. Karena request langsung dari browser, kemungkinan CORS juga ada. Jangan gunakan cara ini untuk website publik karena API key dapat terlihat di browser; untuk publik gunakan backend/serverless dan simpan key sebagai secret.


Pembaruan perbaikan hasil: UI kini membaca format hasil EMIX/Suno `sunoData[]`, termasuk `stream_audio_url`, `audio_url`, `image_url`, `title`, `duration`, dan `tags`. Jika respons create-task langsung berisi hasil audio, hasil ditampilkan tanpa polling. Jika hasil baru muncul saat cek status, hasil tetap ditampilkan ketika payload final ditemukan.
