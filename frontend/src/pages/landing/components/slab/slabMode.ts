import { useEffect, useState } from 'react';

/** Below this the hero column is too narrow for a spinnable slab, and the
 *  device is probably a phone. Phones keep the flat tilted mock. */
const MIN_WIDTH_PX = 1024;

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
