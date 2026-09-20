import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  THEME_CHANGED_EVENT,
  currentThemeMode,
  toggleThemeMode,
  type ThemeMode,
} from '@/lib/themeMode';

/** Header control that flips the site between the light and dark token sets.
 *
 *  Seeds from the class already painted on <html> by the index.html script, so
 *  the first render matches what the user is looking at. Pressing it records an
 *  explicit choice, which from then on wins over the OS preference. */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(currentThemeMode);

  // App mounts the OS-preference watcher; it re-dispatches through the same
  // event, so this one listener covers both sources of change.
  useEffect(() => {
    const sync = () => setMode(currentThemeMode());
    window.addEventListener(THEME_CHANGED_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, sync);
  }, []);

  const isDark = mode === 'dark';
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      onClick={() => toggleThemeMode()}
      className="btn-ghost h-9 w-9 p-0"
      title={label}
      aria-label={label}
      aria-pressed={isDark}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
