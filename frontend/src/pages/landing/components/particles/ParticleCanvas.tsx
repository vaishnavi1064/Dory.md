import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, NormalBlending, type BufferAttribute, type Points } from 'three';
import { THEME_CHANGED_EVENT } from '@/lib/themeMode';
import {
  CTA_TRAVEL,
  PARTICLE_TRAVEL as TRAVEL,
  REVIEW_TRAVEL,
  SEARCH_TRAVEL,
  TM_TRAVEL,
} from '../../scroll/choreography';
import { scrollSignals } from '../../scroll/signals';
import { sampleCurve } from '../curveGeometry';
import { SEARCH_HOOK, SEARCH_LANDINGS } from '../searchGeometry';
import { CTA_HOOK, CTA_LANDINGS } from '../ctaGeometry';
import { REVIEW_HOOK, REVIEW_LANDINGS } from '../reviewGeometry';
import { TM_HOOK, TM_LANDINGS } from '../timeMachineGeometry';
import { WakeOnSignals } from '../WakeOnSignals';
import { cssColorHex, DANGER_FALLBACK, LAVENDER_FALLBACK } from '../../webgl';
import {
  createAnchorFrame,
  createLandingFrame,
  readAnchors,
  readLandings,
  toScreenX,
  toScreenY,
} from './anchors';

/**
 * The light leaving the hero glow and coming to rest along the forgetting
 * curve.
 *
 * A fixed, full-viewport canvas with an orthographic camera at zoom 1, so one
 * world unit is one CSS pixel and the canvas box is the viewport. That is what
 * makes the hand-off real rather than suggestive: the particles' targets are
 * the curve's own sample points, run through the live bounding rect of the SVG
 * that draws it. See ./anchors.
 *
 * Five legs, one field of ninety, and a loop. curveSeed carries it from the
 * hero glow onto the forgetting curve; searchSeed carries the same particles
 * off the curve and onto the Smart search card; tmSeed carries them out along
 * the time machine's projection rows, thinning and cooling as they go;
 * reviewSeed gathers them back off those rows onto a single recall medallion,
 * brightening and losing the tint on the way; ctaSeed opens them out one last
 * time into the glow behind the closing call to action — the twin of the one
 * they left in the hero. Each leg starts from wherever the last one left each
 * particle, which is what makes the whole thing read as one body of light being
 * moved rather than as six effects crossfading.
 *
 * It reads those signals and nothing else — no ScrollTrigger, no Lenis, no
 * knowledge that a scroll engine exists. Whoever moves those numbers owns the
 * timing.
 */

/** Atmosphere, not a simulation. One draw call either way; this is about how
 *  busy it looks, and about the per-frame arithmetic staying trivial. */
const COUNT = 90;

/** How far the flight path bows away from the straight line, in pixels. */
const ARC = 150;

/** Point size range, in CSS pixels. */
const SIZE_MIN = 2.2;
const SIZE_MAX = 5.4;

/** Scatter around the resting point, in curve viewBox units — enough that they
 *  read as a drift of data rather than beads on a wire. */
const REST_SCATTER = 3.2;

/** Fraction of full brightness they keep once settled. They become the chart's
 *  texture at that point; the drawn line is the thing being read. */
const SETTLED_ALPHA = 0.45;

/* ── the second leg ────────────────────────────────────────────────────────
   Same field, same budget, different destination. */

/** How far the crossing to the card bows, in pixels. Wider than the curve
 *  leg's ARC: that flight was a spill outward from a point, this one is a long
 *  diagonal down the page and a straight line across it looks like a wipe. */
const SEARCH_ARC = 260;

/** Vertical scatter around a landing's centre line, in pixels. Small — these
 *  are rows and pills a couple of dozen pixels tall, and the light should sit
 *  in them rather than smear across the card. */
const SEARCH_SCATTER_Y = 9;

/** How much brightness they pick back up mid-crossing. They leave the curve
 *  dimmed, brighten while travelling, and settle dim again on the card: the
 *  light is being carried, not switched on. */
const SEARCH_LIFT = 0.9;

/* ── the third leg ─────────────────────────────────────────────────────────
   Out along the projection rows. The distances here are short — three rows
   stacked inside a 250px column — so this leg is about the arrival, not the
   journey. */

