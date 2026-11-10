# Kreyntix Battle Arena 2026

Portal informasi komprehensif bagan pertandingan, jadwal rundown 3 hari kompetisi, direktori 58 tim peserta, dan regulasi resmi turnamen kompetitif.

## Fitur Utama

- Bagan Interaktif: Visual tree eliminasi tunggal 58 tim dari Babak 1 hingga Babak Grand Final.
- Rundown Terjadwal: Pembagian kloter harian (Kloter 1 dan Kloter 2) dengan estimasi waktu laga.
- Direktori Tim Lengkap: Status unggulan (BYE Seed) dan jalur pertandingan bagi 58 tim peserta.
- Buku Panduan Regulasi: 9 Bab pasal regulasi resmi kompetisi mencakup teknis permainan, pause, kode etik, dan alokasi apresiasi juara.
- Sinkronisasi Real-Time: Integrasi Server-Sent Events (SSE) dengan Firebase Realtime Database dan penyimpanan lokal (fallback).
- Panel Wasit / Admin: Autentikasi proteksi sandi untuk penentuan pemenang laga secara langsung.
- Tautan Bagan Challonge: Tautan terverifikasi ke platform Challonge resmi (https://challonge.com/6ayo1xlk).

## Struktur Berkas

- index.html: Struktur semantik antarmuka web turnamen.
- styles.css: Sistem desain tema esports turnamen dengan dukungan mode gelap dan terang.
- app.js: Logika aplikasi, state management, sinkronisasi SSE, dan penanganan interaksi pengguna.
- bracket-data.js: Metadata 58 pertandingan, jadwal waktu, relasi alur pemenang, dan format laga.
- teams-data.js: Direktori 58 tim peserta dan penetapan status unggulan (BYE).
- rules-data.js: Buku regulasi dan tata tertib kompetisi resmi Kreyntix 2026.
- vercel.json: Konfigurasi deployment dan header keamanan HTTP untuk Vercel.

## Panduan Menjalankan Secara Lokal

1. Buka direktori proyek melalui terminal atau antarmuka berkas.
2. Jalankan server HTTP statis lokal:
   ```bash
   npx serve .
   ```
3. Buka browser pada alamat yang disediakan (contoh: http://localhost:3000).

## Tautan Proyek Aktif

- Live Website Vercel (Production): https://kreyntix-battle-arena.vercel.app
- Live Deployment Vercel: https://kreyntix-battle-arena-3afte8tdc-vincentius-bryan-kwandou.vercel.app
- Live Website GitHub Pages: https://bryankwandou.github.io/kreyntix-battle-arena/
- Repositori GitHub: https://github.com/bryankwandou/kreyntix-battle-arena

## Informasi Autentikasi Admin

- Kata Sandi Admin: kreyntix2026
