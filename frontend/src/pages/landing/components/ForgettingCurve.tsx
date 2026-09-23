import { motion } from 'framer-motion';
import { SETTLE, useMotionPolicy } from '../motion';
import { useEnhancedViewport } from '../viewport';
import {
  CURVE_AREA,
  CURVE_HOOK,
  CURVE_PATH,
  PAD,
  T_MAX,
  VIEWBOX,
  retentionAt,
  xOf,
  yOf,
} from './curveGeometry';

/**
 * A real Ebbinghaus decay curve — see ./curveGeometry for the maths, which the
 * particle field shares so the two can never disagree about where the line is.
 *
 * The chart reveals itself one of two ways:
 *
 *   driven   the scroll engine owns it. The line, the wash and the end dot are
 *            scrubbed to scroll position in the same timeline that flies the
 *            particles in, so the curve draws *as* they land rather than
 *            alongside them. Rendered fully visible here and hidden by
 *            gsap.set() when the engine claims it — which means a scroll engine
 *            that never loads leaves a perfectly good static chart rather than
 *            an invisible one.
 *
 *   on its own  the original: Framer draws it once when it scrolls into view.
 *               Narrow screens and reduced motion, where there is no engine.
 *
 * The switch is the page-wide viewport gate plus the motion preference, which
 * is exactly the condition the engine itself arms on — so the two agree without
 * having to talk to each other.
 */

const X_TICKS = [
  { days: 1, label: '1 day' },
  { days: 7, label: '1 week' },
  { days: 30, label: '1 month' },
];

const Y_TICKS = [0, 50, 100];

const DOT = { x: xOf(T_MAX), y: yOf(retentionAt(T_MAX)) };

export function ForgettingCurve() {
  const { reduced } = useMotionPolicy();
  const driven = useEnhancedViewport() && !reduced;

  // Spread onto the animated elements only when nothing else is driving them.
  const draw = driven
    ? {}
    : {
        initial: reduced ? { opacity: 0 } : { pathLength: 0 },
        whileInView: reduced ? { opacity: 1 } : { pathLength: 1 },
        viewport: { once: true, amount: 0.5 },
        transition: { duration: reduced ? 0.25 : 1.5, ease: reduced ? 'linear' : SETTLE },
      };

  const wash = driven
    ? {}
    : {
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true, amount: 0.5 },
        transition: { duration: reduced ? 0.25 : 0.9, delay: reduced ? 0 : 0.45 },
      };

  const pop = driven
    ? {}
    : {
        initial: { scale: 0, opacity: 0 },
        whileInView: { scale: 1, opacity: 1 },
        viewport: { once: true, amount: 0.5 },
        transition: { duration: reduced ? 0.2 : 0.4, delay: reduced ? 0 : 1.35 },
      };

  return (
    <svg
      {...{ [CURVE_HOOK.svg]: '' }}
      viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
      className="h-auto w-full"
      role="img"
      aria-label="The forgetting curve: retention falls from 100 percent to near zero within a month without review."
    >
      <defs>
        <linearGradient id="dory-curve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(var(--lavender))" stopOpacity="0.28" />
          <stop offset="100%" stopColor="oklch(var(--lavender))" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* horizontal gridlines + y labels */}
      {Y_TICKS.map((pct) => (
        <g key={pct}>
          <line
            x1={PAD.left}
            x2={VIEWBOX.width - PAD.right}
            y1={yOf(pct / 100)}
            y2={yOf(pct / 100)}
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray={pct === 0 ? undefined : '3 4'}
          />
          <text
            x={PAD.left - 7}
            y={yOf(pct / 100) + 3.5}
            textAnchor="end"
            className="fill-[var(--text-4)]"
            style={{ fontSize: 9, fontWeight: 700 }}
          >
            {pct}%
          </text>
        </g>
      ))}

      {/* x labels */}
      {X_TICKS.map((tick) => (
        <text
          key={tick.label}
          x={xOf(tick.days)}
          y={VIEWBOX.height - 8}
          textAnchor="middle"
          className="fill-[var(--text-4)]"
          style={{ fontSize: 9, fontWeight: 700 }}
        >
          {tick.label}
        </text>
      ))}

      {/* area wash, revealed with the line */}
      <motion.path
        {...{ [CURVE_HOOK.area]: '' }}
        d={CURVE_AREA}
        fill="url(#dory-curve-fill)"
        {...wash}
      />

      {/* the curve itself — draws left to right */}
      <motion.path
        {...{ [CURVE_HOOK.line]: '' }}
        d={CURVE_PATH}
        fill="none"
        stroke="oklch(var(--lavender))"
        strokeWidth="2.4"
        strokeLinecap="round"
        {...draw}
      />

      {/* the point the callout is about */}
      <motion.circle
        {...{ [CURVE_HOOK.dot]: '' }}
        cx={DOT.x}
        cy={DOT.y}
        r="4"
        fill="oklch(var(--lavender))"
        style={{ transformOrigin: `${DOT.x}px ${DOT.y}px` }}
        {...pop}
      />
    </svg>
  );
}
