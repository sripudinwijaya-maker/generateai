# Studio Cover

Web generator Suno/Kling dengan halaman login. API key disimpan di server dan tidak dimasukkan pengguna ke halaman website. Setiap akun hanya memakai API key yang didaftarkan untuk akun tersebut.

## Cara mendaftarkan user di Vercel

Buka **Project → Settings → Environment Variables**. `SESSION_SECRET` cukup satu untuk semua akun. Untuk setiap akun, tambahkan empat variabel:

- `USER_1_USERNAME` — username login, misalnya `ADMINMOK`
- `USER_1_PASSWORD` — password login
- `USER_1_NAME` — nama tampilan, misalnya `Admin Mok`
- `USER_1_API_KEY` — API key Emix milik akun itu

User kedua gunakan `USER_2_USERNAME`, `USER_2_PASSWORD`, `USER_2_NAME`, `USER_2_API_KEY`. User ketiga gunakan prefix `USER_3_`, dan seterusnya sampai 200 slot. Nomor slot boleh berurutan, jangan pakai nomor yang sama untuk dua akun.

`USER_n_API_KEY` bisa berisi satu API key atau beberapa key yang dipisahkan koma/baris baru. Kalau beberapa key dipakai, server mencoba key milik akun itu saja; tidak akan mengambil key user lain. Jangan gunakan API key global sebagai fallback untuk akun.

Setelah mengubah Environment Variables, lakukan **Redeploy** di Vercel. Jangan memasukkan rahasia ke GitHub.

## Sesi dan keamanan

- `SESSION_SECRET` adalah rahasia acak panjang minimal 32 karakter dan cukup dibuat satu kali.
- Login menggunakan username/password yang didaftarkan admin di Environment Variables; tidak ada pendaftaran publik.
- Sesi berlaku 12 jam.
- API key tetap server-side.
- Untuk kompatibilitas, format lama `<USERNAME>_PASSWORD` dan `<USERNAME>_KEY_1` (atau `<USERNAME>_KEY`) masih didukung.

## Jalankan lokal

1. Gunakan Node.js 18 atau lebih baru.
2. Salin `.env.example` menjadi `.env`, lalu isi nilai rahasia sendiri.
3. Jalankan `npm start` dan buka `http://localhost:3000`.


## Format Environment Variables per akun (simple)

- `USERNAME_PW`: password login akun tersebut.
- `USERNAME_KEY_1`, `USERNAME_KEY_2`, ...: API key milik akun tersebut. Tambahkan nomor berikutnya untuk menambah key.
- Alternatif nama key yang juga didukung: `USERNAME_APIKEY_1`, `USERNAME_APIKEY_2`, atau satu key `USERNAME_APIKEY`.
- `SESSION_SECRET` tetap satu untuk semua akun dan digunakan untuk menandatangani sesi login.

Contoh akun `AISYAH0865`: `AISYAH0865_PW`, `AISYAH0865_KEY_1`, `AISYAH0865_KEY_2`. Username login adalah `AISYAH0865`. Jika semua key milik akun itu habis/tidak valid, generate berhenti dan tidak memakai API key global atau milik user lain.


## Mode API key manual (tanpa login)
Buka website, tempel API key Emix pada kolom **API key Emix**, lalu jalankan generate. Tidak perlu SESSION_SECRET atau Environment Variables untuk akun. API key dikirim ke backend melalui header `x-api-key` dan dipakai untuk request create/status. Jangan gunakan website publik dengan API key sensitif jika tidak mempercayai pengelola hosting.
