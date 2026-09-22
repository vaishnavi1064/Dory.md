import { useEffect, useState } from 'react';

/**
 * Below this the card is too narrow to turn and the device is almost certainly
 * a phone, so it keeps the flat tilted mock.
 *
 * This was 1024, which turned out to be far too greedy: a viewport is CSS
 * pixels, not hardware ones, so a 1440px window at 150% browser zoom reports
 * 960 — and a 1366px laptop at Windows' 150% display scaling reports 910.
 * Plenty of ordinary desktops fell through to the flat mock. md (768) is the
 * breakpoint the hero already uses for the secondary chips, and the slab has
 * room from there up.
 */
const MIN_WIDTH_PX = 768;

export type SlabMode = 'flat' | 'slab';

/**
 * Whether this visit gets the spinnable slab or the Tier-1 flat mock.
 *
 * Re-evaluates on resize, so rotating a tablet or dragging a window wider
 * swaps modes rather than leaving a slab squeezed into a phone column.
 */
export function useSlabMode(): SlabMode {
  const query = `(min-width: ${MIN_WIDTH_PX}px)`;
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    // A resize between first render and this effect would otherwise be missed.
    setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return wide ? 'slab' : 'flat';
}
