import gsap from 'gsap';
import { CTA_HOOK } from '../components/ctaGeometry';
import { scrollSignals } from './signals';

/**
 * Bite 6, and the end of it: the light leaving the review card and reforming
 * into the glow behind the closing call to action.
 *
 * The last beat, and the only one that does not hand the field on to anything.
 * Everything before it moved the light somewhere it would later be moved from
 * again; this one puts it down. What that costs in this file is nothing — it is
 * still one scrubbed number — but it is why the field's own constants for this
 * leg are the calmest of the six.
 */

/**
 * Anchored to the glow itself, which is also the landing.
 *
 * The CTA is a centred column and the glow sits on its middle, so one element
 * serves as both the span's measure and the field's target — no other beat gets
 * to be that tidy, because no other beat lands on something centred in its own
 * section.
 *
 * END is later than the other beats' 62%. The glow settles at the section's
 * centre rather than in the upper-middle, and stopping the span there means the
 * field comes to rest with the CTA composed on screen instead of still rising
 * into place — which matters more here than anywhere else, because this is the
 * frame the page ends on.
 */
const START = 'top bottom';
const END = 'center 54%';

/** Matches every other beat, so the whole story shares one feel. */
const SCRUB = 0.5;

/**
 * Builds the closing. Returns nothing — the caller owns teardown through the
 * gsap.matchMedia context this is created inside.
 */
export function buildCtaSeed() {
  const glow = document.querySelector<HTMLElement>(`[${CTA_HOOK.glow}]`);
  if (!glow) return;

  const timeline = gsap.timeline({
    scrollTrigger: { trigger: glow, start: START, end: END, scrub: SCRUB },
  });

  timeline.to(scrollSignals, { ctaSeed: 1, duration: 1, ease: 'none' }, 0);
}
