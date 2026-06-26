import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AlertTriangle, Activity, CalendarClock, Database, Download, Droplet, Heart, Loader2, LogOut, Moon, RotateCw, Settings as SettingsIcon, ShieldCheck, Timer, Trash2, User, Wind } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/config';
import { getAccessToken, refreshAccessToken } from '@/lib/tokens';
import { bulkDeleteChunks, exportAccount, getAllChunks } from '@/lib/api';
import { DeleteAccountModal } from '@/components/account/DeleteAccountModal';
import { ensureAudio, ensureNotifPermission } from '@/lib/timerEffects';
import {
  WELLNESS_BREATHING_ENABLED,
  WELLNESS_BREATHING_INTERVAL,
  WELLNESS_INTERVAL_OPTIONS,
  WELLNESS_QUIET_ENABLED,
  WELLNESS_QUIET_END,
  WELLNESS_QUIET_START,
  WELLNESS_STRETCH_ENABLED,
  WELLNESS_STRETCH_INTERVAL,
  WELLNESS_WATER_ENABLED,
  WELLNESS_WATER_INTERVAL,
  notifyWellnessChanged,
  readBreathingEnabled,
  readBreathingInterval,
  readQuietHoursEnabled,
  readQuietHoursEnd,
  readQuietHoursStart,
  readStretchEnabled,
  readStretchInterval,
  readWaterEnabled,
  readWaterInterval,
} from '@/lib/wellness';
import { MOOD_ASK_KEY, isMoodAskEnabled, notifyMoodChanged, getCooldownHours, setCooldownHours, COOLDOWN_OPTIONS } from '@/lib/mood';
import {
  getReminderMinutes,
  REMINDER_OPTIONS,
  setReminderMinutes,
} from '@/lib/meetings';

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
            <button type="button" onClick={reset} disabled={busy} className="btn-danger">
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

/* ─── Meetings ────────────────────────────────────────────────────── */

