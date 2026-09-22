import { clsx } from 'clsx';

interface GlowOrbProps {
  /** Tailwind positioning/sizing for the orb box, e.g. "-top-24 h-[36rem] w-[36rem]". */
  className?: string;
  /** Layers a second, slower blob for a bit of internal drift. */
  layered?: boolean;
}

/**
 * The purple haze behind the hero and the final CTA.
 *
 * TIER-2 SWAP POINT. This is deliberately a pure-CSS radial blob with no
 * canvas, no RAF and no dependencies. A React Three Fiber orb should replace
 * the body of this component and keep the same props and the same absolutely
 * positioned box, so nothing around it has to move.
 *
 * Idle drift is a CSS keyframe (see .landing-orb in landing.css), which is also
 * where prefers-reduced-motion switches it off — a JS media query would not
 * catch a user who changes the setting mid-session.
 */
export function GlowOrb({ className, layered = true }: GlowOrbProps) {
  return (
    <div aria-hidden className={clsx('landing-orb', className)}>
      {layered && (
        <div className="landing-orb landing-orb-slow absolute inset-[12%] !blur-[38px]" />
      )}
    </div>
  );
}
