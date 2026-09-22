import { useEffect } from 'react';

/**
 * Mounts the landing page's scroll engine.
 *
 * Deliberately tiny and dependency-free: GSAP, ScrollTrigger and Lenis together
 * are a large chunk, and none of it is needed to render the page or to scroll
 * it. This waits for the first paint to be over, then pulls the engine in. If
 * the chunk never arrives the page keeps native scroll and every section still
 * renders — the engine only ever adds to a page that already works.
 */

/** Long enough to be clear of the hero's entrance, short enough that nobody
 *  has finished reading the headline yet. */
const ARM_DELAY_MS = 120;

export function useScrollEngine() {
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;

    const timer = window.setTimeout(() => {
      import('./scrollEngine')
        .then((engine) => {
          if (cancelled) return;
          dispose = engine.startScrollEngine();
        })
        .catch((err: unknown) => {
          // Native scroll is a perfectly good outcome, so this is a note, not
          // a failure.
          console.warn('[landing] scroll engine unavailable', err);
        });
    }, ARM_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      dispose?.();
    };
  }, []);
}
