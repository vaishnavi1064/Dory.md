import gsap from 'gsap';
import { SEARCH_HOOK } from '../components/searchGeometry';
import { scrollSignals } from './signals';

/**
 * Bite 3: the light leaving the forgetting curve and reforming into the Smart
 * search card.
 *
 * The thinnest beat in the story, deliberately. Bite 2 had to drive a chart and
 * a field off one span because the line was being written by the arrivals;
 * nothing on the card is drawn by this, so all this file does is scrub one
 * number. Everything about where the particles go lives with the field, which
 * reads the card's own elements — see components/searchGeometry and
 * particles/anchors.
 *
 * Sequential with curveSeed rather than overlapping it. The two hero beats
 * overlap because the light leaving *is* the hero handing over; here the field
 * has one resting place at a time, and a particle that is still settling onto
 * the chart has no business also leaving it.
 */

/**
 * Anchored to the card, not to #features.
 *
 * The section is a four-card grid a thousand pixels tall and the card is one
 * cell of it, so a span measured on the section would have the field arriving
 * long before or long after the thing it is arriving at is worth looking at.
 * Starting as the card clears the bottom edge and ending with it settled in the
 * upper-middle gives roughly 480px of scroll at 1440x900 — close to the curve
 * beat's own span, so the two legs feel like one journey rather than two
 * animations at different speeds.
 *
 * WORTH EYES: the field is parked on the curve when this starts, and by then
 * the curve is well above the viewport — the Approach section sits between
 * them. So the first part of the flight happens off the top of the screen and
 * the light sweeps in from above. That is honest (the chart really is up there)
 * but it is a judgement call, and START is the dial for it.
 */
const START = 'top bottom';
const END = 'center 62%';

/** Matches the other two beats, so the whole story shares one feel. */
const SCRUB = 0.5;

/**
 * Builds the hand-off. Returns nothing — the caller owns teardown through the
 * gsap.matchMedia context this is created inside.
 */
export function buildSearchSeed() {
  const card = document.querySelector<HTMLElement>(`[${SEARCH_HOOK.card}]`);
  if (!card) return;

  const timeline = gsap.timeline({
    scrollTrigger: { trigger: card, start: START, end: END, scrub: SCRUB },
  });

  timeline.to(scrollSignals, { searchSeed: 1, duration: 1, ease: 'none' }, 0);
}
