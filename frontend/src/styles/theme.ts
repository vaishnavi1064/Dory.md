// Retention thresholds MUST mirror the backend's single source of truth
// (intelligence/memory/ebbinghaus.py: STRONG=0.8, FADING=0.5, WEAK=0.2). Keeping
// these in sync avoids the dashboard re-bucketing chunks differently from the
// server (UI_REVIEW D-1).
export const STRONG_THRESHOLD = 0.8;
export const FADING_THRESHOLD = 0.5;
export const WEAK_THRESHOLD = 0.2;

// Retention/data-viz colors resolve through the semantic tokens in styles.css
// rather than repeating their oklch values, so they lift with the dark token
// set instead of staying at light-theme lightness. var() is valid everywhere
// these land: inline styles, SVG fill/stroke, and recharts props.
export function retentionToColor(retention: number): string {
  if (retention >= STRONG_THRESHOLD) return 'var(--good)';
  if (retention >= FADING_THRESHOLD) return 'var(--warn)';
  if (retention >= WEAK_THRESHOLD) return 'var(--weak)';
  return 'var(--danger)';
}

export function retentionToGlow(retention: number): string {
  return `color-mix(in oklab, ${retentionToColor(retention)} 20%, transparent)`;
}

/** Translucent fill/border derived from a solid token — `${color}44` string
 *  concatenation does not work on a var() (or on oklch()), so callers that want
 *  a tint of a category/retention color go through this. */
export function tint(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}

export function retentionToLabel(retention: number): string {
  if (retention >= STRONG_THRESHOLD) return 'Strong';
  if (retention >= FADING_THRESHOLD) return 'Fading';
  if (retention >= WEAK_THRESHOLD) return 'Weak';
  return 'Critical';
}

// Keys are lowercased category names. Covers the backend taxonomy
// (intelligence/llm/categorization.py CATEGORIES) plus legacy frontend labels.
// `general` is the fallback used when a category isn't listed. Each entry reuses
// an existing semantic token where the hue already matches; the four --cat-*
// tokens cover the hues the app had no token for.
export const categoryColors: Record<string, string> = {
  'computer science': 'var(--info)',
  'ai/ml': 'var(--violet)',
  'system design': 'var(--cat-cyan)',
  mathematics: 'var(--cat-pink)',
  design: 'var(--warn)',
  productivity: 'var(--good)',
  research: 'var(--info)',
  personal: 'var(--cat-teal)',
  other: 'var(--cat-neutral)',
  // legacy / fallback keys
  technical: 'var(--info)',
  reference: 'var(--warn)',
  general: 'var(--violet)',
};
