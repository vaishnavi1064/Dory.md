import {
  Settings, Brain, Bell, Clock, Shield, Palette,
  ToggleLeft, ToggleRight, ChevronRight, Info, LogOut, User, Plug,
  RefreshCw, CheckSquare, Square, Database,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useTheme, type Theme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { notionStatus, notionConnect, listNotionPages, importNotionPages } from '@/lib/api';
import type { NotionStatus, NotionPage } from '@/lib/types';
import { config } from '@/lib/config';

interface Toggle { label: string; description: string; value: boolean }

function ToggleRow({ label, description, value, onChange }: Toggle & { onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
      <button onClick={() => onChange(!value)} className="shrink-0 transition-all duration-200">
        {value
          ? <ToggleRight size={28} style={{ color: 'var(--primary)' }} />
          : <ToggleLeft size={28} className="text-slate-600" />}
      </button>
    </div>
  );
}

function NotionIntegration() {
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<NotionPage[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    notionStatus()
      .then(s => { setStatus(s); if (s.connected) loadPages(); })
      .catch(() => setStatus({ connected: false, oauth_available: false }))
      .finally(() => setLoading(false));
  }, []);

  function loadPages() {
    setPagesLoading(true);
    listNotionPages()
      .then(setPages)
      .catch(() => setBanner({ type: 'err', msg: 'Failed to load pages.' }))
      .finally(() => setPagesLoading(false));
  }

  async function handleTokenConnect() {
    if (!manualToken.trim()) return;
    setConnecting(true);
    try {
      const res = await notionConnect(manualToken.trim());
      setStatus({ connected: true, oauth_available: status?.oauth_available ?? false, workspace: res.workspace });
      setBanner({ type: 'ok', msg: `Connected to ${res.workspace}` });
      setManualToken('');
      loadPages();
    } catch (e: any) {
      setBanner({ type: 'err', msg: e.message });
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await fetch(`${config.apiBaseUrl}/auth/notion`, { method: 'DELETE' });
    setStatus(s => s ? { ...s, connected: false, workspace: undefined } : s);
    setPages([]);
    setSelected(new Set());
  }

  function togglePage(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleImport() {
    if (!selected.size) return;
    setImporting(true);
    try {
      const res = await importNotionPages([...selected]);
      setBanner({ type: 'ok', msg: `Imported ${res.pages_imported} page(s) — ${res.chunks_created} chunks indexed.` });
      setSelected(new Set());
    } catch (e: any) {
      setBanner({ type: 'err', msg: e.message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="gcard p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'rgba(251,191,36,0.1)' }}>
          <Plug size={13} className="text-yellow-400" />
        </div>
        <h2 className="text-sm font-semibold text-slate-200">Integrations</h2>
        {status?.connected && (
          <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80' }}>
            Notion connected
          </span>
        )}
      </div>

      {banner && (
        <div
          className="flex items-center justify-between px-3 py-2 rounded-lg text-xs"
          style={banner.type === 'ok'
            ? { background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }
            : { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
        >
          <span>{banner.msg}</span>
          <button onClick={() => setBanner(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Notion connection */}
      <div className="space-y-3" style={{ borderBottom: '1px solid #1f1f1f', paddingBottom: '1rem' }}>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold" style={{ color: '#f59e0b', fontFamily: 'serif' }}>N</span>
          <span className="text-sm text-slate-300 font-medium">Notion</span>
        </div>

        {loading ? (
          <p className="text-xs text-slate-600">Checking connection…</p>
        ) : status?.connected ? (
          <div className="flex items-center justify-between">
            <div>
              {status.workspace && <p className="text-sm text-slate-200">{status.workspace}</p>}
              <p className="text-xs text-slate-600 mt-0.5">Integration token stored</p>
            </div>
            <button
              onClick={handleDisconnect}
              className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all"
              style={{ color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)' }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {status?.oauth_available ? (
              <button
                onClick={() => { window.location.href = `${config.apiBaseUrl}/auth/notion`; }}
                className="corp-btn-primary text-xs px-3 py-1.5"
              >
                Connect with Notion OAuth
              </button>
            ) : (
              <>
                <p className="text-xs text-slate-600">Paste your Notion internal integration token (secret_…)</p>
                <div className="flex gap-2">
                  <input
                    className="corp-input flex-1 text-xs"
                    type="password"
                    placeholder="secret_..."
                    value={manualToken}
                    onChange={e => setManualToken(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleTokenConnect()}
                  />
                  <button
                    onClick={handleTokenConnect}
                    disabled={connecting || !manualToken.trim()}
                    className="corp-btn-primary text-xs px-3"
                  >
                    {connecting ? 'Connecting…' : 'Connect'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Page importer — only shown when connected */}
      {status?.connected && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-400">Import pages into Dory</p>
            <div className="flex items-center gap-2">
              {pages.length > 0 && (
                <button
                  onClick={() => setSelected(selected.size === pages.length ? new Set() : new Set(pages.map(p => p.id)))}
                  className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {selected.size === pages.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
              <button onClick={loadPages} disabled={pagesLoading} className="text-slate-600 hover:text-slate-300 transition-colors">
                <RefreshCw size={12} className={pagesLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {pagesLoading ? (
            <p className="text-xs text-slate-600">Loading pages…</p>
          ) : pages.length === 0 ? (
            <p className="text-xs text-slate-600">No pages found. Share pages with your integration first.</p>
          ) : (
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {pages.map(p => (
                <button
                  key={p.id}
                  onClick={() => togglePage(p.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/[0.03]"
                >
                  {selected.has(p.id)
                    ? <CheckSquare size={12} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                    : <Square size={12} className="text-slate-700 shrink-0" />}
                  <span className="text-slate-300 truncate flex-1 text-left">{p.title}</span>
                  <span className="text-slate-700 font-mono shrink-0">{p.id.slice(0, 6)}</span>
                </button>
              ))}
            </div>
          )}

          {pages.length > 0 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-600">{selected.size} selected</span>
              <button
                onClick={handleImport}
                disabled={!selected.size || importing}
                className="corp-btn-primary text-xs px-3 py-1.5"
              >
                {importing ? 'Importing…' : `Import ${selected.size || ''} page${selected.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          )}
        </div>
      )}

      {!status?.connected && !loading && (
        <p className="text-xs text-slate-700">
          Connect Notion to import pages directly into your Dory knowledge base.
        </p>
      )}
    </div>
  );
}

function DemoDataSection() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'skipped'>('idle');
  const [msg, setMsg] = useState('');

  async function handleSeed() {
    setStatus('loading');
    try {
      const token = localStorage.getItem('dory-token');
      const res = await fetch(`${config.apiBaseUrl}/api/seed`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setMsg(data.message);
      setStatus(data.seeded > 0 ? 'done' : 'skipped');
    } catch {
      setMsg('Could not reach backend.');
      setStatus('idle');
    }
  }

  return (
    <div className="gcard p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-slate-800 flex items-center justify-center">
          <Database size={13} className="text-slate-400" />
        </div>
        <h2 className="text-sm font-semibold text-slate-200">Demo data</h2>
      </div>
      <p className="text-xs text-slate-500">
        Load 25 synthetic memory chunks across strong, fading, weak, and critical retention profiles to populate the dashboard for demos.
      </p>
      {msg && (
        <p className={`text-xs ${status === 'done' ? 'text-green-400' : 'text-slate-400'}`}>{msg}</p>
      )}
      <button
        onClick={handleSeed}
        disabled={status === 'loading' || status === 'done' || status === 'skipped'}
        className="corp-btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
      >
        {status === 'loading' ? 'Loading...' : status === 'done' ? 'Loaded' : status === 'skipped' ? 'Already loaded' : 'Load demo data'}
      </button>
    </div>
  );
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() { logout(); navigate('/login'); }


  const [toggles, setToggles] = useState({
    discoveryPolling: true,
    quizReminders: true,
    decayAlerts: true,
    useMocks: true,
    compactCards: false,
    autoIngest: false,
  });
  const [pollInterval, setPollInterval] = useState('30');

  function set(key: keyof typeof toggles) {
    return (v: boolean) => setToggles(p => ({ ...p, [key]: v }));
  }

  const sections = [
    {
      icon: Brain, title: 'Memory engine', color: 'text-nebula-400', bg: 'rgba(124,58,237,0.1)',
      rows: [
        { key: 'autoIngest', label: 'Auto-ingest clipboard', description: 'Automatically capture copied text as memory chunks' },
        { key: 'decayAlerts', label: 'Decay alerts', description: 'Warn when a chunk drops below 30% retention' },
      ],
    },
    {
      icon: Bell, title: 'Notifications', color: 'text-flare-400', bg: 'rgba(249,115,22,0.1)',
      rows: [
        { key: 'discoveryPolling', label: 'Discovery notifications', description: 'Poll for forgotten memories every few minutes' },
        { key: 'quizReminders', label: 'Quiz reminders', description: 'Remind you to quiz when retention drops' },
      ],
    },
    {
      icon: Shield, title: 'Developer', color: 'text-pulsar-400', bg: 'rgba(8,145,178,0.1)',
      rows: [
        { key: 'useMocks', label: 'Use mock data', description: 'Run without a backend — all data is local' },
        { key: 'compactCards', label: 'Compact chunk cards', description: 'Show truncated content to fit more on screen' },
      ],
    },
  ] as const;

  const themeOptions: { id: Theme; label: string; colors: string[] }[] = [
    { id: 'cosmos',   label: 'Cosmos',   colors: ['#7c3aed', '#0891b2', '#f97316'] },
    { id: 'midnight', label: 'Midnight', colors: ['#3b82f6', '#06b6d4', '#8b5cf6'] },
    { id: 'aurora',   label: 'Aurora',   colors: ['#10b981', '#06b6d4', '#a78bfa'] },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-cosmos-800 border border-cosmos-700 flex items-center justify-center">
          <Settings size={16} className="text-slate-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Settings</h1>
          <p className="text-sm text-slate-500">Configure your Memory OS</p>
        </div>
      </div>

      {sections.map(({ icon: Icon, title, color, bg, rows }) => (
        <div key={title} className="gcard p-5 space-y-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: bg }}>
              <Icon size={13} className={color} />
            </div>
            <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
          </div>
          <div className="divide-y divide-cosmos-700/40">
            {rows.map(({ key, label, description }) => (
              <ToggleRow key={key} label={label} description={description}
                value={toggles[key as keyof typeof toggles]}
                onChange={set(key as keyof typeof toggles)} />
            ))}
          </div>
        </div>
      ))}

      {/* Poll interval */}
      <div className="gcard p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-pulsar-500/10 flex items-center justify-center">
            <Clock size={13} className="text-pulsar-400" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">Discovery poll interval</h2>
        </div>
        <div className="flex items-center gap-3">
          <input type="range" min={10} max={120} step={10} value={pollInterval}
            onChange={e => setPollInterval(e.target.value)} className="flex-1"
            style={{ accentColor: 'var(--primary)' }} />
          <span className="text-sm font-mono w-16 text-right" style={{ color: 'var(--primary)' }}>{pollInterval}s</span>
        </div>
        <p className="text-xs text-slate-600">How often Dory checks for forgotten memories in the background</p>
      </div>

      {/* Theme */}
      <div className="gcard p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-flare-500/10 flex items-center justify-center">
            <Palette size={13} className="text-flare-400" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">Color theme</h2>
        </div>
        <div className="flex gap-2">
          {themeOptions.map(({ id, label, colors }) => (
            <button key={id} onClick={() => setTheme(id)}
              className={cn('flex-1 py-3 rounded-lg border text-xs font-medium transition-all duration-200',
                theme === id ? 'text-white' : 'border-cosmos-700 bg-cosmos-800/40 text-slate-500 hover:text-slate-300 hover:border-cosmos-600')}
              style={theme === id ? { background: `linear-gradient(135deg, ${colors[0]}22 0%, ${colors[1]}15 100%)`, borderColor: `${colors[0]}55`, color: colors[0] } : {}}
            >
              <div className="flex justify-center gap-1 mb-1.5">
                {colors.map(c => <div key={c} className="w-3 h-3 rounded-full" style={{ background: c }} />)}
              </div>
              {label}
              {theme === id && <div className="text-[10px] mt-0.5 opacity-70">Active</div>}
            </button>
          ))}
        </div>
      </div>

      {/* Integrations — Notion */}
      <NotionIntegration />

      {/* Account */}
      <div className="gcard p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-nebula-500/10 flex items-center justify-center">
            <User size={13} className="text-nebula-400" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">Account</h2>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-200">{user?.name}</p>
            <p className="text-xs text-slate-500 mt-0.5">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 transition-all duration-200"
          >
            <LogOut size={12} />
            Sign out
          </button>
        </div>
      </div>

      {/* Demo data */}
      <DemoDataSection />

      {/* About */}
      <div className="gcard p-4 flex items-center gap-3">
        <Info size={14} className="text-slate-600 shrink-0" />
        <p className="text-xs text-slate-500 flex-1">Dory.md v0.1.0 — UWB Hacks 2026 · Track 2: Human Experience</p>
        <ChevronRight size={13} className="text-slate-700" />
      </div>
    </div>
  );
}