/** How far the crossing to a horizon bows, in pixels. Modest: the rows sit
 *  almost on top of each other, and a wide arc between them would read as the
 *  light overshooting rather than as it fanning out. */
const TM_ARC = 120;

/** Vertical scatter around a bar's centre line, in pixels. The bars are eight
 *  pixels tall, so this is deliberately tighter than the search card's. */
const TM_SCATTER_Y = 6;

/** Brightness picked back up mid-crossing, as SEARCH_LIFT. Lower, because
 *  where this leg ends up is dimmer than where it started and a big lift on the
 *  way would make the settling look like a failure rather than the point. */
const TM_LIFT = 0.55;

/* ── the fourth leg ────────────────────────────────────────────────────────
   Back in. This is the only leg that contracts the field, and the only one
   that takes something back rather than adding to it. */

/** How far the gathering bows, in pixels. Small, and smaller than any leg
 *  before it: a flight that curves on its way *in* reads as circling, and the
 *  whole point here is a straight pull toward one place. */
const REVIEW_ARC = 70;

/** How far past the medallion's own radius the gathered field spreads, in
 *  pixels. A little over, so the light reads as collecting *around* the recall
 *  figure rather than being clipped to a disc the same size as it. */
const REVIEW_SCATTER = 9;

/** Resting brightness once gathered, against SETTLED_ALPHA's 0.45 everywhere
 *  else. Brighter on purpose — this is the memory coming back, and it is the
 *  last thing the field does before the page closes. */
const REVIEW_ALPHA = 0.66;

/** Brightness picked back up mid-gather, as the other legs' lifts. */
const REVIEW_LIFT = 0.7;

/**
 * The tint reset: what fraction of a particle's travel the decay colour takes
 * to drain out of it.
 *
 * Below 1 on purpose. At 1 the red would still be leaving at the instant the
 * particle stopped, and the arrival — the part that has to read as recovered —
 * would be the one moment the colour was still wrong. At 0.6 it lands clean
 * with the last stretch of the flight already back to the brand colour.
 */
const REVIEW_TINT_RESET = 0.6;

/* ── the last leg ──────────────────────────────────────────────────────────
   Out of the medallion and into the CTA's glow, and then nothing. Every
   constant here is the calmest of its kind: this is the frame the page ends on
   and it should not be the busiest. */

/** How far the reform bows, in pixels. The smallest arc of the six — the field
 *  opens out rather than travelling, and a curve on the way would put movement
 *  into a beat whose whole job is to stop. */
const CTA_ARC = 45;

/** How much of the glow's own half-extent the settled field fills. Under 1 so
 *  the light sits inside the gradient rather than ringing its edge, which is
 *  what makes it read as the glow being *made* of the particles. */
const CTA_FILL = 0.72;

/** Resting brightness, and the brightest resting value in the story. The field
 *  has been dimmed on the curve, dimmed again on the horizons and only part
 *  recovered on the card; this is where it comes all the way back. */
const CTA_ALPHA = 0.72;

/** Brightness picked back up mid-reform. Barely any, unlike every leg before
 *  it: a flare here would read as one more event, and there is nothing after
 *  this to justify one. */
const CTA_LIFT = 0.2;

/**
 * The settle: one soft breath out and back in, over the last of the travel.
 *
 * Applied to where the particle *is*, not to where it is heading, which is the
 * whole reason it is visible. Scaling the target instead was the first attempt
 * and did nothing measurable — a quadratic bezier is only ~80% of the way to
 * its endpoint at 90% of its parameter, so moving the endpoint at that point
 * barely moves the particle.
 *
 * Shaped as a sine bump rather than a ramp, so it is zero at both ends of the
 * window: nothing jumps when it starts and the field lands exactly on the glow
 * rather than creeping in. Scrubbed like everything else — a function of
 * ctaSeed, not of time, so scrolling back up runs it backwards.
 */
const CTA_SETTLE_SPAN = 0.16;
const CTA_SETTLE_OVERSHOOT = 0.12;

/** Radians between successive points of a sunflower spiral — the one angle that
 *  never lines up with itself, so a disc filled by it has no visible spokes. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Deterministic noise, so a reload looks the same and nothing needs storing. */
