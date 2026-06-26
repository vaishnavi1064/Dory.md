import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar, Plus, Edit2, Trash2, ExternalLink, MapPin, X, Loader2, FileText,
} from 'lucide-react';
import { ensureNotifPermission } from '@/lib/timerEffects';
import {
  createMeeting,
  deleteMeeting,
  fetchMeetings,
  normalizeMeetingLink,
  notifyMeetingsChanged,
  clearMeetingFiredFlag,
  updateMeeting,
  type Meeting,
} from '@/lib/meetings';

interface FormState {
  title: string;
  date: string;
  time: string;
  duration_minutes: number;
  link: string;
  notes: string;
  location: string;
}

const EMPTY_FORM: FormState = {
  title: '',
  date: '',
  time: '',
  duration_minutes: 30,
  link: '',
  notes: '',
  location: '',
};

function toLocalDateInput(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toLocalTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function localDateTimeToIso(date: string, time: string): string {
  const dt = new Date(`${date}T${time}`);
  if (Number.isNaN(dt.getTime())) throw new Error('Invalid date or time.');
  return dt.toISOString();
}

function formatDateHeader(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatRelative(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 0) return 'started';
  if (diffMin < 60) return `in ${diffMin} minute${diffMin === 1 ? '' : 's'}`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `in ${diffHr} hour${diffHr === 1 ? '' : 's'}`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return 'tomorrow';
  return `in ${diffDay} days`;
}

function formatTimeRange(iso: string, durationMin: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${fmt(start)} — ${fmt(end)}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function meetingToForm(m: Meeting): FormState {
  return {
    title: m.title,
    date: toLocalDateInput(m.starts_at),
    time: toLocalTimeInput(m.starts_at),
    duration_minutes: m.duration_minutes,
    link: m.link ?? '',
    notes: m.notes ?? '',
    location: m.location ?? '',
  };
}

function MeetingFormModal({
  editing,
  initial,
  onClose,
  onSaved,
}: {
  editing: Meeting | null;
  initial: FormState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!form.date || !form.time) {
      setError('Date and time are required.');
      return;
    }
    if (form.duration_minutes < 1 || form.duration_minutes > 1440) {
      setError('Duration must be between 1 and 1440 minutes.');
      return;
    }

    let starts_at: string;
    try {
      starts_at = localDateTimeToIso(form.date, form.time);
    } catch {
      setError('Invalid date or time.');
      return;
    }

    const linkResult = form.link.trim()
      ? normalizeMeetingLink(form.link)
      : { ok: true as const, link: '' };
    if (form.link.trim() && !linkResult.ok) {
      setError(linkResult.error);
      return;
    }

    const payload = {
      title: form.title.trim(),
      starts_at,
      duration_minutes: form.duration_minutes,
      link: linkResult.ok && linkResult.link ? linkResult.link : undefined,
      notes: form.notes.trim() || undefined,
      location: form.location.trim() || undefined,
    };

    setBusy(true);
    try {
      if (editing) {
        await updateMeeting(editing.id, payload);
        clearMeetingFiredFlag(editing.id);
      } else {
        await createMeeting(payload);
      }
      notifyMeetingsChanged();
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save meeting.');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="meeting-form-title"
      onClick={onClose}
    >
      <div
        className="app-card flex w-full max-w-lg flex-col shadow-[var(--shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h3 id="meeting-form-title" className="font-bold text-[var(--text-1)]">
            {editing ? 'Edit meeting' : 'Add meeting'}
          </h3>
          <button type="button" onClick={onClose} className="btn-ghost h-8 w-8 p-0" title="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 px-5 py-5">
          <label className="block">
            <span className="app-label">Title *</span>
            <input
              className="corp-input mt-1 w-full"
              value={form.title}
              maxLength={200}
              onChange={(e) => setField('title', e.target.value)}
              required
            />
          </label>

          <div className="grid gap-3 min-[480px]:grid-cols-2">
            <label className="block">
              <span className="app-label">Date *</span>
              <input
                type="date"
                className="corp-input mt-1 w-full"
                value={form.date}
                onChange={(e) => setField('date', e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="app-label">Time *</span>
              <input
                type="time"
                className="corp-input mt-1 w-full"
                value={form.time}
                onChange={(e) => setField('time', e.target.value)}
                required
              />
            </label>
          </div>

          <label className="block">
            <span className="app-label">Duration (minutes)</span>
            <input
              type="number"
              min={1}
              max={1440}
              className="corp-input mt-1 w-full"
              value={form.duration_minutes}
              onChange={(e) => setField('duration_minutes', parseInt(e.target.value, 10) || 30)}
            />
          </label>

          <label className="block">
            <span className="app-label">Meeting link</span>
            <input
              className="corp-input mt-1 w-full"
              value={form.link}
              maxLength={500}
              placeholder="https://..."
              onChange={(e) => setField('link', e.target.value)}
            />
          </label>

          <label className="block">
            <span className="app-label">Location</span>
            <input
              className="corp-input mt-1 w-full"
              value={form.location}
              maxLength={500}
              onChange={(e) => setField('location', e.target.value)}
            />
          </label>

          <label className="block">
            <span className="app-label">Notes</span>
            <textarea
              className="corp-input mt-1 min-h-[80px] w-full resize-y"
              value={form.notes}
              maxLength={1000}
              onChange={(e) => setField('notes', e.target.value)}
            />
          </label>

          {error && <p className="text-sm font-bold text-[var(--danger)]">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add meeting'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Meeting | null>(null);

  const loadMeetings = useCallback(async () => {
    setError('');
    try {
      const from = new Date(Date.now() - 60 * 60_000);
      const to = new Date(Date.now() + 90 * 24 * 60 * 60_000);
      const data = await fetchMeetings(from, to);
      setMeetings(data.sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
    } catch {
      setError('Could not load meetings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings]);

  const grouped = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of meetings) {
      const key = new Date(m.starts_at).toDateString();
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return [...map.entries()].sort(
      ([, a], [, b]) => new Date(a[0].starts_at).getTime() - new Date(b[0].starts_at).getTime(),
    );
  }, [meetings]);

  function openAddForm() {
    void ensureNotifPermission();
    setEditing(null);
    setShowForm(true);
  }

  function openEditForm(meeting: Meeting) {
    setEditing(meeting);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  async function handleDelete(meeting: Meeting) {
    if (!window.confirm(`Delete "${meeting.title}"?`)) return;
    try {
      await deleteMeeting(meeting.id);
      notifyMeetingsChanged();
      await loadMeetings();
    } catch {
      setError('Could not delete meeting.');
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            <Calendar size={18} />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold text-[var(--text-1)]">Meetings</h1>
            <p className="text-sm text-[var(--text-3)]">
              Add upcoming meetings and Dory will remind you before they start.
            </p>
          </div>
        </div>
        <button type="button" className="btn-primary shrink-0" onClick={openAddForm}>
          <Plus size={16} /> Add meeting
        </button>
      </header>

      {loading && (
        <div className="flex min-h-[20vh] items-center justify-center text-[var(--text-3)]">
          <Loader2 size={22} className="animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="app-card p-5 text-sm font-bold text-[var(--danger)]">{error}</div>
      )}

      {!loading && !error && meetings.length === 0 && (
        <div className="app-card p-8 text-center text-sm text-[var(--text-3)]">
          No upcoming meetings. Click &apos;Add meeting&apos; to get started.
        </div>
      )}

      {!loading && !error && grouped.map(([dateKey, dayMeetings]) => (
        <section key={dateKey} className="space-y-3">
          <h2 className="app-section-title">{formatDateHeader(dayMeetings[0].starts_at)}</h2>
          <div className="space-y-3">
            {dayMeetings.map((meeting) => (
              <article key={meeting.id} className="app-card p-4">
                <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-[var(--text-1)]">{meeting.title}</h3>
                    <p className="mt-1 text-sm text-[var(--text-2)]">
                      {formatTimeRange(meeting.starts_at, meeting.duration_minutes)}
                      {' '}
                      <span className="text-[var(--text-3)]">({formatRelative(meeting.starts_at)})</span>
                    </p>
                    {meeting.location && (
                      <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--text-3)]">
                        <MapPin size={14} className="shrink-0" />
                        {meeting.location}
                      </p>
                    )}
                    {meeting.notes && (
                      <p className="mt-2 flex items-start gap-1.5 text-sm text-[var(--text-3)]">
                        <FileText size={14} className="mt-0.5 shrink-0" />
                        {truncate(meeting.notes, 100)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {meeting.link && (
                      <button
                        type="button"
                        className="btn-secondary text-sm"
                        onClick={() => window.open(meeting.link!, '_blank')}
                      >
                        <ExternalLink size={14} /> Join
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      onClick={() => openEditForm(meeting)}
                    >
                      <Edit2 size={14} /> Edit
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-sm text-[var(--danger)]"
                      onClick={() => void handleDelete(meeting)}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {showForm && (
        <MeetingFormModal
          editing={editing}
          initial={editing ? meetingToForm(editing) : EMPTY_FORM}
          onClose={closeForm}
          onSaved={() => void loadMeetings()}
        />
      )}
    </div>
  );
}
