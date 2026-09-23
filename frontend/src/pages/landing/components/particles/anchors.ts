import { CURVE_HOOK, VIEWBOX } from '../curveGeometry';

/**
 * Where the light leaves from, and where it lands — both in viewport pixels.
 *
 * This is the whole reason the particles line up with a chart they know nothing
 * about. The canvas is a fixed, full-viewport layer drawn with an orthographic
 * camera at zoom 1, so one world unit is one CSS pixel and the canvas box *is*
 * the viewport. That makes `getBoundingClientRect()` and the scene share a
 * coordinate space, and the hand-off becomes arithmetic rather than guesswork.
 *
 * Both rects move as the page scrolls, so they are re-read every frame. Cheap,
 * because nothing in the frame loop writes to the DOM — the layout stays clean
 * between reads, and a rect read off clean layout does not force a reflow.
 */

export interface Anchor {
  x: number;
  y: number;
}

/** Filled in place every frame. Module-level so the loop allocates nothing. */
export interface AnchorFrame {
  /** Centre of the orb, where the light comes from. */
  source: Anchor;
  /** Maps a point in the curve's viewBox onto the screen. */
  scale: number;
  originX: number;
  originY: number;
  /** False when either end is missing — the field renders nothing. */
  ready: boolean;
  /** Cached nodes. Re-found only when React has replaced them, so the common
   *  frame costs two rect reads and no selector matching. */
  svg: Element | null;
  orb: Element | null;
}

export function createAnchorFrame(): AnchorFrame {
  return {
    source: { x: 0, y: 0 },
    scale: 0,
    originX: 0,
    originY: 0,
    ready: false,
    svg: null,
    orb: null,
  };
}

const live = (node: Element | null) => (node?.isConnected ? node : null);

/**
 * Re-reads both ends into `out`. Returns it for convenience; allocates nothing.
 *
 * The source prefers the orb's own layer and falls back to the slab, so the
 * light still comes from the right place on a machine where the orb never
 * mounted.
 */
export function readAnchors(out: AnchorFrame): AnchorFrame {
  const svg = (out.svg = live(out.svg) ?? document.querySelector(`[${CURVE_HOOK.svg}]`));
  const orb = (out.orb =
    live(out.orb) ??
    document.querySelector('.landing-orb-layer') ??
    document.querySelector('.landing-slab'));

  if (!svg || !orb) {
    out.ready = false;
    return out;
  }

  const curveRect = svg.getBoundingClientRect();
  const orbRect = orb.getBoundingClientRect();

  if (!curveRect.width || !orbRect.width) {
    out.ready = false;
    return out;
  }

  out.source.x = orbRect.left + orbRect.width / 2;
  out.source.y = orbRect.top + orbRect.height / 2;

  // The SVG keeps its aspect (viewBox + h-auto w-full, default
  // preserveAspectRatio), so one scalar maps both axes.
  out.scale = curveRect.width / VIEWBOX.width;
  out.originX = curveRect.left;
  out.originY = curveRect.top;
  out.ready = true;
  return out;
}

/** A point in curve viewBox units → viewport pixels. */
export function toScreenX(frame: AnchorFrame, viewBoxX: number) {
  return frame.originX + viewBoxX * frame.scale;
}

export function toScreenY(frame: AnchorFrame, viewBoxY: number) {
  return frame.originY + viewBoxY * frame.scale;
}