function MeetingsSection() {
  const [reminderMin, setReminderMin] = useState(getReminderMinutes);

  function onReminderChange(v: string) {
    const next = parseInt(v, 10);
    setReminderMinutes(next);
    setReminderMin(next);
  }

  return (
    <div className="app-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <CalendarClock size={17} className="text-[var(--text-3)]" />
        <h2 className="app-section-title">Meetings</h2>
      </div>
      <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between pt-2">
        <div>
          <p className="font-bold text-[var(--text-1)]">Default reminder time</p>
          <p className="text-sm text-[var(--text-3)]">
            How many minutes before each meeting Dory will remind you.
          </p>
        </div>
        <select
          value={reminderMin}
          onChange={(e) => onReminderChange(e.target.value)}
          aria-label="Default meeting reminder time"
          className="corp-input h-9 w-auto min-w-[130px] shrink-0"
        >
          {REMINDER_OPTIONS.map((min) => (
            <option key={min} value={min}>{min} minutes</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ─── Mood tracking ───────────────────────────────────────────────── */

function MoodTrackingSection() {
  const [askMood, setAskMood] = useState<boolean>(() => isMoodAskEnabled());
  const [cooldownHours, setCooldownHoursState] = useState(getCooldownHours);

  function toggle() {
    setAskMood((prev) => {
      const next = !prev;
      localStorage.setItem(MOOD_ASK_KEY, String(next));
      notifyMoodChanged();
      return next;
    });
  }

  function onCooldownChange(v: string) {
    const next = parseInt(v, 10);
    setCooldownHours(next);
    setCooldownHoursState(next);
  }

  const cooldownLabels: Record<number, string> = {
    1: '1 hour',
    4: '4 hours',
    8: '8 hours',
    12: '12 hours',
    24: 'Once a day (24 hours)',
  };

  return (
    <div className="app-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <Heart size={17} className="text-[var(--text-3)]" />
        <h2 className="app-section-title">Mood tracking</h2>
      </div>
      <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between pt-2">
        <div>
          <p className="font-bold text-[var(--text-1)]">Ask about my mood</p>
          <p className="text-sm text-[var(--text-3)]">
            After creating notes, reviewing chunks, or completing quizzes, Dory will ask how you&apos;re feeling. Always optional, never blocks.
          </p>
          <Link to="/mood" className="mt-2 inline-block text-sm font-bold text-[var(--accent)] hover:underline">
            View your mood patterns
          </Link>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={askMood}
          aria-label="Ask about my mood"
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${askMood ? 'bg-[var(--accent)]' : 'bg-[var(--surface-3)]'}`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-[var(--surface)] shadow transition-transform ${askMood ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
      <div className="mt-4 flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between border-t border-[var(--border)] pt-4">
        <div>
          <p className="font-bold text-[var(--text-1)]">How often to ask</p>
          <p className="text-sm text-[var(--text-3)]">
            Dory will only ask once every {cooldownHours} hours during normal use.
            You can always log manually anytime.
          </p>
        </div>
        <select
          value={cooldownHours}
          disabled={!askMood}
          onChange={(e) => onCooldownChange(e.target.value)}
          aria-label="Mood prompt cooldown"
          className="corp-input h-9 w-auto min-w-[180px] shrink-0 disabled:opacity-45"
        >
          {COOLDOWN_OPTIONS.map((h) => (
            <option key={h} value={h}>{cooldownLabels[h]}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ─── Wellness reminders ──────────────────────────────────────────── */

function WellnessToggle({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--surface-3)]'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-[var(--surface)] shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function WellnessReminderRow({
  label,
  subtext,
  icon,
  enabled,
  interval,
  enabledKey,
  intervalKey,
  onEnabledChange,
  onIntervalChange,
}: {
  label: string;
  subtext: string;
  icon: ReactNode;
  enabled: boolean;
  interval: number;
  enabledKey: string;
  intervalKey: string;
  onEnabledChange: (next: boolean) => void;
  onIntervalChange: (next: number) => void;
}) {
  function toggle() {
    const next = !enabled;
    if (next) {
      ensureAudio();
      void ensureNotifPermission();
    }
    localStorage.setItem(enabledKey, String(next));
    onEnabledChange(next);
    notifyWellnessChanged();
  }

  function onIntervalSelect(v: string) {
    const next = parseInt(v, 10);
    localStorage.setItem(intervalKey, String(next));
    onIntervalChange(next);
    notifyWellnessChanged();
  }

  return (
    <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
      <div>
        <p className="flex items-center gap-1.5 font-bold text-[var(--text-1)]">
          {icon} {label}
        </p>
        <p className="text-sm text-[var(--text-3)]">{subtext}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <select
          value={interval}
          disabled={!enabled}
          onChange={(e) => onIntervalSelect(e.target.value)}
          aria-label={`${label} interval`}
          className="corp-input h-9 w-auto min-w-[110px] disabled:opacity-45"
        >
          {WELLNESS_INTERVAL_OPTIONS.map((min) => (
            <option key={min} value={min}>{min} min</option>
          ))}
        </select>
        <WellnessToggle checked={enabled} label={`Enable ${label} reminders`} onToggle={toggle} />
      </div>
    </div>
  );
}

function WellnessSection() {
  const [stretchEnabled, setStretchEnabled] = useState(readStretchEnabled);
  const [stretchInterval, setStretchInterval] = useState(readStretchInterval);
  const [waterEnabled, setWaterEnabled] = useState(readWaterEnabled);
  const [waterInterval, setWaterInterval] = useState(readWaterInterval);
  const [breathingEnabled, setBreathingEnabled] = useState(readBreathingEnabled);
  const [breathingInterval, setBreathingInterval] = useState(readBreathingInterval);
  const [quietEnabled, setQuietEnabled] = useState(readQuietHoursEnabled);
  const [quietStart, setQuietStart] = useState(readQuietHoursStart);
  const [quietEnd, setQuietEnd] = useState(readQuietHoursEnd);

  function toggleQuietHours() {
    const next = !quietEnabled;
    localStorage.setItem(WELLNESS_QUIET_ENABLED, String(next));
    setQuietEnabled(next);
    notifyWellnessChanged();
  }

  function onQuietStart(v: string) {
    localStorage.setItem(WELLNESS_QUIET_START, v);
    setQuietStart(v);
    notifyWellnessChanged();
  }

  function onQuietEnd(v: string) {
    localStorage.setItem(WELLNESS_QUIET_END, v);
    setQuietEnd(v);
    notifyWellnessChanged();
  }

  return (
    <div className="app-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Activity size={17} className="text-[var(--text-3)]" />
        <h2 className="app-section-title">Wellness reminders</h2>
      </div>

      <div className="space-y-4">
        <WellnessReminderRow
          label="Stretch"
          icon={<RotateCw size={14} className="text-[var(--text-3)]" />}
          subtext={`Stand up and move every ${stretchInterval} minutes`}
          enabled={stretchEnabled}
          interval={stretchInterval}
          enabledKey={WELLNESS_STRETCH_ENABLED}
          intervalKey={WELLNESS_STRETCH_INTERVAL}
          onEnabledChange={setStretchEnabled}
          onIntervalChange={setStretchInterval}
        />

        <WellnessReminderRow
          label="Water"
          icon={<Droplet size={14} className="text-[var(--text-3)]" />}
          subtext={`Drink water every ${waterInterval} minutes`}
          enabled={waterEnabled}
          interval={waterInterval}
          enabledKey={WELLNESS_WATER_ENABLED}
          intervalKey={WELLNESS_WATER_INTERVAL}
          onEnabledChange={setWaterEnabled}
          onIntervalChange={setWaterInterval}
        />

        <WellnessReminderRow
          label="Breathing"
          icon={<Wind size={14} className="text-[var(--text-3)]" />}
          subtext={`Pause for slow breaths every ${breathingInterval} minutes`}
          enabled={breathingEnabled}
          interval={breathingInterval}
          enabledKey={WELLNESS_BREATHING_ENABLED}
          intervalKey={WELLNESS_BREATHING_INTERVAL}
          onEnabledChange={setBreathingEnabled}
          onIntervalChange={setBreathingInterval}
        />
      </div>

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
          <div>
            <p className="flex items-center gap-1.5 font-bold text-[var(--text-1)]">
              Quiet hours <Moon size={14} className="text-[var(--text-3)]" />
            </p>
            <p className="text-sm text-[var(--text-3)]">
              Silence reminders between {quietStart} and {quietEnd}
            </p>
          </div>
          <WellnessToggle checked={quietEnabled} label="Enable quiet hours" onToggle={toggleQuietHours} />
        </div>

        {quietEnabled && (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            <label className="flex flex-col gap-1 text-sm font-bold text-[var(--text-2)]">
              Start
              <input
                type="time"
                value={quietStart}
                onChange={(e) => onQuietStart(e.target.value)}
                className="corp-input h-9 w-full sm:w-auto"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold text-[var(--text-2)]">
              End
              <input
                type="time"
                value={quietEnd}
                onChange={(e) => onQuietEnd(e.target.value)}
                className="corp-input h-9 w-full sm:w-auto"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Timer: celebration toggle ───────────────────────────────────── */

const CELEBRATE_KEY = 'dory.timer.celebrate';

function TimerSection() {
  const [celebrate, setCelebrate] = useState<boolean>(() => localStorage.getItem(CELEBRATE_KEY) !== 'false');

  function toggle() {
    setCelebrate((prev) => {
      const next = !prev;
      localStorage.setItem(CELEBRATE_KEY, String(next));
      return next;
    });
  }

  return (
    <div className="app-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <Timer size={17} className="text-[var(--text-3)]" />
        <h2 className="app-section-title">Timer</h2>
      </div>
      <div className="flex items-start justify-between gap-4 pt-2">
        <div>
          <p className="font-bold text-[var(--text-1)]">Celebrate completed sessions</p>
          <p className="text-sm text-[var(--text-3)]">Show a checkmark, pulse animation, and confetti when a custom timer session ends.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={celebrate}
          aria-label="Celebrate completed sessions"
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${celebrate ? 'bg-[var(--accent)]' : 'bg-[var(--surface-3)]'}`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-[var(--surface)] shadow transition-transform ${celebrate ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </div>
  );
}

/* ─── Privacy & Account: export + delete ──────────────────────────── */

function PrivacyAccountSection() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      // fetch -> blob -> object URL -> dynamic anchor -> revoke, so the JWT is
      // sent via the Authorization header (a bare <a href> / window.open can't).
      const blob = await exportAccount();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dory-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Could not export your data. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck size={17} className="text-[var(--text-3)]" />
        <h2 className="app-section-title">Privacy &amp; Account</h2>
      </div>

      {/* Export */}
      <div className="flex items-start justify-between gap-4 pt-2">
        <div>
          <p className="font-bold text-[var(--text-1)]">Export your data</p>
          <p className="text-sm text-[var(--text-3)]">Download a JSON copy of your account, notes, and access history.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button type="button" onClick={handleExport} disabled={exporting} className="btn-primary">
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {exporting ? 'Preparing…' : 'Download'}
          </button>
          {exportError && <p className="text-xs font-bold text-[var(--danger)]">{exportError}</p>}
        </div>
      </div>

      {/* Delete */}
      <div className="mt-4 flex items-start justify-between gap-4 border-t border-[var(--border)] pt-4">
        <div>
          <p className="font-bold text-[var(--text-1)]">Delete account</p>
          <p className="text-sm text-[var(--text-3)]">Permanently delete your account and all data. This cannot be undone.</p>
        </div>
        <button type="button" onClick={() => setShowDelete(true)} className="btn-danger shrink-0" aria-label="Delete account permanently">
          <Trash2 size={14} /> Delete account
        </button>
      </div>

      {showDelete && <DeleteAccountModal onClose={() => setShowDelete(false)} />}
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

      {/* Meetings */}
      <MeetingsSection />

      {/* Mood tracking */}
      <MoodTrackingSection />

      {/* Wellness reminders */}
      <WellnessSection />

      {/* Timer */}
      <TimerSection />

      {/* Privacy & Account */}
      <PrivacyAccountSection />
    </div>
  );
}
