import gsap from 'gsap';
import { CURVE_HOOK } from '../components/curveGeometry';
import { PARTICLE_TRAVEL } from './choreography';
import { scrollSignals } from './signals';

/**
 * Bite 2: the hero's light leaving the orb and becoming the forgetting curve.
 *
 * One timeline drives both halves, which is the whole trick — the particles and
 * the chart are not two animations that happen to overlap, they are the same
 * scrubbed span read by two renderers. The particle field reads
 * scrollSignals.curveSeed; the SVG is animated here directly.
 *
 * The span deliberately overlaps heroExit's: the light starts leaving while the
 * orb is still fading, so it reads as the orb losing it rather than something
 * new arriving.
 */

/** Starts partway through the hero's own exit — see the overlap above. */
const START_TRIGGER = '#product';
const START = '45% top';
/** Ends when the chart is sitting comfortably in the upper-middle of the
 *  screen, which is where the eye already is by then. */
const END = 'center 62%';

/** Matches heroExit's scrub, so the two beats feel like one motion. Lenis is
 *  already smoothing the scroll; much more here and the two lags compound. */
const SCRUB = 0.5;

/* Every tween is given an explicit duration summing to 1, so the timeline's
   own length is one normalised span and a position here reads directly as
   "this fraction of the scroll range".

   The line is not decoration placed by eye: particles leave in curve order and
   land between PARTICLE_TRAVEL and 1, so drawing the line across exactly that
   window puts its leading edge where they are arriving. That is the difference
   between the chart being written by the particles and merely near them. */
const LINE_AT = PARTICLE_TRAVEL;
const LINE_FOR = 1 - PARTICLE_TRAVEL;
/* The wash follows the line in; the end dot is the last thing to settle. */
const AREA_AT = PARTICLE_TRAVEL + LINE_FOR * 0.35;
const AREA_FOR = 1 - AREA_AT;
const DOT_AT = 0.9;
const DOT_FOR = 1 - DOT_AT;

/**
 * Builds the hand-over. Returns nothing — the caller owns teardown through the
 * gsap.matchMedia context this is created inside, which reverts both the tween
 * values and every inline style written here.
 */
export function buildCurveSeed() {
  const hero = document.querySelector<HTMLElement>(START_TRIGGER);
  const svg = document.querySelector<SVGSVGElement>(`[${CURVE_HOOK.svg}]`);
  if (!hero || !svg) return;

  const timeline = gsap.timeline({
    scrollTrigger: {
      trigger: hero,
      start: START,
      endTrigger: svg,
      end: END,
      scrub: SCRUB,
    },
  });

  timeline.to(scrollSignals, { curveSeed: 1, duration: 1, ease: 'none' }, 0);

  // ── the chart, drawn by the same span ──────────────────────────────────────
  // Note the gsap.set() calls: the hidden state is established here rather than
  // in the component, so an engine that never loads leaves a finished chart on
  // screen instead of an invisible one.

  const line = svg.querySelector<SVGPathElement>(`[${CURVE_HOOK.line}]`);
  if (line) {
    const length = line.getTotalLength();
    gsap.set(line, { strokeDasharray: length, strokeDashoffset: length });
    timeline.to(line, { strokeDashoffset: 0, duration: LINE_FOR, ease: 'none' }, LINE_AT);
  }

  const area = svg.querySelector<SVGPathElement>(`[${CURVE_HOOK.area}]`);
  if (area) {
    gsap.set(area, { opacity: 0 });
    timeline.to(area, { opacity: 1, duration: AREA_FOR, ease: 'none' }, AREA_AT);
  }

  const dot = svg.querySelector<SVGCircleElement>(`[${CURVE_HOOK.dot}]`);
  if (dot) {
    gsap.set(dot, { opacity: 0, scale: 0, transformOrigin: 'center center' });
    timeline.to(dot, { opacity: 1, scale: 1, duration: DOT_FOR, ease: 'none' }, DOT_AT);
  }
}
