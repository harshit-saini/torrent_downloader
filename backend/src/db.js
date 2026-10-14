import pg from 'pg';
import { config } from './config.js';

// Render's internal URL has no dot in the host and needs no SSL; the external one does.
const host = new URL(config.databaseUrl).hostname;
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
  ssl: host.includes('.') ? { rejectUnauthorized: false } : false,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000, // allows for a serverless DB (e.g. Neon) waking up
});

// Idle connections can be dropped by the server (Neon suspends when idle); the pool reconnects.
pool.on('error', (e) => console.error('pg pool error:', e.message));

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          uuid PRIMARY KEY,
      uri         text NOT NULL,
      name        text NOT NULL,
      status      text NOT NULL,
      error       text,
      size        bigint NOT NULL DEFAULT 0,
      created_at  timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS files (
      key        text PRIMARY KEY,
      job_id     uuid,
      folder     text NOT NULL,
      name       text NOT NULL,
      size       bigint NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS files_folder_idx ON files (folder);
  `);
}

export const saveJob = (j) =>
  pool.query(
    `INSERT INTO jobs (id, uri, name, status, error, size, created_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),$8)
     ON CONFLICT (id) DO UPDATE SET name=$3, status=$4, error=$5, size=$6, finished_at=$8`,
    [
      j.id,
      j.uri,
      j.name,
      j.status,
      j.error ?? null,
      j.size,
      j.createdAt,
      ['done', 'error'].includes(j.status) ? new Date() : null,
    ],
  );

export const deleteJob = (id) => pool.query('DELETE FROM jobs WHERE id=$1', [id]);

export async function loadJobs() {
  const { rows } = await pool.query('SELECT * FROM jobs ORDER BY created_at');
  return rows.map((r) => ({
    id: r.id,
    uri: r.uri,
    name: r.name,
    status: r.status,
    error: r.error,
    size: Number(r.size),
    createdAt: new Date(r.created_at).getTime(),
  }));
}

export const addFile = ({ key, jobId, folder, name, size }) =>
  pool.query(
    `INSERT INTO files (key, job_id, folder, name, size) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (key) DO UPDATE SET size=$5, job_id=$2, created_at=now()`,
    [key, jobId, folder, name, size],
  );

export async function listFileRows() {
  const { rows } = await pool.query('SELECT * FROM files ORDER BY created_at DESC, key');
  return rows.map((r) => ({ key: r.key, size: Number(r.size), modified: r.created_at }));
}

export const deleteFileRows = (keys) => pool.query('DELETE FROM files WHERE key = ANY($1)', [keys]);
