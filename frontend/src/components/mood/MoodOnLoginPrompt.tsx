import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MoodPrompt } from '@/components/mood/MoodPrompt';
import {
  isMoodAskEnabled,
  MOOD_CHANGED_EVENT,
  MOOD_LOGIN_PROMPT_PENDING_KEY,
} from '@/lib/mood';

/** Shown once after login/register — not on in-app navigation or page refresh. */
export function MoodOnLoginPrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(isMoodAskEnabled);

  useEffect(() => {
    if (!user || !isMoodAskEnabled()) return;
    if (sessionStorage.getItem(MOOD_LOGIN_PROMPT_PENDING_KEY) !== '1') return;
    sessionStorage.removeItem(MOOD_LOGIN_PROMPT_PENDING_KEY);
    setOpen(true);
  }, [user]);

  useEffect(() => {
    function sync() {
      const on = isMoodAskEnabled();
      setEnabled(on);
      if (!on) setOpen(false);
    }
    window.addEventListener(MOOD_CHANGED_EVENT, sync);
    return () => window.removeEventListener(MOOD_CHANGED_EVENT, sync);
  }, []);

  if (!open || !enabled) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 p-4 pt-20"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="app-card w-full max-w-lg p-4 shadow-[var(--shadow)]">
        <MoodPrompt
          chunkId={null}
          eventType="create"
          markAskedOnPick
          onComplete={() => setOpen(false)}
        />
      </div>
    </div>
  );
}
