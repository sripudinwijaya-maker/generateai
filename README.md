# Sonora Studio — EMIX (struktur bersih untuk Vercel)

## Upload ke GitHub/Vercel
Upload seluruh ISI folder ini ke root repository, bukan folder induk lain.

Struktur:
- index.html, app.js, style.css: frontend
- api/create.js: endpoint backend untuk membuat task
- api/status.js: endpoint backend untuk cek status
- lib/handlers.js: logika backend
- package.json, vercel.json: konfigurasi deploy

Di Vercel, tambahkan Environment Variable `EMIX_API_KEY` berisi API key EMIX. Jangan menaruh key di app.js atau index.html.
Lalu lakukan redeploy. Buka domain Vercel dan coba Generate.

Catatan: endpoint EMIX/status harus sesuai dokumentasi akun EMIX; jika respons 401 masih muncul, periksa endpoint dan header di lib/handlers.js.
