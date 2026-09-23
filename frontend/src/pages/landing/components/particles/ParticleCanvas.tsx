import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, NormalBlending, type BufferAttribute, type Points } from 'three';
import { THEME_CHANGED_EVENT } from '@/lib/themeMode';
import { PARTICLE_TRAVEL as TRAVEL } from '../../scroll/choreography';
import { scrollSignals } from '../../scroll/signals';
import { sampleCurve } from '../curveGeometry';
import { WakeOnSignals } from '../WakeOnSignals';
import { cssColorHex, LAVENDER_FALLBACK } from '../../webgl';
import { createAnchorFrame, readAnchors, toScreenX, toScreenY } from './anchors';

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
 * It reads scrollSignals.curveSeed and nothing else — no ScrollTrigger, no
 * Lenis, no knowledge that a scroll engine exists. Whoever moves that number
 * owns the timing.
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

/** Deterministic noise, so a reload looks the same and nothing needs storing. */
function hash(i: number, salt: number) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const VERTEX = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;

  uniform float uDpr;

  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Orthographic at zoom 1, so size is simply pixels — times the device
    // ratio, since gl_PointSize is in framebuffer pixels.
    gl_PointSize = aSize * uDpr;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    // A soft round sprite, no texture: bright core, falls off to nothing at the
    // edge of the point so there is never a square.
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    float a = vAlpha * core * core;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

function Field({ color, onDark }: { color: string; onDark: boolean }) {
  const points = useRef<Points>(null);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  // Everything below is allocated once. The frame loop only writes into it.
  const state = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const alphas = new Float32Array(COUNT);
    const sizes = new Float32Array(COUNT);
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
      anchors: createAnchorFrame(),
      /** Whether the field is currently wiped. Tracked rather than inferred
       *  from the buffer, so scrubbing back to the top always clears exactly
       *  once and never leaves a particle stranded on the curve. */
      cleared: false,
    };
  }, []);

  // Only the colour can force a rebuild; uDpr is written by the frame loop, so
  // keeping it out of here means a device-ratio change never discards the
  // material mid-flight.
  const uniforms = useMemo(
    () => ({
      uColor: { value: new Color(color) },
      uDpr: { value: 1 },
    }),
    [color],
  );

  useFrame(() => {
    const mesh = points.current;
    if (!mesh) return;

    const seed = scrollSignals.curveSeed;
    const s = state;
    uniforms.uDpr.value = dpr;

    // Scrubbed back to before the beat: wipe the field once and stop. Skipping
    // the arithmetic also skips the two layout reads, which is the point.
    if (seed <= 0) {
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
      const px = inv * inv * sx + 2 * inv * t * cx + t * t * tx;
      const py = inv * inv * sy + 2 * inv * t * cy + t * t * ty;

      const o = i * 3;
      // Viewport pixels → world units. The camera is centred, y points up.
      s.positions[o] = px - halfW;
      s.positions[o + 1] = halfH - py;
      s.positions[o + 2] = 0;

      // Invisible at the source (the glow is behind the slab, and light should
      // not pop out in front of the card), full through the flight, dimmed once
      // it has become part of the chart.
      const fadeIn = t < 0.18 ? t / 0.18 : 1;
      const settle = t > 0.82 ? (t - 0.82) / 0.18 : 0;
      s.alphas[i] = fadeIn * (1 - (1 - SETTLED_ALPHA) * settle);
    }

    (mesh.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    (mesh.geometry.attributes.aAlpha as BufferAttribute).needsUpdate = true;
  });

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[state.positions, 3]} />
        <bufferAttribute attach="attributes-aAlpha" args={[state.alphas, 1]} />
        <bufferAttribute attach="attributes-aSize" args={[state.sizes, 1]} />
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
  const [theme, setTheme] = useState(() => ({
    color: cssColorHex('oklch(var(--lavender))', LAVENDER_FALLBACK),
    dark: document.documentElement.classList.contains('dark'),
  }));

  useEffect(() => {
    const reread = () =>
      setTheme({
        color: cssColorHex('oklch(var(--lavender))', LAVENDER_FALLBACK),
        dark: document.documentElement.classList.contains('dark'),
      });
    window.addEventListener(THEME_CHANGED_EVENT, reread);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, reread);
  }, []);

  // The canvas is fixed, so it is never "out of view" on its own — the thing
  // worth watching is the section the beat happens in. A viewport of slack on
  // each side covers the whole flight and keeps a full-screen layer from
  // clearing itself sixty times a second at the bottom of the page.
  useEffect(() => {
    const section = document.querySelector('#science');
    if (!section || typeof IntersectionObserver === 'undefined') {
      setLive(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setLive(entry.isIntersecting), {
      rootMargin: '120% 0px',
    });
    io.observe(section);
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
        <Field color={theme.color} onDark={theme.dark} />
        <WakeOnSignals />
      </Canvas>
    </div>
  );
}
