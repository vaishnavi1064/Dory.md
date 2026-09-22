import { useEffect, useState } from 'react';

/**
 * The one width above which the landing page turns its enhancements on.
 *
 * There is a single number here on purpose. This started as three: the slab
 * gated at 768, the orb and the scroll engine at 1024 — and everything above
 * 1024 silently did nothing on perfectly ordinary desktops, because a viewport
 * is measured in CSS pixels, not hardware ones. A 1440px window at 150% browser
 * zoom reports 960. A 1366px laptop at Windows' 150% display scaling reports
 * 910. Both fall through every 1024 gate while looking, to the person sitting
 * in front of them, like an obviously-wide desktop.
 *
 * 768 is the breakpoint the hero already uses for its own layout, so a viewport
 * that gets the two-column hero gets the whole hero.
 */
export const ENHANCED_MIN_WIDTH_PX = 768;

/** The same threshold as a media query, for the non-React consumers
 *  (gsap.matchMedia in the scroll engine). */
export const ENHANCED_WIDTH_QUERY = `(min-width: ${ENHANCED_MIN_WIDTH_PX}px)`;

/**
 * Whether this viewport gets the enhanced hero — the spinnable slab, the orb,
 * and the scroll-linked motion. Re-evaluates on resize, so dragging a window
 * wider or zooming back out brings everything in rather than leaving the page
 * half-built until a reload.
 */
export function useEnhancedViewport(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(ENHANCED_WIDTH_QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(ENHANCED_WIDTH_QUERY);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    // A resize between first render and this effect would otherwise be missed.
    setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return wide;
}