function hash(i: number, salt: number) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const VERTEX = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  attribute float aCool;
  varying float vAlpha;
  varying float vCool;

  uniform float uDpr;

  void main() {
    vAlpha = aAlpha;
    vCool = aCool;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Orthographic at zoom 1, so size is simply pixels — times the device
    // ratio, since gl_PointSize is in framebuffer pixels.
    gl_PointSize = aSize * uDpr;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCool;
  varying float vAlpha;
  varying float vCool;

  void main() {
    // A soft round sprite, no texture: bright core, falls off to nothing at the
    // edge of the point so there is never a square.
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    float a = vAlpha * core * core;
    if (a < 0.002) discard;
    // Zero for every beat before the time machine, so the brand colour is what
    // ships until something deliberately cools it.
    gl_FragColor = vec4(mix(uColor, uCool, vCool), a);
  }
`;

function Field({
  color,
  cool,
  onDark,
}: {
  color: string;
  cool: string;
  onDark: boolean;
}) {
  const points = useRef<Points>(null);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  // Everything below is allocated once. The frame loop only writes into it.
  const state = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const alphas = new Float32Array(COUNT);
    const sizes = new Float32Array(COUNT);
    /** How far toward the critical colour each particle currently is. Written
     *  only while the time machine leg is running; zero every other frame. */
    const cool = new Float32Array(COUNT);
    // Per-particle constants: when it leaves, how it bows, where it lands.
    const delay = new Float32Array(COUNT);
    const bow = new Float32Array(COUNT);
    const sourceJitterX = new Float32Array(COUNT);
    const sourceJitterY = new Float32Array(COUNT);
    const restJitterX = new Float32Array(COUNT);
    const restJitterY = new Float32Array(COUNT);

    const targets = sampleCurve(COUNT);
    const targetX = new Float32Array(COUNT);
    const targetY = new Float32Array(COUNT);

    // Second leg: which landing each particle belongs to, where along it, and
    // how it gets there.
    const landing = new Uint8Array(COUNT);
    const landingAlong = new Float32Array(COUNT);
    const searchDelay = new Float32Array(COUNT);
    const searchBow = new Float32Array(COUNT);
    const searchJitterY = new Float32Array(COUNT);

    // Third leg: which horizon each particle reaches, and what it looks like
    // once it gets there. coolTarget and dim are copied per particle rather
    // than read off TM_LANDINGS in the loop — ninety object lookups a frame
    // buys nothing over two typed-array reads.
    const tmLanding = new Uint8Array(COUNT);
    const tmAlong = new Float32Array(COUNT);
    const tmDelay = new Float32Array(COUNT);
    const tmBow = new Float32Array(COUNT);
    const tmJitterY = new Float32Array(COUNT);
    const tmCoolTarget = new Float32Array(COUNT);
    const tmDim = new Float32Array(COUNT);

    // Fourth leg: where each particle sits on the card's outline, and how it
    // gets there. No landing index — there is only one landing.
    const reviewDiscX = new Float32Array(COUNT);
    const reviewDiscY = new Float32Array(COUNT);
    const reviewDelay = new Float32Array(COUNT);
    const reviewBow = new Float32Array(COUNT);

    // Last leg: a second place in the unit disc, and how each particle opens
    // out into it.
    const ctaDiscX = new Float32Array(COUNT);
    const ctaDiscY = new Float32Array(COUNT);
    const ctaDelay = new Float32Array(COUNT);
    const ctaBow = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i += 1) {
      // Leaving order follows the curve left to right, so the stream reads as
      // the line being written rather than as a cloud arriving at once.
      const along = i / (COUNT - 1);
      delay[i] = along * (1 - TRAVEL);

      sizes[i] = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * hash(i, 1);
      bow[i] = (hash(i, 2) - 0.35) * ARC;
      sourceJitterX[i] = (hash(i, 3) - 0.5) * 210;
      sourceJitterY[i] = (hash(i, 4) - 0.5) * 150;
      restJitterX[i] = (hash(i, 5) - 0.5) * REST_SCATTER;
      restJitterY[i] = (hash(i, 6) - 0.5) * REST_SCATTER;

      targetX[i] = targets[i].x;
      targetY[i] = targets[i].y;
    }

    /* Hand the field out to the landings, in the order they light up.
       Consecutive indices per landing, which matters: index order along the
       curve runs left to right, so each landing is fed by one contiguous stretch
       of the chart rather than by a shuffle. `decay` is last in the list, so the
       particles that end up on the decay-aware tag are the ones that were lying
       in the curve's flat tail — the part where retention has already gone. */
    let handed = 0;
    for (let b = 0; b < SEARCH_LANDINGS.length; b += 1) {
      const last = b === SEARCH_LANDINGS.length - 1;
      // The remainder goes to the last landing, so the shares always sum to
      // COUNT however the weights round.
      const n = last ? COUNT - handed : Math.round(SEARCH_LANDINGS[b].weight * COUNT);

      for (let j = 0; j < n; j += 1) {
        const i = handed + j;
        landing[i] = b;
        landingAlong[i] = n === 1 ? 0.5 : (j + 0.5) / n;

        // Landings fill in list order, and each one fills along its own width
        // rather than arriving all at once.
        const rank = (b + (j + 0.5) / n) / SEARCH_LANDINGS.length;
        searchDelay[i] = rank * (1 - SEARCH_TRAVEL);

        searchBow[i] = (hash(i, 7) - 0.5) * SEARCH_ARC;
        searchJitterY[i] = (hash(i, 8) - 0.5) * SEARCH_SCATTER_Y;
      }

      handed += n;
    }

    /* And again for the horizons. Same shape, different reason for the shares:
       the search card's weights were about box widths, these come straight off
       the section's retention figures, so fewer particles reach each further
       horizon than the one before. The field thins into the future because the
       data says it does — see components/timeMachineGeometry. */
    let reached = 0;
    for (let b = 0; b < TM_LANDINGS.length; b += 1) {
      const last = b === TM_LANDINGS.length - 1;
      const n = last ? COUNT - reached : Math.round(TM_LANDINGS[b].weight * COUNT);

      for (let j = 0; j < n; j += 1) {
        const i = reached + j;
        tmLanding[i] = b;
        tmAlong[i] = n === 1 ? 0.5 : (j + 0.5) / n;

        // Horizons fill nearest-first, and each bar fills along its own width.
        const rank = (b + (j + 0.5) / n) / TM_LANDINGS.length;
        tmDelay[i] = rank * (1 - TM_TRAVEL);

        tmBow[i] = (hash(i, 9) - 0.5) * TM_ARC;
        tmJitterY[i] = (hash(i, 10) - 0.5) * TM_SCATTER_Y;
        tmCoolTarget[i] = TM_LANDINGS[b].cool;
        tmDim[i] = TM_LANDINGS[b].dim;
      }

      reached += n;
    }

    /* And the gather. Every particle takes a place on the card's outline, even
       spacing all the way round, so the field closes into the card's shape
       rather than into a blob at its middle — the question underneath stays
       readable, and the card looks built out of what arrived.

       Departure order is deliberately the reverse of the horizons: the far,
       reddest particles set off first and have furthest to come, so the last
       thing to settle is the light that was nearly lost. */
    for (let i = 0; i < COUNT; i += 1) {
      /* A place in the unit disc, by sunflower spiral: sqrt() on the radius so
         the area fills evenly instead of bunching at the middle, and the golden
         angle between successive particles so no spokes form. Resolved to a
         unit vector here and scaled by the live radius in the loop, which keeps
         the only trig in the whole field out of the frame. */
      const t = (i + 0.5) / COUNT;
      const radius = Math.sqrt(t);
      const angle = i * GOLDEN_ANGLE;
      reviewDiscX[i] = Math.cos(angle) * radius;
      reviewDiscY[i] = Math.sin(angle) * radius;

      // Reverse of the horizons: the far, reddest particles have furthest to
      // come, so the last light to settle is the light that was nearly lost.
      reviewDelay[i] = (1 - i / (COUNT - 1)) * (1 - REVIEW_TRAVEL);
      reviewBow[i] = (hash(i, 11) - 0.5) * REVIEW_ARC;

      /* And a second place in the disc for the CTA glow, half a turn out of
         phase with the first. Reusing the review placement would have every
         particle move straight out along its own radius — the cluster would
         scale rather than reform, and the ending would read as a zoom. Out of
         phase, they cross on the way and arrive somewhere else. */
      const ctaAngle = angle + Math.PI;
      ctaDiscX[i] = Math.cos(ctaAngle) * radius;
      ctaDiscY[i] = Math.sin(ctaAngle) * radius;

      // Near enough together that the field settles as one thing. See
      // CTA_TRAVEL for why this beat wants no readable order.
      ctaDelay[i] = ((i + 0.5) / COUNT) * (1 - CTA_TRAVEL);
      ctaBow[i] = (hash(i, 13) - 0.5) * CTA_ARC;
    }

    return {
      positions,
      alphas,
      sizes,
      delay,
      bow,
      sourceJitterX,
      sourceJitterY,
      restJitterX,
      restJitterY,
      targetX,
      targetY,
      landing,
      landingAlong,
      searchDelay,
      searchBow,
      searchJitterY,
      cool,
      tmLanding,
      tmAlong,
      tmDelay,
      tmBow,
      tmJitterY,
      tmCoolTarget,
      tmDim,
      reviewDiscX,
      reviewDiscY,
      reviewDelay,
      reviewBow,
      ctaDiscX,
      ctaDiscY,
      ctaDelay,
      ctaBow,
      anchors: createAnchorFrame(),
      search: createLandingFrame(
        SEARCH_HOOK.landing,
        SEARCH_LANDINGS.map((l) => l.key),
      ),
      timeMachine: createLandingFrame(
        TM_HOOK.landing,
        TM_LANDINGS.map((l) => l.key),
      ),
      review: createLandingFrame(REVIEW_HOOK.gather, REVIEW_LANDINGS),
      cta: createLandingFrame(CTA_HOOK.glow, CTA_LANDINGS),
      /** Whether the field is currently wiped. Tracked rather than inferred
       *  from the buffer, so scrubbing back to the top always clears exactly
       *  once and never leaves a particle stranded on the curve. */
      cleared: false,
      /** Whether anything is currently tinted. Same reasoning: scrubbing back
       *  out of the time machine has to put the colour back exactly once,
       *  rather than uploading a buffer of zeroes on every other frame. */
      tinted: false,
    };
  }, []);

  // Only the colour can force a rebuild; uDpr is written by the frame loop, so
  // keeping it out of here means a device-ratio change never discards the
  // material mid-flight.
  const uniforms = useMemo(
    () => ({
      uColor: { value: new Color(color) },
      uCool: { value: new Color(cool) },
      uDpr: { value: 1 },
    }),
    [color, cool],
  );

  useFrame(() => {
    const mesh = points.current;
    if (!mesh) return;

    const seed = scrollSignals.curveSeed;
    const search = scrollSignals.searchSeed;
    const future = scrollSignals.tmSeed;
    const gather = scrollSignals.reviewSeed;
    const close = scrollSignals.ctaSeed;
    const s = state;
    uniforms.uDpr.value = dpr;

    // Scrubbed back to before the story: wipe the field once and stop. Skipping
    // the arithmetic also skips the layout reads, which is the point. Both
    // signals, because searchSeed can only be moving if curveSeed is already
    // home — but a reader that assumed that would break the day the spans are
    // retuned.
    if (seed <= 0 && search <= 0 && future <= 0 && gather <= 0 && close <= 0) {
      if (!s.cleared) {
        s.alphas.fill(0);
        (mesh.geometry.attributes.aAlpha as BufferAttribute).needsUpdate = true;
        s.cleared = true;
      }
      return;
    }
    s.cleared = false;

    const a = readAnchors(s.anchors);
    if (!a.ready) return;

    // Once per frame, not once per particle. Skipped entirely until the second
    // leg is actually running, so the ordinary curve frame costs exactly what
    // it did before this beat existed.
    const sa = search > 0 ? readLandings(s.search) : null;
    const toCard = sa !== null && sa.ready;

    const tf = future > 0 ? readLandings(s.timeMachine) : null;
    const toFuture = tf !== null && tf.ready;

    const rf = gather > 0 ? readLandings(s.review) : null;
    const toGather = rf !== null && rf.ready;
    // One box for the whole leg — there is only one landing — so the centre and
    // radius are worked out once a frame rather than ninety times.
    const medal = toGather ? rf.boxes[0] : null;
    const medalX = medal ? medal.x + medal.w / 2 : 0;
    const medalY = medal ? medal.y : 0;
    const medalR = medal ? Math.min(medal.w, medal.h) / 2 + REVIEW_SCATTER : 0;

    const cf = close > 0 ? readLandings(s.cta) : null;
    const toGlow = cf !== null && cf.ready;
    // The glow is an ellipse, not a circle, so the two half-extents are kept
    // apart — the settled field takes the shape of the light it is becoming.
    const glow = toGlow ? cf.boxes[0] : null;
    const glowX = glow ? glow.x + glow.w / 2 : 0;
    const glowY = glow ? glow.y : 0;
    const glowRX = glow ? (glow.w / 2) * CTA_FILL : 0;
    const glowRY = glow ? (glow.h / 2) * CTA_FILL : 0;

    const halfW = size.width / 2;
    const halfH = size.height / 2;

    for (let i = 0; i < COUNT; i += 1) {
      // This particle's own progress through its slice of the span.
      let t = (seed - s.delay[i]) / TRAVEL;
      t = t < 0 ? 0 : t > 1 ? 1 : t;

      const sx = a.source.x + s.sourceJitterX[i];
      const sy = a.source.y + s.sourceJitterY[i];
      const tx = toScreenX(a, s.targetX[i] + s.restJitterX[i]);
      const ty = toScreenY(a, s.targetY[i] + s.restJitterY[i]);

      // Quadratic bezier with the control point pushed sideways, so the light
      // spills outward and curves down instead of running in a straight line.
      const cx = (sx + tx) / 2 + s.bow[i];
      const cy = (sy + ty) / 2 - Math.abs(s.bow[i]) * 0.35;

      const inv = 1 - t;
      let px = inv * inv * sx + 2 * inv * t * cx + t * t * tx;
      let py = inv * inv * sy + 2 * inv * t * cy + t * t * ty;

      // Invisible at the source (the glow is behind the slab, and light should
      // not pop out in front of the card), full through the flight, dimmed once
      // it has become part of the chart.
      const fadeIn = t < 0.18 ? t / 0.18 : 1;
      const settle = t > 0.82 ? (t - 0.82) / 0.18 : 0;
      let alpha = fadeIn * (1 - (1 - SETTLED_ALPHA) * settle);

      /* ── the second leg ──────────────────────────────────────────────────
         Starts from wherever the first leg left this particle, which is what
         keeps the hand-off seamless: at searchSeed 0 the expression below is
         exactly the curve position, so there is no frame where the field jumps.
         And because the whole thing is a pure function of two scrubbed numbers,
         scrolling back up runs it in reverse for free. */
      if (toCard) {
        let u = (search - s.searchDelay[i]) / SEARCH_TRAVEL;
        u = u < 0 ? 0 : u > 1 ? 1 : u;

        if (u > 0) {
          const box = sa.boxes[s.landing[i]];
          const lx = box.x + box.w * s.landingAlong[i];
          const ly = box.y + s.searchJitterY[i];

          const b2 = s.searchBow[i];
          const c2x = (px + lx) / 2 + b2;
          const c2y = (py + ly) / 2 - Math.abs(b2) * 0.3;

          const iv = 1 - u;
          px = iv * iv * px + 2 * iv * u * c2x + u * u * lx;
          py = iv * iv * py + 2 * iv * u * c2y + u * u * ly;

          // Leaves dim, brightens across, settles dim again. sin() rather than
          // a triangle so the two ends meet the resting value smoothly, and at
          // u = 0 it is exactly SETTLED_ALPHA — the value the curve leg ends on.
          alpha =
            SETTLED_ALPHA + (1 - SETTLED_ALPHA) * Math.sin(Math.PI * u) * SEARCH_LIFT;
        }
      }

      /* ── the third leg ───────────────────────────────────────────────────
         Out to a horizon, and fading as it gets there. Same hand-off rule as
         above: at tmSeed 0 this is exactly the search position, so the legs
         meet without a seam.

         The fade is the point of this one. Where the other legs ended every
         particle at the same resting brightness, this one ends each at its own
         — dimmer and further toward the critical colour the further out its
         horizon sits, both read off the section's own figures. */
      let cool = 0;
      if (toFuture) {
        let v = (future - s.tmDelay[i]) / TM_TRAVEL;
        v = v < 0 ? 0 : v > 1 ? 1 : v;

        if (v > 0) {
          const box = tf.boxes[s.tmLanding[i]];
          const hx = box.x + box.w * s.tmAlong[i];
          const hy = box.y + s.tmJitterY[i];

          const b3 = s.tmBow[i];
          const c3x = (px + hx) / 2 + b3;
          const c3y = (py + hy) / 2 - Math.abs(b3) * 0.3;

          const iv = 1 - v;
          px = iv * iv * px + 2 * iv * v * c3x + v * v * hx;
          py = iv * iv * py + 2 * iv * v * c3y + v * v * hy;

          // The lift is the same shape as the search leg's, but scaled down by
          // how far this particle is going to fall: at v = 0 it is exactly
          // SETTLED_ALPHA, at v = 1 exactly SETTLED_ALPHA * its own dim.
          const lift =
            SETTLED_ALPHA + (1 - SETTLED_ALPHA) * Math.sin(Math.PI * v) * TM_LIFT;
          alpha = lift * (1 - (1 - s.tmDim[i]) * v);

          // Cools on the way rather than on arrival, so the colour is part of
          // the travel and not a swap at the end.
          cool = s.tmCoolTarget[i] * v;
        }
      }
      /* ── the fourth leg ──────────────────────────────────────────────────
         The gather. Same hand-off rule as the others: at reviewSeed 0 this is
         exactly where the time machine left the particle, in both position and
         colour, so the legs meet without a seam.

         Two things run backwards here. The field contracts instead of
         spreading, and the decay tint drains back out — REVIEW_TINT_RESET
         finishes the colour before the travel finishes, so the arrival is
         already clean. */
      if (toGather) {
        let r = (gather - s.reviewDelay[i]) / REVIEW_TRAVEL;
        r = r < 0 ? 0 : r > 1 ? 1 : r;

        if (r > 0) {
          const gx = medalX + s.reviewDiscX[i] * medalR;
          const gy = medalY + s.reviewDiscY[i] * medalR;

          const b4 = s.reviewBow[i];
          const c4x = (px + gx) / 2 + b4;
          const c4y = (py + gy) / 2 - Math.abs(b4) * 0.3;

          const iv = 1 - r;
          px = iv * iv * px + 2 * iv * r * c4x + r * r * gx;
          py = iv * iv * py + 2 * iv * r * c4y + r * r * gy;

          // Where the time machine left this one — its own dimmed resting
          // value, not the shared one — lifting to REVIEW_ALPHA as it closes.
          const from = SETTLED_ALPHA * s.tmDim[i];
          const lifted =
            from + (REVIEW_ALPHA - from) * r + (1 - SETTLED_ALPHA) * Math.sin(Math.PI * r) * REVIEW_LIFT;
          alpha = lifted > 1 ? 1 : lifted;

          // The tint reset. Drains from whatever the time machine put on, and
          // is gone before the particle arrives.
          const drain = r / REVIEW_TINT_RESET;
          cool = s.tmCoolTarget[i] * (drain >= 1 ? 0 : 1 - drain);
        }
      }
      /* ── the last leg ────────────────────────────────────────────────────
         The reform. Same hand-off rule one final time: at ctaSeed 0 this is
         exactly where the review leg left the particle, so the seam does not
         exist. The tint is already zero by here — the review leg drains it well
         before its own end — so nothing in this leg touches colour. It only
         opens the cluster out and brings the brightness the whole way back. */
      if (toGlow) {
        let c = (close - s.ctaDelay[i]) / CTA_TRAVEL;
        c = c < 0 ? 0 : c > 1 ? 1 : c;

        if (c > 0) {
          const gx = glowX + s.ctaDiscX[i] * glowRX;
          const gy = glowY + s.ctaDiscY[i] * glowRY;

          const b5 = s.ctaBow[i];
          const c5x = (px + gx) / 2 + b5;
          const c5y = (py + gy) / 2 - Math.abs(b5) * 0.3;

          const iv = 1 - c;
          px = iv * iv * px + 2 * iv * c * c5x + c * c * gx;
          py = iv * iv * py + 2 * iv * c * c5y + c * c * gy;

          // The settle, about the glow's own centre. See CTA_SETTLE_SPAN.
          const left = 1 - c;
          if (left < CTA_SETTLE_SPAN) {
            const over =
              1 +
              CTA_SETTLE_OVERSHOOT * Math.sin((Math.PI * left) / CTA_SETTLE_SPAN);
            px = glowX + (px - glowX) * over;
            py = glowY + (py - glowY) * over;
          }

          // From the medallion's resting value up to the brightest rest in the
          // story, with almost no flare on the way. See CTA_LIFT.
          const lifted =
            REVIEW_ALPHA +
            (CTA_ALPHA - REVIEW_ALPHA) * c +
            (1 - SETTLED_ALPHA) * Math.sin(Math.PI * c) * CTA_LIFT;
          alpha = lifted > 1 ? 1 : lifted;
        }
      }
      s.cool[i] = cool;

      const o = i * 3;
      // Viewport pixels → world units. The camera is centred, y points up.
      s.positions[o] = px - halfW;
      s.positions[o + 1] = halfH - py;
      s.positions[o + 2] = 0;
      s.alphas[i] = alpha;
    }

    (mesh.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    (mesh.geometry.attributes.aAlpha as BufferAttribute).needsUpdate = true;

    // The tint buffer only moves while the last leg is running. Uploading it
    // on every frame of the three beats that never touch it would be pure
    // churn, so it goes up while it is live and exactly once on the way out.
    if (toFuture || toGather) {
      (mesh.geometry.attributes.aCool as BufferAttribute).needsUpdate = true;
      s.tinted = true;
    } else if (s.tinted) {
      s.cool.fill(0);
      (mesh.geometry.attributes.aCool as BufferAttribute).needsUpdate = true;
      s.tinted = false;
    }
  });

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[state.positions, 3]} />
        <bufferAttribute attach="attributes-aAlpha" args={[state.alphas, 1]} />
        <bufferAttribute attach="attributes-aSize" args={[state.sizes, 1]} />
        <bufferAttribute attach="attributes-aCool" args={[state.cool, 1]} />
      </bufferGeometry>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
        depthTest={false}
        depthWrite={false}
        // Additive reads as light on the dark hero band, but vanishes against
        // the near-white card the curve sits on. Normal blending is the only
        // one that works at both ends of the journey in light mode.
        blending={onDark ? AdditiveBlending : NormalBlending}
      />
    </points>
  );
}

export function ParticleCanvas() {
  const root = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  // --lavender is stored as bare oklch components and has to be wrapped;
  // --danger is already a whole oklch() expression. Both tokens change with the
  // theme, so both are re-read below rather than resolved once.
  const readTheme = () => ({
    color: cssColorHex('oklch(var(--lavender))', LAVENDER_FALLBACK),
    cool: cssColorHex('var(--danger)', DANGER_FALLBACK),
    dark: document.documentElement.classList.contains('dark'),
  });

  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    const reread = () => setTheme(readTheme());
    window.addEventListener(THEME_CHANGED_EVENT, reread);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, reread);
  }, []);

  // The canvas is fixed, so it is never "out of view" on its own — the things
  // worth watching are the sections the beats happen in. A viewport of slack on
  // each side covers the whole flight and keeps a full-screen layer from
  // clearing itself sixty times a second at the bottom of the page.
  //
  // Every section a leg touches, not just the curve's: gating the loop on
  // #science alone left the later beats alive only by the accident of a 120%
  // margin being wider than the sections between them. Live while any of them
  // is near, which is what the field actually needs. WakeOnSignals
  // still covers the rest — this decides how smooth the beat is, not whether it
  // happens at all.
  useEffect(() => {
    const sections = ['#science', '#features', '#time-machine', '#review', '#start']
      .map((sel) => document.querySelector(sel))
      .filter((el): el is Element => el !== null);

    if (!sections.length || typeof IntersectionObserver === 'undefined') {
      setLive(true);
      return;
    }

    const near = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) near.add(entry.target);
          else near.delete(entry.target);
        }
        setLive(near.size > 0);
      },
      { rootMargin: '120% 0px' },
    );

    for (const section of sections) io.observe(section);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={root} className="landing-particle-layer" aria-hidden>
      <Canvas
        flat
        orthographic
        dpr={[1, 1.5]}
        // Fixed and full-viewport, so its box cannot change on scroll. R3F
        // re-measures on scroll by default; here that is pure churn.
        resize={{ scroll: false }}
        frameloop={live ? 'always' : 'demand'}
        gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}
        camera={{ zoom: 1, position: [0, 0, 100], near: 0.1, far: 1000 }}
      >
        <Field color={theme.color} cool={theme.cool} onDark={theme.dark} />
        <WakeOnSignals />
      </Canvas>
    </div>
  );
}
