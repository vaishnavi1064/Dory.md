import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { ENHANCED_WIDTH_QUERY } from '../viewport';
import { buildHeroExit } from './heroExit';
import { resetScrollSignals } from './signals';

/**
 * The landing page's scroll engine: Lenis for the feel of the scroll, GSAP
 * ScrollTrigger for everything tied to its position, and the page's timelines
 * built on top.
 *
 * Lazy-loaded (see useScrollEngine) — none of this is in the initial bundle,
 * and the page scrolls perfectly well before it arrives or if it never does.
 *
 * ADDING A LATER BITE: write a `buildX()` in its own module beside heroExit.ts
 * and call it below. It will inherit the media gate, the shared clock and the
 * teardown for free, and should move scrollSignals or its own elements rather
 * than reaching into a component.
 */

gsap.registerPlugin(ScrollTrigger);

/**
 * Smooth scrolling and scroll-linked motion are both wide-and-willing only.
 * Narrower than the shared gate the layout is a single column with nothing to
 * reveal, and a reduced-motion request means the page should behave like any
 * other page: native scroll, sections simply present.
 *
 * The width half comes from ../viewport rather than a number typed here. That
 * is not tidiness — this file used to carry its own 1024, which disagreed with
 * the slab's 768, and the whole engine quietly declined to start on any desktop
 * between the two.
 */
const CALM = '(prefers-reduced-motion: reduce)';
const ACTIVE = `${ENHANCED_WIDTH_QUERY} and (prefers-reduced-motion: no-preference)`;

/** Roughly one wheel notch of easing. Long enough to feel smooth, short enough
 *  that the page still feels attached to the wheel. */
const LENIS_DURATION = 1.05;

/**
 * Starts the engine. Returns a teardown that puts the page back exactly as it
 * was: native scroll, no triggers, every signal at rest.
 */
export function startScrollEngine(): () => void {
  // Say out loud whether the engine is running and, if not, which gate turned
  // it away. Every failure here is otherwise completely silent — the page just
  // scrolls, which is also exactly what success looks like from the outside.
  // One look at <html data-scroll-engine> in devtools settles it.
  const root = document.documentElement;
  const wide = window.matchMedia(ENHANCED_WIDTH_QUERY);
  const calm = window.matchMedia(CALM);
  const stamp = () => {
    root.dataset.scrollEngine = calm.matches
      ? 'off:reduced-motion'
      : wide.matches
        ? 'on'
        : 'off:narrow';
  };
  stamp();
  wide.addEventListener('change', stamp);
  calm.addEventListener('change', stamp);

  const mm = gsap.matchMedia();

  mm.add(ACTIVE, () => {
    let disposed = false;

    const lenis = new Lenis({
      duration: LENIS_DURATION,
      smoothWheel: true,
      // Touch stays native. Smoothing a finger drag fights the platform's own
      // physics and is the single fastest way to make a phone feel wrong.
      syncTouch: false,
      // Let Lenis own same-page hash links, so the nav's anchors still land.
      anchors: true,
      // GSAP's ticker drives it instead — see below.
      autoRaf: false,
    });

    const onScroll = () => ScrollTrigger.update();
    lenis.on('scroll', onScroll);

    // One clock for both. Driving Lenis from GSAP's ticker means a single rAF
    // loop for the whole page, and makes it impossible for scroll position and
    // the tweens reading it to be a frame apart. lagSmoothing off, because
    // GSAP's catch-up would desynchronise them after a dropped frame.
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    // ── the page's timelines ────────────────────────────────────────────────
    buildHeroExit();

    // Web fonts land after first paint and change how tall sections are, which
    // moves every trigger's start and end. Measure again once they are in.
    let refresh = 0;
    void document.fonts?.ready.then(() => {
      if (disposed) return;
      refresh = window.setTimeout(() => ScrollTrigger.refresh(), 0);
    });

    return () => {
      disposed = true;
      if (refresh) window.clearTimeout(refresh);
      gsap.ticker.remove(tick);
      // Back to GSAP's documented default.
      gsap.ticker.lagSmoothing(500, 33);
      lenis.off('scroll', onScroll);
      lenis.destroy();
      resetScrollSignals();
    };
  });

  return () => {
    wide.removeEventListener('change', stamp);
    calm.removeEventListener('change', stamp);
    delete root.dataset.scrollEngine;
    // Reverts the tweens, the inline styles they wrote, and the media context's
    // own cleanup above.
    mm.revert();
    resetScrollSignals();
  };
}
