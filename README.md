# Cloud Torrent (Seedr-style)

Paste a magnet link or `.torrent` URL → the backend downloads it and stores the files in **Cloudflare R2**. Browse, download (presigned URLs) and delete files from the web UI.

- `backend/` – Node + Express + WebTorrent, deploy to Render (free)
- `frontend/` – React + Vite, deploy to Vercel/Netlify

## 1. Cloudflare R2
1. Create a bucket. 2. R2 → *Manage API tokens* → create a token with **Object Read & Write** on the bucket.
3. Note Account ID, Access Key ID, Secret, bucket name.
(Downloads use presigned URLs, so no CORS config is needed.)

## 2. Neon Postgres
Create a free project at neon.tech and copy the connection string (it includes `sslmode=require`). Tables are created automatically on first start. The DB stores transfer history and the file index (name, folder, size, R2 key), so they survive restarts; transfers interrupted by a restart or sleep are resumed from scratch.

## 3. Backend on Render
Use `render.yaml` (Blueprint) or create a Node web service with root dir `backend`, build `npm install`, start `npm start`.
Set env vars from `backend/.env.example` (`DATABASE_URL` = your Neon string). `CORS_ORIGIN` = your frontend URL.

## 4. Frontend on Vercel/Netlify
Root dir `frontend`, build `npm run build`, output `dist`, env `VITE_API_URL` = your Render URL.

## Local dev
```
cd backend && cp .env.example .env # needs a local Postgres
set -a && . ./.env && set +a && npm i && npm run dev
cd frontend && cp .env.example .env && npm i && npm run dev
```

## Free-tier caveats
- Render free sleeps after 15 min idle (first request ~30–60s) and **a sleeping/restarted instance drops active downloads**. Keep it awake with an uptime pinger on `/healthz` while downloading.
- Ephemeral disk and 512 MB RAM: files are downloaded **one at a time**, uploaded to R2 and deleted locally, so a torrent can be far bigger than the disk as long as its largest file fits. Files over `MAX_FILE_GB` (default 1 on Render, a guess; raise it if your disk allows) are rejected. A single 10 GB file will not fit on the free tier.
- Interrupted jobs resume without re-uploading files already in R2.
- Neon's free compute suspends when idle and wakes in about a second; free tier storage is 0.5 GB (plenty for metadata).
- WebTorrent in Node only reaches TCP/uTP-less peers (no uTP/some DHT limits), so some torrents will be slow or have fewer peers than a native client.
- Free R2 tier: 10 GB storage; egress is free.
