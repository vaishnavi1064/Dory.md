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
  /** Centre of the hero glow, where the light comes from. */
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
  glow: Element | null;
}

export function createAnchorFrame(): AnchorFrame {
  return {
    source: { x: 0, y: 0 },
    scale: 0,
    originX: 0,
    originY: 0,
    ready: false,
    svg: null,
    glow: null,
  };
}

const live = (node: Element | null) => (node?.isConnected ? node : null);

/**
 * Re-reads both ends into `out`. Returns it for convenience; allocates nothing.
 *
 * The source is the hero's glow — the gradient behind the dashboard — with the
 * slab itself as a fallback. They share a centre, so the light comes from the
 * same place either way.
 */
export function readAnchors(out: AnchorFrame): AnchorFrame {
  const svg = (out.svg = live(out.svg) ?? document.querySelector(`[${CURVE_HOOK.svg}]`));
  const glow = (out.glow =
    live(out.glow) ??
    document.querySelector('.landing-slab-glow') ??
    document.querySelector('.landing-slab'));

  if (!svg || !glow) {
    out.ready = false;
    return out;
  }

  const curveRect = svg.getBoundingClientRect();
  const glowRect = glow.getBoundingClientRect();

  if (!curveRect.width || !glowRect.width) {
    out.ready = false;
    return out;
  }

  out.source.x = glowRect.left + glowRect.width / 2;
  out.source.y = glowRect.top + glowRect.height / 2;

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

/* ── Landings ─────────────────────────────────────────────────────────
   The curve gave the field one rect and a viewBox, and the maths did the rest.
   Every beat after it aims at laid-out boxes instead, so a landing is simply
   "somewhere along this element" — the search card's rows and tags, the time
   machine's retention bars, and whatever comes next.

   One frame type for all of them. They differ only in which attribute marks a
   landing and which keys to look for, so those are the two things a frame is
   built with; everything else is the same discipline as above — allocated once,
   filled in place, re-read every frame because the boxes move with the scroll. */

export interface LandingBox {
  /** Left edge and vertical centre of the landing, in viewport pixels. */
  x: number;
  y: number;
  /** Its width, so a particle can be placed along it by fraction. */
  w: number;
  /** And its height, for the beats that treat a landing as an area rather than
   *  a line. The rows and bars ignore this; the review card's outline does not. */
  h: number;
}

export interface LandingFrame {
  /** One box per key, in the same order. */
  boxes: LandingBox[];
  /** Cached nodes, re-found only when React has replaced them. */
  nodes: (Element | null)[];
  /** False when any landing is missing or unlaid-out — the field stays where
   *  it is rather than flying at a box that is not there. */
  ready: boolean;
  /** The attribute that marks a landing, and the values to look for. */
  attr: string;
  keys: readonly string[];
}

export function createLandingFrame(attr: string, keys: readonly string[]): LandingFrame {
  return {
    boxes: keys.map(() => ({ x: 0, y: 0, w: 0, h: 0 })),
    nodes: keys.map(() => null),
    ready: false,
    attr,
    keys,
  };
}

/** Re-reads every landing into `out`. Returns it for convenience; allocates
 *  nothing. All-or-nothing on purpose: a half-measured target would strand part
 *  of the field at the origin, which reads as a bug rather than as a beat. */
export function readLandings(out: LandingFrame): LandingFrame {
  for (let i = 0; i < out.keys.length; i += 1) {
    const node = (out.nodes[i] =
      live(out.nodes[i]) ?? document.querySelector(`[${out.attr}="${out.keys[i]}"]`));

    if (!node) {
      out.ready = false;
      return out;
    }

    const rect = node.getBoundingClientRect();
    if (!rect.width) {
      out.ready = false;
      return out;
    }

    const box = out.boxes[i];
    box.x = rect.left;
    box.y = rect.top + rect.height / 2;
    box.w = rect.width;
    box.h = rect.height;
  }

  out.ready = true;
  return out;
}
