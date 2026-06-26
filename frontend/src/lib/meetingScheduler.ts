import {
  fetchMeetings,
  getReminderMinutes,
  MEETINGS_CHANGED_EVENT,
  MEETING_SOUND_PATH,
  type Meeting,
} from '@/lib/meetings';
import { notify, playChime } from '@/lib/timerEffects';

const FIRED_KEY_PREFIX = 'dory.meeting.fired.';
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const REFETCH_INTERVAL_MS = 60 * 60 * 1000;
const CHECK_DELAY_MS = 24 * 60 * 60 * 1000;

const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
let refetchIntervalId: ReturnType<typeof setInterval> | null = null;
let meetingsCache: Meeting[] = [];

function firedKey(meetingId: string): string {
  return `${FIRED_KEY_PREFIX}${meetingId}`;
}

function isAlreadyFired(meetingId: string): boolean {
  return localStorage.getItem(firedKey(meetingId)) === 'true';
}

function markFired(meetingId: string): void {
  localStorage.setItem(firedKey(meetingId), 'true');
}

function clearMeetingTimeout(meetingId: string): void {
  const id = pendingTimeouts.get(meetingId);
  if (id !== undefined) {
    clearTimeout(id);
    pendingTimeouts.delete(meetingId);
  }
}

function clearAllTimeouts(): void {
  for (const id of pendingTimeouts.keys()) clearMeetingTimeout(id);
}

function minutesUntilStart(meeting: Meeting): number {
  const startMs = new Date(meeting.starts_at).getTime();
  return Math.max(0, Math.round((startMs - Date.now()) / 60_000));
}

function fireReminder(meeting: Meeting, immediate = false): void {
  if (isAlreadyFired(meeting.id)) return;
  markFired(meeting.id);

  const minsLeft = minutesUntilStart(meeting);
  const body = immediate || minsLeft <= 0
    ? 'Starting now'
    : `In ${minsLeft} minute${minsLeft === 1 ? '' : 's'}`;

  notify(`${meeting.title} starts soon`, body, meeting.link ? { link: meeting.link } : undefined);
  void playChime(MEETING_SOUND_PATH);
}

function scheduleMeeting(meeting: Meeting): void {
  clearMeetingTimeout(meeting.id);

  const reminderMin = getReminderMinutes();
  const startMs = new Date(meeting.starts_at).getTime();
  const reminderMs = startMs - reminderMin * 60_000;
  const now = Date.now();
  const delay = reminderMs - now;

  if (delay <= 0) {
    if (!isAlreadyFired(meeting.id)) fireReminder(meeting, true);
    return;
  }

  const run = () => {
    pendingTimeouts.delete(meeting.id);
    if (!isAlreadyFired(meeting.id)) fireReminder(meeting);
  };

  if (delay > MAX_TIMEOUT_MS) {
    const id = setTimeout(() => scheduleMeeting(meeting), Math.min(delay, CHECK_DELAY_MS));
    pendingTimeouts.set(meeting.id, id);
    return;
  }

  const id = setTimeout(run, delay);
  pendingTimeouts.set(meeting.id, id);
}

function rescheduleAll(): void {
  clearAllTimeouts();
  for (const meeting of meetingsCache) scheduleMeeting(meeting);
}

async function loadAndSchedule(): Promise<void> {
  try {
    const from = new Date(Date.now() - 60 * 60_000);
    const to = new Date(Date.now() + 90 * 24 * 60 * 60_000);
    meetingsCache = await fetchMeetings(from, to);
    rescheduleAll();
  } catch {
    // Silent — scheduler retries on the next hourly cycle.
  }
}

function handleMeetingsChanged(): void {
  void loadAndSchedule();
}

export function startMeetingScheduler(): void {
  stopMeetingScheduler();
  void loadAndSchedule();
  refetchIntervalId = setInterval(() => void loadAndSchedule(), REFETCH_INTERVAL_MS);
  window.addEventListener(MEETINGS_CHANGED_EVENT, handleMeetingsChanged);
}

export function stopMeetingScheduler(): void {
  window.removeEventListener(MEETINGS_CHANGED_EVENT, handleMeetingsChanged);
  if (refetchIntervalId !== null) {
    clearInterval(refetchIntervalId);
    refetchIntervalId = null;
  }
  clearAllTimeouts();
  meetingsCache = [];
}
