import { notify, playChime } from '@/lib/timerEffects';

// ─── localStorage keys ─────────────────────────────────────────────────────

export const WELLNESS_STRETCH_ENABLED = 'dory.wellness.stretch.enabled';
export const WELLNESS_STRETCH_INTERVAL = 'dory.wellness.stretch.interval';
export const WELLNESS_WATER_ENABLED = 'dory.wellness.water.enabled';
export const WELLNESS_WATER_INTERVAL = 'dory.wellness.water.interval';
export const WELLNESS_BREATHING_ENABLED = 'dory.wellness.breathing.enabled';
export const WELLNESS_BREATHING_INTERVAL = 'dory.wellness.breathing.interval';
export const WELLNESS_QUIET_ENABLED = 'dory.wellness.quietHours.enabled';
export const WELLNESS_QUIET_START = 'dory.wellness.quietHours.start';
export const WELLNESS_QUIET_END = 'dory.wellness.quietHours.end';

export const WELLNESS_CHANGED_EVENT = 'dory.wellness.changed';
export const WELLNESS_SOUND_PATH = '/sounds/wellness-ping.mp3';

export const WELLNESS_INTERVAL_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

export const WELLNESS_DEFAULTS = {
  stretch: { enabled: false, interval: 45 },
  water: { enabled: false, interval: 60 },
  breathing: { enabled: false, interval: 90 },
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

type ReminderKind = 'stretch' | 'water' | 'breathing';

interface ReminderDef {
  kind: ReminderKind;
  enabledKey: string;
  intervalKey: string;
  defaultInterval: number;
  title: string;
  body: string;
}

const REMINDERS: ReminderDef[] = [
  {
    kind: 'stretch',
    enabledKey: WELLNESS_STRETCH_ENABLED,
    intervalKey: WELLNESS_STRETCH_INTERVAL,
    defaultInterval: WELLNESS_DEFAULTS.stretch.interval,
    title: 'Time to stretch',
    body: 'Stand up and move for a moment',
  },
  {
    kind: 'water',
    enabledKey: WELLNESS_WATER_ENABLED,
    intervalKey: WELLNESS_WATER_INTERVAL,
    defaultInterval: WELLNESS_DEFAULTS.water.interval,
    title: 'Hydration check',
    body: 'Drink some water',
  },
  {
    kind: 'breathing',
    enabledKey: WELLNESS_BREATHING_ENABLED,
    intervalKey: WELLNESS_BREATHING_INTERVAL,
    defaultInterval: WELLNESS_DEFAULTS.breathing.interval,
    title: 'Take a breath',
    body: 'Pause for three slow breaths',
  },
];

const pendingTimeouts = new Map<ReminderKind, ReturnType<typeof setTimeout>>();

// ─── Storage helpers ─────────────────────────────────────────────────────────

function readBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === 'true';
}

function readInterval(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readTime(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

// ─── Quiet hours ─────────────────────────────────────────────────────────────

function parseTimeMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map((v) => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function isInQuietHours(now: Date, startStr: string, endStr: string): boolean {
  const start = parseTimeMinutes(startStr);
  const end = parseTimeMinutes(endStr);
  if (start === end) return true;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  if (start < end) return nowMins >= start && nowMins < end;
  return nowMins >= start || nowMins < end;
}

function shouldSuppressForQuietHours(): boolean {
  if (!readBool(WELLNESS_QUIET_ENABLED, WELLNESS_DEFAULTS.quietHours.enabled)) return false;
  const start = readTime(WELLNESS_QUIET_START, WELLNESS_DEFAULTS.quietHours.start);
  const end = readTime(WELLNESS_QUIET_END, WELLNESS_DEFAULTS.quietHours.end);
  return isInQuietHours(new Date(), start, end);
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

function clearReminderTimeout(kind: ReminderKind): void {
  const id = pendingTimeouts.get(kind);
  if (id !== undefined) {
    clearTimeout(id);
    pendingTimeouts.delete(kind);
  }
}

function scheduleReminder(def: ReminderDef): void {
  clearReminderTimeout(def.kind);

  if (!readBool(def.enabledKey, false)) return;

  const intervalMin = readInterval(def.intervalKey, def.defaultInterval);
  const delayMs = intervalMin * 60 * 1000;

  const id = setTimeout(() => fireReminder(def), delayMs);
  pendingTimeouts.set(def.kind, id);
}

function fireReminder(def: ReminderDef): void {
  pendingTimeouts.delete(def.kind);

  if (!readBool(def.enabledKey, false)) return;

  if (!shouldSuppressForQuietHours()) {
    notify(def.title, def.body);
    void playChime(WELLNESS_SOUND_PATH);
  }

  scheduleReminder(def);
}

function rescheduleAll(): void {
  for (const def of REMINDERS) scheduleReminder(def);
}

function handleWellnessChanged(): void {
  rescheduleAll();
}

export function notifyWellnessChanged(): void {
  window.dispatchEvent(new CustomEvent(WELLNESS_CHANGED_EVENT));
}

export function startWellnessScheduler(): void {
  stopWellnessScheduler();
  rescheduleAll();
  window.addEventListener(WELLNESS_CHANGED_EVENT, handleWellnessChanged);
}

export function stopWellnessScheduler(): void {
  window.removeEventListener(WELLNESS_CHANGED_EVENT, handleWellnessChanged);
  for (const def of REMINDERS) clearReminderTimeout(def.kind);
}

// ─── Settings read helpers (initial state hydration) ─────────────────────────

export function readStretchEnabled(): boolean {
  return readBool(WELLNESS_STRETCH_ENABLED, WELLNESS_DEFAULTS.stretch.enabled);
}

export function readStretchInterval(): number {
  return readInterval(WELLNESS_STRETCH_INTERVAL, WELLNESS_DEFAULTS.stretch.interval);
}

export function readWaterEnabled(): boolean {
  return readBool(WELLNESS_WATER_ENABLED, WELLNESS_DEFAULTS.water.enabled);
}

export function readWaterInterval(): number {
  return readInterval(WELLNESS_WATER_INTERVAL, WELLNESS_DEFAULTS.water.interval);
}

export function readBreathingEnabled(): boolean {
  return readBool(WELLNESS_BREATHING_ENABLED, WELLNESS_DEFAULTS.breathing.enabled);
}

export function readBreathingInterval(): number {
  return readInterval(WELLNESS_BREATHING_INTERVAL, WELLNESS_DEFAULTS.breathing.interval);
}

export function readQuietHoursEnabled(): boolean {
  return readBool(WELLNESS_QUIET_ENABLED, WELLNESS_DEFAULTS.quietHours.enabled);
}

export function readQuietHoursStart(): string {
  return readTime(WELLNESS_QUIET_START, WELLNESS_DEFAULTS.quietHours.start);
}

export function readQuietHoursEnd(): string {
  return readTime(WELLNESS_QUIET_END, WELLNESS_DEFAULTS.quietHours.end);
}
