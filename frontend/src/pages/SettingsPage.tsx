import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Database, LogOut, Settings as SettingsIcon, Trash2, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/config';
import { getAccessToken, refreshAccessToken } from '@/lib/tokens';
import { bulkDeleteChunks, getAllChunks } from '@/lib/api';

/* ─── Demo data: works against /api/seed ──────────────────────────── */

function DemoDataSection() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'skipped'>('idle');
  const [msg, setMsg] = useState('');

  async function handleSeed() {
    setStatus('loading');
    const send = async (tok: string | null) =>
      fetch(`${config.apiBaseUrl}/api/seed`, {
        method: 'POST',
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
    try {
      const token = getAccessToken();
      let res = await send(token);
      if (res.status === 401 && token) {
        const refreshed = await refreshAccessToken();
        if (refreshed) res = await send(refreshed);
      }
      const data = await res.json();
      setMsg(data.message ?? 'Demo data request complete.');
      setStatus(data.seeded > 0 ? 'done' : 'skipped');
    } catch {
      setMsg('Could not reach backend.');
      setStatus('idle');
    }
  }

  const busy = status === 'loading' || status === 'done' || status === 'skipped';
  return (
    <div className="app-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <Database size={17} className="text-[var(--text-3)]" />
        <h2 className="app-section-title">Demo data</h2>
      </div>
      <p className="text-sm text-[var(--text-3)]">
        Load 55 synthetic chunks across the four retention profiles for testing the dashboard and quizzes.
      </p>
      {msg && (
        <p className={`mt-3 text-sm font-medium ${status === 'done' ? 'text-[var(--good)]' : 'text-[var(--text-2)]'}`}>
          {msg}
        </p>
      )}
      <button type="button" onClick={handleSeed} disabled={busy} className="btn-primary mt-4">
        {status === 'loading' ? 'Loading…' : status === 'done' ? 'Loaded' : status === 'skipped' ? 'Already loaded' : 'Load demo data'}
      </button>
    </div>
  );
}

/* ─── Danger zone: actually wipes your library ────────────────────── */

function ResetLibrarySection() {
  const [count, setCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    getAllChunks().then(r => setCount(r.total)).catch(() => setCount(null));
  }, []);

  async function reset() {
    if (count == null || count === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await getAllChunks();
      const ids = r.chunks.map(c => c.chunk_id);
      // Bulk-delete in batches of 100 to keep request size sane.
      for (let i = 0; i < ids.length; i += 100) {
        await bulkDeleteChunks(ids.slice(i, i + 100));
      }
      setMsg(`Deleted ${ids.length} chunk${ids.length === 1 ? '' : 's'}.`);
      setCount(0);
      setConfirming(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Reset failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-card border-l-4 border-l-[var(--danger)] p-5">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle size={17} className="text-[var(--danger)]" />
        <h2 className="app-section-title">Danger zone</h2>
      </div>
      <p className="text-sm text-[var(--text-3)]">
        Permanently delete every chunk in your library. The embedding index is wiped too. There is no undo.
      </p>
      {msg && (
        <p className="mt-3 text-sm font-medium text-[var(--text-2)]">{msg}</p>
      )}
      <div className="mt-4 flex items-center gap-2">
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={count === null || count === 0}
            className="btn-secondary text-[var(--danger)]"
          >
            <Trash2 size={14} /> Reset library
            {count !== null && count > 0 && (
              <span className="ml-1 text-[var(--text-3)]">({count})</span>
            )}
          </button>
        ) : (
          <>
            <button type="button" onClick={reset} disabled={busy} className="btn-primary" style={{ background: 'var(--danger)' }}>
              {busy ? 'Deleting…' : `Yes, delete all ${count ?? ''} chunks`}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="btn-secondary">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Settings page ───────────────────────────────────────────────── */

export function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Page header */}
      <header className="mb-2">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            <SettingsIcon size={18} />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold text-[var(--text-1)]">Settings</h1>
            <p className="text-sm text-[var(--text-3)]">Account, demo data, and library management.</p>
          </div>
        </div>
      </header>

      {/* Account */}
      <div className="app-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <User size={17} className="text-[var(--text-3)]" />
          <h2 className="app-section-title">Account</h2>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold text-[var(--text-1)]">{user?.name ?? 'Demo User'}</p>
            <p className="text-sm text-[var(--text-3)]">{user?.email ?? 'demo@dory.md'}</p>
          </div>
          <button type="button" onClick={handleLogout} className="btn-secondary text-[var(--danger)]">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>

      {/* Demo data */}
      <DemoDataSection />

      {/* Danger zone */}
      <ResetLibrarySection />
    </div>
  );
}
