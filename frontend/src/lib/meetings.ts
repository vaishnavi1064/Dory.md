import { config } from '@/lib/config';
import { clearTokens, getAccessToken, refreshAccessToken } from '@/lib/tokens';

export interface Meeting {
  id: string;
  title: string;
  starts_at: string;
  duration_minutes: number;
  link: string | null;
  notes: string | null;
  location: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMeetingInput {
  title: string;
  starts_at: string;
  duration_minutes?: number;
  link?: string;
  notes?: string;
  location?: string;
}

export const REMINDER_MINUTES_KEY = 'dory.calendar.reminderMinutes';
export const REMINDER_OPTIONS = [5, 10, 15, 30] as const;
export const DEFAULT_REMINDER_MINUTES = 10;
export const MEETINGS_CHANGED_EVENT = 'dory.meetings.changed';
export const MEETING_SOUND_PATH = '/sounds/wellness-ping.mp3';

export const MEETING_LINK_ERROR =
  'Link must start with http:// or https:// (e.g. https://zoom.us/...)';

const BLOCKED_SCHEME_PREFIXES = [
  'javascript:', 'data:', 'file:', 'ftp:', 'ftps:',
  'mailto:', 'tel:', 'vbscript:',
];

export type NormalizeMeetingLinkResult =
  | { ok: true; link: string }
  | { ok: false; error: string };

/** Normalize and validate a meeting link (mirrors backend _normalize_link). */
export function normalizeMeetingLink(raw: string): NormalizeMeetingLinkResult {
  const link = raw.trim();
  if (!link) return { ok: false, error: MEETING_LINK_ERROR };

  const lower = link.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return { ok: true, link };
  }

  if (
    link.includes('://') ||
    BLOCKED_SCHEME_PREFIXES.some((p) => lower.startsWith(p))
  ) {
    return { ok: false, error: MEETING_LINK_ERROR };
  }

  if (!link.includes('.')) {
    return { ok: false, error: MEETING_LINK_ERROR };
  }

  return { ok: true, link: `https://${link}` };
}

export function getReminderMinutes(): number {
  const raw = localStorage.getItem(REMINDER_MINUTES_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return REMINDER_OPTIONS.includes(n as (typeof REMINDER_OPTIONS)[number])
    ? n
    : DEFAULT_REMINDER_MINUTES;
}

export function setReminderMinutes(minutes: number): void {
  if (!REMINDER_OPTIONS.includes(minutes as (typeof REMINDER_OPTIONS)[number])) return;
  localStorage.setItem(REMINDER_MINUTES_KEY, String(minutes));
  window.dispatchEvent(new CustomEvent(MEETINGS_CHANGED_EVENT));
}

export function notifyMeetingsChanged(): void {
  window.dispatchEvent(new CustomEvent(MEETINGS_CHANGED_EVENT));
}

export function clearMeetingFiredFlag(meetingId: string): void {
  localStorage.removeItem(`dory.meeting.fired.${meetingId}`);
}

async function meetingsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const doFetch = (tok: string | null) =>
    fetch(`${config.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

  let res = await doFetch(token);
  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) res = await doFetch(newToken);
    else {
      clearTokens();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.replace('/login');
      }
      throw new Error('Session expired.');
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function fetchMeetings(from?: Date, to?: Date): Promise<Meeting[]> {
  const params = new URLSearchParams();
  if (from) params.set('from', from.toISOString());
  if (to) params.set('to', to.toISOString());
  const qs = params.toString();
  const data = await meetingsFetch<{ meetings: Meeting[] }>(
    `/api/meetings${qs ? `?${qs}` : ''}`,
  );
  return data.meetings;
}

export async function createMeeting(input: CreateMeetingInput): Promise<Meeting> {
  return meetingsFetch<Meeting>('/api/meetings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateMeeting(
  id: string,
  patch: Partial<CreateMeetingInput>,
): Promise<Meeting> {
  return meetingsFetch<Meeting>(`/api/meetings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteMeeting(id: string): Promise<void> {
  await meetingsFetch<void>(`/api/meetings/${id}`, { method: 'DELETE' });
}
