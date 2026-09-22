/**
 * Scroll-linked values: written by ScrollTrigger, read inside render loops.
 *
 * A plain mutable object on purpose. These change every frame while the user
 * scrolls, and the things that read them (the orb's WebGL frame loop today,
 * more later) are not React renders — routing this through state would
 * re-render the hero sixty times a second to move a number.
 *
 * The contract for later bites: every signal is a plain number that means
 * something on its own, rests at its neutral value, and is safe to read when
 * the scroll engine never started. Nothing that reads one should have to know
 * whether ScrollTrigger, Lenis or anything else exists.
 */
export interface ScrollSignals {
  /**
   * How far the hero has handed over to the Problem section.
   *
   * 0 while the hero owns the screen, 1 once it has scrolled away. Stays 0 on
   * narrow screens and under reduced motion, where the engine never runs, so
   * readers get the old static behaviour for free.
   */
  heroExit: number;
}

const NEUTRAL: ScrollSignals = { heroExit: 0 };

export const scrollSignals: ScrollSignals = { ...NEUTRAL };

/** Puts every signal back to rest. Called when the engine tears down, so a
 *  route change or a resize past the gate cannot leave the page mid-beat. */
export function resetScrollSignals() {
  Object.assign(scrollSignals, NEUTRAL);
}
