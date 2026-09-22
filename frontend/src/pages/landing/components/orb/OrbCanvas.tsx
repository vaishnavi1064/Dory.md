import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useReducedMotion } from 'framer-motion';
import { Color, type Mesh } from 'three';
import { THEME_CHANGED_EVENT } from '@/lib/themeMode';
import { cssColorHex, LAVENDER_FALLBACK } from './orbGate';

/**
 * The lit half of the hero's background orb. Lazy-loaded — nothing in this file
 * or anything it imports is in the landing page's initial bundle.
 *
 * One sphere, one bloom pass, no lights. The sphere is drawn with a fresnel
 * falloff that reaches zero opacity at its own silhouette, so it fades out
 * instead of ending: there is no hard ball edge for the bloom to trace, and
 * what you read is a region of light rather than an object. Most of it sits
 * behind the dashboard slab, so the halo spilling past the card's edges is
 * really the whole effect.
 */

/* ── the dials ─────────────────────────────────────────────────────────────
   BLOOM_INTENSITY is the main one. Everything else is shape, not strength. */

/** Bloom strength. The brief's range is 0.8–1.2; this is the middle of it. */
const BLOOM_INTENSITY = 1.0;
/** Low, because the orb is a soft violet rather than a blown-out highlight —
 *  at a normal threshold there would be nothing bright enough to bloom. */
const BLOOM_THRESHOLD = 0.1;
const BLOOM_SMOOTHING = 0.45;
/** How far the halo reaches past the sphere. */
const BLOOM_RADIUS = 0.82;

/** Peak opacity at the orb's centre, before bloom. The second dial to reach
 *  for: it sets how present the orb is, where bloom sets how much it glows. */
const ORB_ALPHA = 0.62;
/** World radius against a camera at z=6 / fov 45, where the visible height is
 *  ~4.97 — so the orb covers about 80% of the layer and pokes out past the
 *  slab it sits behind. */
const ORB_RADIUS = 2;

/** Breathe: one cycle every ~8s, well inside the brief's 6–10s. */
const BREATHE_RATE = (Math.PI * 2) / 8;
const BREATHE_SCALE = 0.02;
const EMISSIVE_LOW = 0.8;
const EMISSIVE_HIGH = 1;

const VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uAlpha;

  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    // 1 dead centre, 0 at the silhouette. The sphere dissolves at its own edge,
    // which is what turns a ball into a glow.
    float facing = max(dot(normalize(vNormal), normalize(vView)), 0.0);
    float falloff = pow(facing, 1.7);

    // A touch brighter through the middle so there is a core for bloom to find.
    vec3 rgb = uColor * uIntensity * (0.7 + 0.55 * falloff);
    gl_FragColor = vec4(rgb, falloff * uIntensity * uAlpha);
  }
`;

function Orb({ color, reduced }: { color: string; reduced: boolean }) {
  const mesh = useRef<Mesh>(null);

  // Stable across renders: the frame loop writes straight into .value, and a
  // fresh object every render would throw that away.
  const uniforms = useMemo(
    () => ({
      uColor: { value: new Color(color) },
      uIntensity: { value: EMISSIVE_HIGH },
      uAlpha: { value: ORB_ALPHA },
    }),
    [color],
  );

  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;

    if (reduced) {
      m.scale.setScalar(1);
      uniforms.uIntensity.value = EMISSIVE_HIGH;
      return;
    }

    // 0..1 and back, once per breath. No allocation: setScalar mutates.
    const k = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * BREATHE_RATE);
    m.scale.setScalar(1 + BREATHE_SCALE * k);
    uniforms.uIntensity.value = EMISSIVE_LOW + (EMISSIVE_HIGH - EMISSIVE_LOW) * k;
  });

  return (
    <mesh ref={mesh}>
      {/* 500 triangles. The silhouette is faded out to nothing anyway, so a
          rounder sphere would buy exactly no pixels. */}
      <icosahedronGeometry args={[ORB_RADIUS, 4]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

/** Under reduced motion the loop is on demand, so ask for the frame that
 *  paints the resting state. */
function PaintOnce() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [invalidate]);
  return null;
}

export function OrbCanvas() {
  const reduced = useReducedMotion() ?? false;
  const root = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  const [color, setColor] = useState(() =>
    cssColorHex('oklch(var(--lavender))', LAVENDER_FALLBACK),
  );

  // --lavender shifts slightly between themes; re-read rather than bake it in.
  useEffect(() => {
    const reread = () => setColor(cssColorHex('oklch(var(--lavender))', LAVENDER_FALLBACK));
    window.addEventListener(THEME_CHANGED_EVENT, reread);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, reread);
  }, []);

  // Scrolled past the hero, a background glow has no business holding a render
  // loop — let alone one with a postprocessing pass.
  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      rootMargin: '160px',
    });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={root} className="landing-orb-layer" aria-hidden>
      <Canvas
        flat
        dpr={[1, 1.5]}
        frameloop={reduced || !inView ? 'demand' : 'always'}
        gl={{
          antialias: false, // the composer bypasses MSAA, and nothing here has an edge
          alpha: true,
          // It is ambient decoration; no reason to wake a discrete GPU for it.
          powerPreference: 'low-power',
        }}
        camera={{ position: [0, 0, 6], fov: 45, near: 0.1, far: 20 }}
      >
        <Orb color={color} reduced={reduced} />
        <PaintOnce />
        {/* multisampling 0: nothing in this scene has an edge to alias, and it
            halves the work the composer does. The normal pass is off by
            default and Bloom has no use for one. */}
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={BLOOM_INTENSITY}
            luminanceThreshold={BLOOM_THRESHOLD}
            luminanceSmoothing={BLOOM_SMOOTHING}
            radius={BLOOM_RADIUS}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
