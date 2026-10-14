import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { bytes } from './format.js';

function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await api('/api/login', { method: 'POST', body: { password } });
      setToken(token);
      onLogin();
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Server unreachable (it may be waking up — retry in ~30s)' : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card login" onSubmit={submit}>
      <h1>Cloud Torrent</h1>
      <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      <button disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function Jobs({ jobs, onCancel }) {
  if (!jobs.length) return <p className="muted">No transfers yet.</p>;
  return jobs.map((j) => (
    <div className="row" key={j.id}>
      <div className="grow">
        <div className="name">{j.name}</div>
        <div className="bar"><div style={{ width: `${Math.round(j.progress * 100)}%` }} className={j.status} /></div>
        <div className="muted small">
          {j.status === 'downloading' && `Downloading ${Math.round(j.progress * 100)}% · ${bytes(j.downloadSpeed)}/s · ${j.peers} peers · ${bytes(j.size)}`}
          {j.status === 'uploading' && `Uploading to R2 · ${Math.round(j.progress * 100)}% of ${bytes(j.size)}`}
          {j.currentFile && ` · file ${j.fileIndex}/${j.fileCount}: ${j.currentFile}`}
          {j.status === 'queued' && 'Queued'}
          {j.status === 'done' && `Saved to R2 · ${bytes(j.size)}`}
          {j.status === 'error' && <span className="error">Failed: {j.error}</span>}
        </div>
      </div>
      <button className="ghost" onClick={() => onCancel(j.id)}>{['done', 'error'].includes(j.status) ? 'Clear' : 'Cancel'}</button>
    </div>
  ));
}

function Files({ files, onChange }) {
  const [busy, setBusy] = useState('');

  // Group by top-level folder.
  const groups = {};
  for (const f of files) {
    const top = f.key.includes('/') ? f.key.split('/')[0] : f.key;
    (groups[top] ||= []).push(f);
  }

  const download = async (key) => {
    const { url } = await api(`/api/files/url?key=${encodeURIComponent(key)}`);
    window.open(url, '_blank');
  };
  const remove = async (name, items) => {
    if (!confirm(`Delete "${name}" from storage?`)) return;
    setBusy(name);
    try {
      await api('/api/files/delete', { method: 'POST', body: { keys: items.map((i) => i.key) } });
      onChange();
    } finally {
      setBusy('');
    }
  };

  if (!files.length) return <p className="muted">Your storage is empty.</p>;
  return Object.entries(groups).map(([name, items]) => (
    <div className="folder" key={name}>
      <div className="row">
        <div className="grow name">📁 {name} <span className="muted small">{bytes(items.reduce((s, i) => s + i.size, 0))}</span></div>
        <button className="ghost danger" disabled={busy === name} onClick={() => remove(name, items)}>Delete</button>
      </div>
      {items.map((f) => (
        <div className="row file" key={f.key}>
          <div className="grow">{f.key.slice(name.length + 1) || f.key} <span className="muted small">{bytes(f.size)}</span></div>
          <button className="ghost" onClick={() => download(f.key)}>Download</button>
        </div>
      ))}
    </div>
  ));
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [uri, setUri] = useState('');
  const [jobs, setJobs] = useState([]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');

  const logout = () => {
    setToken(null);
    setAuthed(false);
  };

  const guard = useCallback((err) => {
    if (err.status === 401) logout();
    else setError(err.message);
  }, []);

  const loadFiles = useCallback(() => api('/api/files').then(setFiles).catch(guard), [guard]);
  const loadJobs = useCallback(() => api('/api/torrents').then(setJobs).catch(guard), [guard]);

  useEffect(() => {
    if (!authed) return;
    loadFiles();
    loadJobs();
    const t = setInterval(loadJobs, 2000);
    return () => clearInterval(t);
  }, [authed, loadFiles, loadJobs]);

  // Refresh the file list when a job finishes.
  const doneCount = jobs.filter((j) => j.status === 'done').length;
  useEffect(() => {
    if (authed) loadFiles();
  }, [doneCount, authed, loadFiles]);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/torrents', { method: 'POST', body: { uri } });
      setUri('');
      loadJobs();
    } catch (err) {
      guard(err);
    }
  };
  const cancel = async (id) => {
    await api(`/api/torrents/${id}`, { method: 'DELETE' }).catch(guard);
    loadJobs();
  };

  return (
    <main>
      <header>
        <h1>Cloud Torrent</h1>
        <button className="ghost" onClick={logout}>Sign out</button>
      </header>

      <form className="card add" onSubmit={add}>
        <input placeholder="Paste magnet link or .torrent URL" value={uri} onChange={(e) => setUri(e.target.value)} />
        <button disabled={!uri.trim()}>Add</button>
      </form>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Transfers</h2>
        <Jobs jobs={jobs} onCancel={cancel} />
      </section>

      <section className="card">
        <h2>Files <button className="ghost small" onClick={loadFiles}>Refresh</button></h2>
        <Files files={files} onChange={loadFiles} />
      </section>
    </main>
  );
}
