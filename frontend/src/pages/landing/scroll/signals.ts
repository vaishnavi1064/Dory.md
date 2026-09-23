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

  /**
   * How far the hero's light has been carried down into the forgetting curve.
   *
   * 0 before any of it has left, 1 once the particles have come to rest along
   * the curve and the chart has finished drawing. Deliberately a separate span
   * from heroExit and overlapping it: the light starts leaving while the orb is
   * still fading, which is the point of the beat.
   */
  curveSeed: number;
}

const NEUTRAL: ScrollSignals = { heroExit: 0, curveSeed: 0 };

export const scrollSignals: ScrollSignals = { ...NEUTRAL };

/** Puts every signal back to rest. Called when the engine tears down, so a
 *  route change or a resize past the gate cannot leave the page mid-beat. */
export function resetScrollSignals() {
  Object.assign(scrollSignals, NEUTRAL);
  flushSignalChanges();
}

/* ── change notification ───────────────────────────────────────────────
   Readers poll these values inside a frame loop, which works right up until the
   loop is asleep — and both canvases sleep when their section is off screen. A
   sleeping loop cannot see a signal move, so it holds whatever pose it stopped
   on. This is how it gets told. */

const watchers = new Set<() => void>();

/** Subscribe to "something moved". Returns an unsubscribe. */
export function watchSignals(fn: () => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

let lastHeroExit = 0;
let lastCurveSeed = 0;

/**
 * Fires the watchers if any signal has moved since the last call, and does
 * nothing at all otherwise. The engine calls this once per frame, so it has to
 * stay allocation-free — hence the explicit comparison rather than anything
 * clever over the object.
 *
 * ADDING A SIGNAL: add it to the comparison below, or nothing will wake for it.
 */
export function flushSignalChanges() {
  if (
    scrollSignals.heroExit === lastHeroExit &&
    scrollSignals.curveSeed === lastCurveSeed
  ) {
    return;
  }
  lastHeroExit = scrollSignals.heroExit;
  lastCurveSeed = scrollSignals.curveSeed;
  for (const fn of watchers) fn();
}
