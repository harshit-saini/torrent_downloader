# Cloud Torrent (Seedr-style)

Paste a magnet link or `.torrent` URL → the backend downloads it and stores the files in **Cloudflare R2**. Browse, download (presigned URLs) and delete files from the web UI.

- `backend/` – Node + Express + WebTorrent, deploy to Render (free)
- `frontend/` – React + Vite, deploy to Vercel/Netlify

## 1. Cloudflare R2
1. Create a bucket. 2. R2 → *Manage API tokens* → create a token with **Object Read & Write** on the bucket.
3. Note Account ID, Access Key ID, Secret, bucket name.
(Downloads use presigned URLs, so no CORS config is needed.)

## 2. Backend on Render
Use `render.yaml` (Blueprint) or create a Node web service with root dir `backend`, build `npm install`, start `npm start`.
Set env vars from `backend/.env.example`. `CORS_ORIGIN` = your frontend URL.

## 3. Frontend on Vercel/Netlify
Root dir `frontend`, build `npm run build`, output `dist`, env `VITE_API_URL` = your Render URL.

## Local dev
```
cd backend && cp .env.example .env && set -a && . ./.env && set +a && npm i && npm run dev
cd frontend && cp .env.example .env && npm i && npm run dev
```

## Free-tier caveats
- Render free sleeps after 15 min idle (first request ~30–60s) and **a sleeping/restarted instance drops active downloads**. Keep it awake with an uptime pinger on `/healthz` while downloading.
- Ephemeral disk and 512 MB RAM: files are uploaded to R2 one by one and deleted locally; torrents over `MAX_TORRENT_GB` are rejected (default 1 on Render).
- Transfer list is in memory (lost on restart); finished files persist in R2.
- WebTorrent in Node only reaches TCP/uTP-less peers (no uTP/some DHT limits), so some torrents will be slow or have fewer peers than a native client.
- Free R2 tier: 10 GB storage; egress is free.
