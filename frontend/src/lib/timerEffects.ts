// Sound + browser-notification helpers for timers and wellness reminders.
// No dependencies: the chime is synthesized with the Web Audio API, with an
// optional MP3 override per path (see playChime). Notifications use the
// native Notification API and degrade silently when unsupported/denied.

const FAVICON = '/favicon.svg';
const DEFAULT_CHIME_PATH = '/sounds/timer-end.mp3';
const NOTIF_ASKED_KEY = 'dory.timer.notif.asked';

let audioCtx: AudioContext | null = null;
const mp3Available = new Map<string, boolean>();

// Lazily create (and resume) the AudioContext. MUST be called from a user
// gesture (the Start click) — browsers block audio created on page load.
export function ensureAudio(): void {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume();
  } catch {
    // Audio unavailable — phase-end will simply be silent.
  }
}

function playTone(ctx: AudioContext, freq: number, startAt: number, duration: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);

  const peak = 0.18;
  const holdUntil = Math.max(startAt + 0.02, startAt + duration - 0.08);
  // Gain envelope: 20ms fade-in, hold, ~80ms fade-out — avoids clicks.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.02);
  gain.gain.setValueAtTime(peak, holdUntil);
  gain.gain.linearRampToValueAtTime(0.0001, startAt + duration);

  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

// Two overlapping sine tones a perfect fifth apart (880Hz then 1320Hz) — a
// gentle notification, not an alarm. ~400ms total.
function synthChime(): void {
  ensureAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  playTone(audioCtx, 880, now, 0.15);
  playTone(audioCtx, 1320, now + 0.15, 0.2);
}

async function hasMp3(path: string): Promise<boolean> {
  const cached = mp3Available.get(path);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(path, { method: 'HEAD' });
    mp3Available.set(path, res.ok);
  } catch {
    mp3Available.set(path, false);
  }
  return mp3Available.get(path)!;
}

// Prefer a real sound file when present; otherwise fall back to the synthesized chime.
export async function playChime(soundPath: string = DEFAULT_CHIME_PATH): Promise<void> {
  if (await hasMp3(soundPath)) {
    try {
      const audio = new Audio(soundPath);
      audio.volume = 0.5;
      await audio.play();
      return;
    } catch {
      // fall through to the synthesized chime
    }
  }
  synthChime();
}

// Request notification permission at most once, only from a user gesture.
// Never nags: if already asked or already decided, this is a no-op request.
export async function ensureNotifPermission(): Promise<void> {
  if (typeof Notification === 'undefined') return;
  const asked = localStorage.getItem(NOTIF_ASKED_KEY) === 'true';
  if (!asked && Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {
      // ignore — we proceed without notifications
    }
  }
  localStorage.setItem(NOTIF_ASKED_KEY, 'true');
}

export function notify(title: string, body: string, options?: { link?: string }): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon: FAVICON, requireInteraction: false });
      if (options?.link) {
        n.onclick = () => {
          window.open(options.link, '_blank');
          n.close();
        };
      }
    }
  } catch {
    // notifications unsupported — sound + visual still fire
  }
}
