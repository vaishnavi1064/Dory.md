import gsap from 'gsap';
import { REVIEW_HOOK } from '../components/reviewGeometry';
import { scrollSignals } from './signals';

/**
 * Bite 5, and the end of the story: the light gathering off the projection
 * timeline and closing onto the review card.
 *
 * One number, as the last two beats. What makes this one different lives with
 * the field: it is the only leg that contracts rather than spreads, and the
 * only one that takes something back — the decay tint the time machine applied
 * drains out across this span, so the memory brightens as it gathers.
 */

/**
 * Anchored to the card, which is also the thing the field is aiming at.
 *
 * Starting as the card clears the bottom edge and ending with it settled in the
 * upper-middle keeps the same span shape as the search and time machine legs,
 * so the four beats hold one pace across the page.
 *
 * SEQUENCED AROUND THE SECTION'S REVEAL, not synced to it. The card fades and
 * rises on `whileInView` at 25% visibility, well before the field arrives, and
 * the particles re-read its box every frame — so they track it while it moves
 * and settle only once it has stopped. Nothing here drives that reveal and
 * nothing waits on it.
 */
const START = 'top bottom';
const END = 'center 62%';

/** Matches every other beat, so the whole story shares one feel. */
const SCRUB = 0.5;

/**
 * Builds the gathering. Returns nothing — the caller owns teardown through the
 * gsap.matchMedia context this is created inside.
 */
export function buildReviewSeed() {
  const card = document.querySelector<HTMLElement>(`[${REVIEW_HOOK.card}]`);
  if (!card) return;

  const timeline = gsap.timeline({
    scrollTrigger: { trigger: card, start: START, end: END, scrub: SCRUB },
  });

  timeline.to(scrollSignals, { reviewSeed: 1, duration: 1, ease: 'none' }, 0);
}
