import gsap from 'gsap';
import { scrollSignals } from './signals';

/**
 * Bite 1 of the scroll story: the hero handing over to the Problem section.
 *
 * The beat is "memory beginning to decay" — the orb's light fades and draws in
 * as the dashboard slides away. Everything here is scrubbed, so it is a
 * position on the page rather than an animation that plays: scroll back up and
 * the light comes back.
 *
 * Nothing in this file touches the orb or the slab directly. It moves one
 * number (scrollSignals.heroExit) that the orb's own frame loop reads, and one
 * wrapper element that nothing else writes to. That is deliberate — the slab's
 * rotor transform is rewritten every frame by useSlabSpin, and a second writer
 * would fight it.
 */

/**
 * The hand-over runs from the hero sitting flush at the top until 70% of it has
 * scrolled past. Ending before the hero is fully gone matters: the orb's frame
 * loop stops once it leaves the viewport, so anything still animating past that
 * point would simply freeze mid-fade.
 */
const START = 'top top';
const END = '70% top';

/**
 * Lenis is already smoothing the scroll position, so this only needs a little
 * on top. Much more and the two lags compound into mush.
 */
const SCRUB = 0.5;

/** How far the slab drifts and shrinks on its way out. Small — it should read
 *  as the card receding, not as a separate animation. */
const SLAB_DRIFT_PX = 26;
const SLAB_SCALE = 0.94;
const SLAB_FADE = 0.45;

/**
 * Builds the hero's exit timeline. Returns nothing: the caller owns teardown
 * through the gsap.matchMedia context this is created inside, which reverts
 * both the tween values and the inline styles it wrote.
 */
export function buildHeroExit() {
  const hero = document.querySelector<HTMLElement>('#product');
  if (!hero) return;

  const timeline = gsap.timeline({
    scrollTrigger: { trigger: hero, start: START, end: END, scrub: SCRUB },
  });

  // The orb's light failing. The orb reads this every frame and turns it into
  // emissive intensity and scale; see EXIT_DIM / EXIT_CONTRACT in OrbCanvas.
  timeline.to(scrollSignals, { heroExit: 1, ease: 'none' }, 0);

  // The slab receding. Applied to the scene wrapper rather than the slab
  // itself: the slab is a Framer Motion element that owns its own transform,
  // and the rotor inside it is rewritten every frame by the spin loop.
  const scene = hero.querySelector<HTMLElement>('.landing-slab-scene');
  if (scene) {
    timeline.to(
      scene,
      {
        y: SLAB_DRIFT_PX,
        scale: SLAB_SCALE,
        opacity: SLAB_FADE,
        ease: 'none',
      },
      0,
    );
  }
}
