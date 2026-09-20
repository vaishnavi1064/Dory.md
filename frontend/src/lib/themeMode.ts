/** Site-wide light/dark theme.
 *
 *  The whole app is themed through CSS custom properties in styles.css; a
 *  `.dark` class on <html> swaps that token set. Nothing here knows about
 *  individual colors — it only decides which token set is active.
 *
 *  The same resolution rule is duplicated as an inline script in index.html so
 *  the class is on <html> before first paint (no white flash). Keep the two in
 *  sync: stored value wins, otherwise prefers-color-scheme.
 */

export type ThemeMode = 'light' | 'dark';

export const THEME_KEY = 'dory.theme.mode';
export const THEME_CHANGED_EVENT = 'dory.theme.changed';

function storedMode(): ThemeMode | null {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    // Private-mode / blocked storage — fall back to the OS preference.
    return null;
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** The mode that should be active right now: explicit choice, else the OS. */
export function resolveThemeMode(): ThemeMode {
  return storedMode() ?? (systemPrefersDark() ? 'dark' : 'light');
}

/** True once the user has picked a mode themselves — from then on we stop
 *  following the OS, so a system change doesn't override their choice. */
export function hasExplicitThemeMode(): boolean {
  return storedMode() !== null;
}

/** Reads the mode currently painted on <html>, which the index.html script
 *  sets before React mounts. Avoids a first-render flip. */
export function currentThemeMode(): ThemeMode {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function paint(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  // Themes the native UA surfaces (form controls, scrollbars) to match.
  root.style.colorScheme = mode;
}

/** Applies a mode and remembers it as the user's explicit choice. */
export function setThemeMode(mode: ThemeMode) {
  paint(mode);
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Non-persistent session is still themed correctly for this page.
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT));
}

export function toggleThemeMode(): ThemeMode {
  const next: ThemeMode = currentThemeMode() === 'dark' ? 'light' : 'dark';
  setThemeMode(next);
  return next;
}

/** Follows the OS preference until the user makes an explicit choice.
 *  Returns an unsubscribe function. */
export function watchSystemThemeMode(): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};

  const onChange = (e: MediaQueryListEvent) => {
    if (hasExplicitThemeMode()) return;
    paint(e.matches ? 'dark' : 'light');
    window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT));
  };

  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
