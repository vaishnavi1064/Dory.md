import { lazy, Suspense, useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useEnhancedViewport } from '../../viewport';
import { hasWebGL } from '../../webgl';

/**
 * The hero's light leaving the glow behind the dashboard and settling onto
 * the forgetting curve.
 *
 * Mounted at the page root rather than inside a section, because the beat
 * crosses two of them: a fixed, full-viewport canvas is the only layer that can
 * be in the hero and in the Problem section at once.
 *
 * Gated on exactly the conditions the scroll engine arms on, plus WebGL — the
 * signal it reads is only ever written when the engine is running, so anything
 * narrower, calmer or without a GPU gets a curve that draws itself in the way
 * it always has, and no canvas at all.
 */

/** Well clear of first paint. Nothing here is needed to render or read the
 *  page, and the beat it draws does not start until the hero scrolls. */
const ARM_DELAY_MS = 320;

const ParticleCanvas = lazy(() =>
  import('./ParticleCanvas').then((m) => ({ default: m.ParticleCanvas })),
);

export function MemoryParticles() {
  const reduced = useReducedMotion() ?? false;
  const wide = useEnhancedViewport();
  const [armed, setArmed] = useState(false);

  const enabled = wide && !reduced && hasWebGL();

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  if (!enabled || !armed) return null;

  return (
    // A lost context, or a chunk that 404s on a stale deploy, would otherwise
    // take the whole landing page down for the sake of a decoration.
    // An empty fragment rather than null, because ErrorBoundary tests its
    // fallback for truthiness.
    <ErrorBoundary fallback={<></>}>
      <Suspense fallback={null}>
        <ParticleCanvas />
      </Suspense>
    </ErrorBoundary>
  );
}
