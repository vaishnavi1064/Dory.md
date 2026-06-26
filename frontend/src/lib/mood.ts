import { config } from '@/lib/config';
import { clearTokens, getAccessToken, refreshAccessToken } from '@/lib/tokens';

export type Mood =
  | 'focused'
  | 'neutral'
  | 'anxious'
  | 'tired'
  | 'energized'
  | 'calm'
  | 'frustrated';

export type EventType = 'create' | 'review' | 'quiz';

export const MOODS: Array<{ value: Mood; emoji: string; label: string }> = [
  { value: 'focused', emoji: '😊', label: 'focused' },
  { value: 'neutral', emoji: '😐', label: 'neutral' },
  { value: 'anxious', emoji: '😰', label: 'anxious' },
  { value: 'tired', emoji: '😴', label: 'tired' },
  { value: 'energized', emoji: '⚡', label: 'energized' },
  { value: 'calm', emoji: '🙂', label: 'calm' },
  { value: 'frustrated', emoji: '😤', label: 'frustrated' },
];

/** Chart colors — one token per mood, no new palette. */
export const MOOD_CHART_COLORS: Record<Mood, string> = {
  focused: 'var(--accent)',
  neutral: 'var(--text-3)',
  anxious: 'var(--warn)',
  tired: 'var(--good)',
  energized: 'color-mix(in oklab, var(--accent) 70%, var(--warn))',
  calm: 'color-mix(in oklab, var(--good) 75%, var(--accent))',
  frustrated: 'var(--danger)',
};

export const MOOD_ASK_KEY = 'dory.mood.askEnabled';
export const MOOD_LAST_ASKED_KEY = 'dory.mood.lastAsked';
export const MOOD_COOLDOWN_KEY = 'dory.mood.cooldownHours';
export const COOLDOWN_OPTIONS = [1, 4, 8, 12, 24] as const;
export const DEFAULT_COOLDOWN_HOURS = 4;
export const MOOD_CHANGED_EVENT = 'dory.mood.changed';

export interface MoodHistoryEntry {
  id: number;
  chunk_id: string | null;
  mood: Mood;
  event_type: EventType;
  logged_at: string;
}

export interface MoodHistoryResponse {
  entries: MoodHistoryEntry[];
}

export interface MoodStatsResponse {
  total_logs: number;
  mood_counts: Record<Mood, number>;
  event_counts: Record<EventType, number>;
  mood_by_event: Record<EventType, Record<Mood, number>>;
  mood_over_time: Array<{ date: string } & Record<Mood, number>>;
  insights: string[];
}

async function moodFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
  return res.json() as Promise<T>;
}

export function isMoodAskEnabled(): boolean {
  return localStorage.getItem(MOOD_ASK_KEY) !== 'false';
}

export function getCooldownHours(): number {
  const raw = localStorage.getItem(MOOD_COOLDOWN_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return COOLDOWN_OPTIONS.includes(n as (typeof COOLDOWN_OPTIONS)[number])
    ? n
    : DEFAULT_COOLDOWN_HOURS;
}

export function setCooldownHours(hours: number): void {
  if (!COOLDOWN_OPTIONS.includes(hours as (typeof COOLDOWN_OPTIONS)[number])) return;
  localStorage.setItem(MOOD_COOLDOWN_KEY, String(hours));
  notifyMoodChanged();
}

export function canAskMoodNow(): boolean {
  if (!isMoodAskEnabled()) return false;
  const lastAsked = localStorage.getItem(MOOD_LAST_ASKED_KEY);
  if (!lastAsked) return true;
  const lastMs = parseInt(lastAsked, 10);
  if (Number.isNaN(lastMs)) return true;
  const cooldownMs = getCooldownHours() * 60 * 60 * 1000;
  return Date.now() - lastMs >= cooldownMs;
}

export function markMoodAsked(): void {
  localStorage.setItem(MOOD_LAST_ASKED_KEY, String(Date.now()));
}

/** Gate auto prompts: returns true if the prompt should be shown (and records ask time). */
export function tryShowMoodPrompt(): boolean {
  if (!canAskMoodNow()) return false;
  markMoodAsked();
  return true;
}

export function notifyMoodChanged(): void {
  window.dispatchEvent(new CustomEvent(MOOD_CHANGED_EVENT));
}

export async function logMood(
  chunkId: string | null,
  mood: Mood,
  eventType: EventType,
): Promise<void> {
  await moodFetch<{ id: number }>('/api/mood/log', {
    method: 'POST',
    body: JSON.stringify({ chunk_id: chunkId, mood, event_type: eventType }),
  });
}

export async function fetchMoodHistory(days = 30): Promise<MoodHistoryResponse> {
  return moodFetch<MoodHistoryResponse>(`/api/mood/history?days=${days}`);
}

export async function fetchMoodStats(days = 30): Promise<MoodStatsResponse> {
  return moodFetch<MoodStatsResponse>(`/api/mood/stats?days=${days}`);
}
