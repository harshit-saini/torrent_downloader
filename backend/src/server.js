import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { checkPassword, issueToken, requireAuth } from './auth.js';
import { addJob, listJobs, cancelJob, init } from './torrents.js';
import { downloadUrl, deleteKeys } from './r2.js';
import { listFileRows, deleteFileRows } from './db.js';

// WebTorrent can throw asynchronously on malformed input; don't let that kill the server.
process.on('uncaughtException', (e) => console.error('uncaught:', e));
process.on('unhandledRejection', (e) => console.error('unhandled:', e));

const app = express();
app.use(
  cors({
    origin: config.corsOrigin.includes('*') ? true : config.corsOrigin,
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json({ limit: '32kb' }));

// Used by the frontend / an uptime pinger to wake the free-tier instance.
app.get('/healthz', (_req, res) => res.json({ ok: true }));

const attempts = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const rec = attempts.get(ip) || { n: 0, reset: Date.now() + 15 * 60_000 };
  if (Date.now() > rec.reset) Object.assign(rec, { n: 0, reset: Date.now() + 15 * 60_000 });
  if (rec.n >= 10) return res.status(429).json({ error: 'Too many attempts, try later' });
  attempts.set(ip, rec);
  if (!checkPassword(req.body?.password)) {
    rec.n++;
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.json({ token: issueToken() });
});

app.use('/api', requireAuth);

app.get('/api/torrents', (_req, res) => res.json(listJobs()));

app.post('/api/torrents', (req, res) => {
  const uri = String(req.body?.uri || '').trim();
  const validMagnet = /^magnet:\?.*xt=urn:btih:([a-f0-9]{40}|[a-z2-7]{32})(&|$)/i.test(uri);
  if (!validMagnet && !/^https?:\/\/.+/i.test(uri)) {
    return res.status(400).json({ error: 'Provide a valid magnet link or an http(s) .torrent URL' });
  }
  res.status(201).json({ id: addJob(uri) });
});

app.delete('/api/torrents/:id', async (req, res) => {
  const ok = await cancelJob(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

app.get('/api/files', async (_req, res, next) => {
  try {
    res.json(await listFileRows());
  } catch (e) {
    next(e);
  }
});

app.get('/api/files/url', async (req, res, next) => {
  try {
    const key = String(req.query.key || '');
    if (!key) return res.status(400).json({ error: 'key required' });
    res.json({ url: await downloadUrl(key) });
  } catch (e) {
    next(e);
  }
});

// Body: { keys: [...] }
app.post('/api/files/delete', async (req, res, next) => {
  try {
    const keys = req.body?.keys;
    if (!Array.isArray(keys) || !keys.length) return res.status(400).json({ error: 'keys required' });
    const list = keys.map(String);
    await deleteKeys(list);
    await deleteFileRows(list);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

await init();
app.listen(config.port, () => console.log(`listening on ${config.port}`));
