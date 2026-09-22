import { lazy, Suspense, useEffect, useState } from 'react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useOrbEnabled } from './orbGate';

/**
 * The glowing orb behind the hero's dashboard slab.
 *
 * Purely a background layer: it sits in .landing-stage underneath the slab (see
 * .landing-orb-layer) and never takes a pointer event. If WebGL is missing or
 * the window is too narrow it renders nothing at all — the hero has always
 * looked right without it and still does.
 *
 * THE HOOK-IN POINT FOR SCROLL WORK. This component is deliberately the whole
 * public surface of the orb: mount it, position it, and it takes care of
 * itself. The scroll-animation bite should drive it from here — through props
 * added to this signature, or by styling .landing-orb-layer from outside — and
 * should not need to reach into OrbCanvas or the shader.
 */

/** Beat after mount before the chunk is even requested, so the hero's own
 *  paint and entrance never share a frame with a WebGL context creation. */
const ARM_DELAY_MS = 220;

const OrbCanvas = lazy(() =>
  import('./OrbCanvas').then((m) => ({ default: m.OrbCanvas })),
);

export function HeroOrb() {
  const enabled = useOrbEnabled();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  if (!enabled || !armed) return null;

  return (
    // "Never break the hero" has to hold for the failures the gate cannot see:
    // a context that dies on creation, a shader that will not compile, a stale
    // deploy serving a 404 for the chunk. All of those throw during render, and
    // without a boundary they would take the whole landing page with them for
    // the sake of a background glow.
    //
    // An empty fragment rather than null: ErrorBoundary tests its fallback for
    // truthiness, so null would fall through to the app's full error card.
    <ErrorBoundary fallback={<></>}>
      <Suspense fallback={null}>
        <OrbCanvas />
      </Suspense>
    </ErrorBoundary>
  );
}
