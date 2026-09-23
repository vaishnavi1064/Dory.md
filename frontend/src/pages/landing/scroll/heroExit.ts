import gsap from 'gsap';
import { scrollSignals } from './signals';

/**
 * Bite 1 of the scroll story: the hero handing over to the Problem section.
 *
 * The beat is "memory beginning to decay": the dashboard drifts back and fades
 * as the Problem section takes over. Scrubbed, so it is a position on the page
 * rather than an animation that plays — scroll back up and it returns.
 *
 * It moves one wrapper element that nothing else writes to, and one number.
 * The element matters: the slab's rotor transform is rewritten every frame by
 * useSlabSpin, and its outer box belongs to Framer, so a second writer on
 * either would fight. The number (scrollSignals.heroExit) has no reader right
 * now — the WebGL orb that dimmed on it is gone — but it is the documented
 * measure of how far the hero has handed over, and the scroll-morph bite wants
 * exactly that.
 */

/**
 * The hand-over runs from the hero sitting flush at the top until 70% of it has
 * scrolled past — finishing while the card is still on screen, so the recede is
 * something you watch rather than something that completes out of sight.
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

  // How far the hero has handed over, for anything that wants to know. See the
  // note above: currently written but unread.
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
