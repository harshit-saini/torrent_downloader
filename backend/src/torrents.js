import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import WebTorrent from 'webtorrent';
import { config } from './config.js';
import { uploadFile } from './r2.js';
import { migrate, saveJob, deleteJob, loadJobs, addFile } from './db.js';

const client = new WebTorrent();
client.on('error', (e) => console.error('webtorrent error', e.message));

// id -> job. In-memory only: lost on restart/redeploy (finished files live in R2).
const jobs = new Map();
const queue = [];
let active = 0;

const MAX_JOBS_KEPT = 50;

export async function init() {
  await fs.rm(config.downloadDir, { recursive: true, force: true });
  await fs.mkdir(config.downloadDir, { recursive: true });
  await migrate();
  // Jobs interrupted by a restart/sleep are resumed from scratch.
  for (const j of await loadJobs()) {
    jobs.set(j.id, { ...j, progress: j.status === 'done' ? 1 : 0, uploaded: 0 });
    if (!['done', 'error'].includes(j.status)) {
      j.status = 'queued';
      jobs.get(j.id).status = 'queued';
      queue.push(j.id);
    }
  }
  pump();
}

const persist = (job) =>
  saveJob(job).catch((e) => console.error('db save failed:', e.message));

export function listJobs() {
  return [...jobs.values()]
    .map((j) => {
      const t = j.torrent;
      const downloading = j.status === 'downloading' && t;
      return {
        id: j.id,
        name: j.name,
        status: j.status,
        error: j.error,
        size: j.size,
        progress: downloading ? t.progress : j.status === 'uploading' ? 1 : j.progress,
        downloadSpeed: downloading ? t.downloadSpeed : 0,
        peers: downloading ? t.numPeers : 0,
        uploaded: j.uploaded,
        createdAt: j.createdAt,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function addJob(uri) {
  const id = crypto.randomUUID();
  jobs.set(id, {
    id,
    uri,
    name: uri.startsWith('magnet:')
      ? decodeURIComponent((uri.match(/[?&]dn=([^&]+)/) || [])[1] || 'Fetching metadata…').replace(/\+/g, ' ')
      : uri,
    status: 'queued',
    progress: 0,
    size: 0,
    uploaded: 0,
    createdAt: Date.now(),
  });
  persist(jobs.get(id));
  queue.push(id);
  trimJobs();
  pump();
  return id;
}

export async function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  const qi = queue.indexOf(id);
  if (qi >= 0) queue.splice(qi, 1);
  job.cancelled = true;
  if (job.torrent) await destroy(job);
  jobs.delete(id);
  await deleteJob(id).catch((e) => console.error(e.message));
  return true;
}

function trimJobs() {
  const finished = [...jobs.values()]
    .filter((j) => ['done', 'error'].includes(j.status))
    .sort((a, b) => a.createdAt - b.createdAt);
  while (finished.length > MAX_JOBS_KEPT) {
    const id = finished.shift().id;
    jobs.delete(id);
    deleteJob(id).catch(() => {});
  }
}

function pump() {
  while (active < config.maxConcurrent && queue.length) {
    const job = jobs.get(queue.shift());
    if (!job) continue;
    active++;
    run(job)
      .catch((e) => fail(job, e))
      .finally(() => {
        active--;
        pump();
      });
  }
}

function fail(job, e) {
  if (job.cancelled) return;
  console.error(`job ${job.id} failed:`, e.message);
  job.status = 'error';
  job.error = e.message;
  persist(job);
}

function destroy(job) {
  return new Promise((resolve) => {
    const t = job.torrent;
    job.torrent = null;
    if (!t) return resolve();
    t.destroy({ destroyStore: true }, () => resolve());
  }).then(() => fs.rm(job.dir, { recursive: true, force: true }));
}

async function run(job) {
  job.status = 'downloading';
  persist(job);
  job.dir = path.join(config.downloadDir, job.id);
  await fs.mkdir(job.dir, { recursive: true });

  try {
    await download(job);
    if (job.cancelled) return;
    await upload(job);
    job.status = 'done';
    persist(job);
  } finally {
    await destroy(job);
  }
}

function download(job) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('No metadata received after 3 minutes')),
      180_000,
    );
    const torrent = client.add(job.uri, { path: job.dir });
    job.torrent = torrent;
    torrent.on('error', reject);
    torrent.on('metadata', () => {
      clearTimeout(timeout);
      job.name = torrent.name;
      job.size = torrent.length;
      persist(job);
      if (torrent.length > config.maxTorrentBytes) {
        reject(
          new Error(
            `Torrent is ${(torrent.length / 1024 ** 3).toFixed(2)} GB, limit is ${(config.maxTorrentBytes / 1024 ** 3).toFixed(2)} GB`,
          ),
        );
      }
    });
    torrent.on('done', () => {
      job.progress = 1;
      resolve();
    });
  });
}

async function upload(job) {
  job.status = 'uploading';
  persist(job);
  const t = job.torrent;
  // Single-file torrents sit at the root of dir; multi-file ones are already under torrent.name/.
  const root = sanitize(t.name);
  let doneBytes = 0;
  for (const f of t.files) {
    if (job.cancelled) return;
    const rel = f.path.split(path.sep).join('/');
    const key = t.files.length === 1 && rel === f.name ? `${root}/${f.name}` : rel;
    await uploadFile(key, path.join(job.dir, f.path), (loaded) => {
      job.uploaded = doneBytes + loaded;
    });
    await addFile({ key, jobId: job.id, folder: key.split('/')[0], name: f.name, size: f.length });
    doneBytes += f.length;
    job.uploaded = doneBytes;
    // Free disk as we go.
    await fs.rm(path.join(job.dir, f.path), { force: true });
  }
}

const sanitize = (s) => s.replace(/[\\/]/g, '_');
