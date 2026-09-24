import gsap from 'gsap';
import { TM_HOOK } from '../components/timeMachineGeometry';
import { scrollSignals } from './signals';

/**
 * Bite 4: the light leaving the search card and spreading out along the time
 * machine's projection timeline.
 *
 * Like the search beat, all this file does is scrub one number — nothing in the
 * section is drawn by it. Where the particles go, how many reach each horizon
 * and how far they cool on the way are all decisions about the *field*, so they
 * live with it: see components/timeMachineGeometry for the three readings taken
 * off the section's own retention and critical figures.
 */

/**
 * Anchored to the projections column rather than to #time-machine.
 *
 * The section is a two-column block with a pitch on the left, and its centre
 * sits well away from the rows the field is aiming at. Measuring on the column
 * that actually holds the landings gives roughly 475px of scroll at 1440x900 —
 * in line with the curve and search legs, so the whole story keeps one pace.
 *
 * SEQUENCED AROUND THE SECTION'S OWN REVEAL, not synced to it. The rows fade
 * and rise on `whileInView` at 25% visibility, which lands around a third of
 * the way into this span; the particles are still crossing then and only settle
 * at the end of it, so the rows have finished moving before anything comes to
 * rest on them. Nothing here drives that reveal and nothing waits on it — the
 * field re-reads the rows' boxes every frame, so it simply tracks them while
 * they move. Worth knowing if START is ever pulled earlier.
 */
const START = 'top bottom';
const END = 'center 62%';

/** Matches every other beat, so the whole story shares one feel. */
const SCRUB = 0.5;

/**
 * Builds the hand-off. Returns nothing — the caller owns teardown through the
 * gsap.matchMedia context this is created inside.
 */
export function buildTimeMachineSeed() {
  const column = document.querySelector<HTMLElement>(`[${TM_HOOK.column}]`);
  if (!column) return;

  const timeline = gsap.timeline({
    scrollTrigger: { trigger: column, start: START, end: END, scrub: SCRUB },
  });

  timeline.to(scrollSignals, { tmSeed: 1, duration: 1, ease: 'none' }, 0);
}
