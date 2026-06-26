import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  type EventType,
  type Mood,
  MOODS,
  MOOD_CHANGED_EVENT,
  isMoodAskEnabled,
  logMood,
  markMoodAsked,
} from '@/lib/mood';

interface MoodPromptProps {
  chunkId: string | null;
  eventType: EventType;
  onComplete?: () => void;
  className?: string;
  /** Manual header log: refresh cooldown when user picks a mood (not when shown). */
  markAskedOnPick?: boolean;
}

const AUTO_DISMISS_MS = 8000;

export function MoodPrompt({
  chunkId,
  eventType,
  onComplete,
  className,
  markAskedOnPick = false,
}: MoodPromptProps) {
  const [enabled, setEnabled] = useState(isMoodAskEnabled);
  const [selected, setSelected] = useState<Mood | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onChanged() { setEnabled(isMoodAskEnabled()); }
    window.addEventListener(MOOD_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(MOOD_CHANGED_EVENT, onChanged);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setTimeout(() => onComplete?.(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [enabled, onComplete]);

  if (!enabled) return null;

  async function pick(mood: Mood) {
    if (busy || selected) return;
    setBusy(true);
    setSelected(mood);
    try {
      await logMood(chunkId, mood, eventType);
      if (markAskedOnPick) markMoodAsked();
    } catch {
      // Optional prompt — never block the parent flow on log failure.
    } finally {
      window.setTimeout(() => onComplete?.(), 350);
    }
  }

  function skip() {
    onComplete?.();
  }

  return (
    <div className={cn('app-card-muted mt-3 p-4', className)}>
      <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
        <p className="text-sm font-bold text-[var(--text-2)]">
          How are you feeling? <span className="font-medium text-[var(--text-3)]">(optional)</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {MOODS.map(({ value, emoji, label }) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-label={label}
              disabled={busy}
              onClick={() => void pick(value)}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg text-xl transition',
                'hover:-translate-y-0.5 hover:bg-[var(--surface-2)]',
                selected === value && 'ring-2 ring-[var(--accent)] bg-[var(--accent-soft)]',
              )}
            >
              {selected === value ? '✓' : emoji}
            </button>
          ))}
          <button
            type="button"
            onClick={skip}
            className="ml-1 text-sm font-bold text-[var(--text-3)] hover:text-[var(--text-2)]"
          >
            skip
          </button>
        </div>
      </div>
    </div>
  );
}
