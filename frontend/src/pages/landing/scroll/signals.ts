/**
 * Scroll-linked values: written by ScrollTrigger, read inside render loops.
 *
 * A plain mutable object on purpose. These change every frame while the user
 * scrolls, and the things that read them (the particle field today, more
 * later) are not React renders — routing this through state would re-render
 * the hero sixty times a second to move a number.
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
   *
   * The hero's glow dims and draws in across this span. That used to be a
   * shader reading this number every frame; it is a scrubbed tween on the
   * gradient now, written beside the signal in heroExit.ts.
   */
  heroExit: number;

  /**
   * How far the hero's light has been carried down into the forgetting curve.
   *
   * 0 before any of it has left, 1 once the particles have come to rest along
   * the curve and the chart has finished drawing. Deliberately a separate span
   * from heroExit and overlapping it: the light starts leaving while the hero
   * is still on screen, which is the point of the beat.
   */
  curveSeed: number;

  /**
   * How far the light has left the curve again and reformed into the Smart
   * search card.
   *
   * 0 while it is still lying along the curve, 1 once every particle has come
   * to rest on one of the card's landings. Sequential with curveSeed rather
   * than overlapping it, unlike the hero pair: the field has one resting place
   * at a time, and a particle cannot be settling onto the chart and leaving it
   * in the same frame.
   */
  searchSeed: number;

  /**
   * How far the light has left the search card and spread out along the time
   * machine's projection timeline.
   *
   * 0 while it is still resting on the card, 1 once every particle that makes
   * it to a horizon has arrived. Sequential with searchSeed for the same reason
   * that one is sequential with curveSeed: one resting place at a time.
   *
   * Not every particle ends up somewhere. The field thins out toward the far
   * horizons because the section's own retention figures say it should — see
   * components/timeMachineGeometry.
   */
  tmSeed: number;

  /**
   * How far the light has gathered back off the projection timeline and onto
   * the review card.
   *
   * 0 while it is still spread across the three horizons, 1 once it has closed
   * onto the card. The only beat that contracts the field rather than spreading
   * it, and the only one that undoes something: the decay tint the time machine
   * put on drains back out across this span.
   */
  reviewSeed: number;

  /**
   * How far the light has left the review card and reformed into the glow
   * behind the closing call to action.
   *
   * 0 while it is still gathered on the recall medallion, 1 once it has settled
   * into an even, resting cluster. The last signal in the story, and the only
   * one with nothing after it: where the others hand the field on, this one
   * puts it down.
   */
  ctaSeed: number;
}

const NEUTRAL: ScrollSignals = {
  heroExit: 0,
  curveSeed: 0,
  searchSeed: 0,
  tmSeed: 0,
  reviewSeed: 0,
  ctaSeed: 0,
};

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
let lastSearchSeed = 0;
let lastTmSeed = 0;
let lastReviewSeed = 0;
let lastCtaSeed = 0;

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
    scrollSignals.curveSeed === lastCurveSeed &&
    scrollSignals.searchSeed === lastSearchSeed &&
    scrollSignals.tmSeed === lastTmSeed &&
    scrollSignals.reviewSeed === lastReviewSeed &&
    scrollSignals.ctaSeed === lastCtaSeed
  ) {
    return;
  }
  lastHeroExit = scrollSignals.heroExit;
  lastCurveSeed = scrollSignals.curveSeed;
  lastSearchSeed = scrollSignals.searchSeed;
  lastTmSeed = scrollSignals.tmSeed;
  lastReviewSeed = scrollSignals.reviewSeed;
  lastCtaSeed = scrollSignals.ctaSeed;
  for (const fn of watchers) fn();
}
