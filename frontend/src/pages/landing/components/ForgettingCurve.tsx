import { motion } from 'framer-motion';
import { SETTLE, useMotionPolicy } from '../motion';

/**
 * A real Ebbinghaus decay curve, R(t) = e^(-t / S), drawn from computed points
 * rather than a hand-tuned bezier — it is the same model the product uses, so
 * the marketing chart should not be a doodle.
 *
 * The x axis is logarithmic so 1 day / 1 week / 1 month land evenly spaced,
 * which is how the forgetting curve is conventionally shown.
 */

const W = 340;
const H = 190;
const PAD = { top: 12, right: 14, bottom: 26, left: 32 };

const T_MIN = 0.25; // 6 hours
const T_MAX = 30; // one month
const S = 6; // stability, in days — tuned for the classic curve shape

const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

function xOf(days: number) {
  const ratio = Math.log(days / T_MIN) / Math.log(T_MAX / T_MIN);
  return PAD.left + ratio * plotW;
}

function yOf(retention: number) {
  return PAD.top + (1 - retention) * plotH;
}

function buildPath() {
  const steps = 72;
  const points: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const days = T_MIN * Math.pow(T_MAX / T_MIN, i / steps);
    const r = Math.exp(-days / S);
    points.push(`${i === 0 ? 'M' : 'L'}${xOf(days).toFixed(2)} ${yOf(r).toFixed(2)}`);
  }
  return points.join(' ');
}

const CURVE = buildPath();
const AREA = `${CURVE} L${xOf(T_MAX).toFixed(2)} ${yOf(0).toFixed(2)} L${xOf(T_MIN).toFixed(2)} ${yOf(0).toFixed(2)} Z`;

const X_TICKS = [
  { days: 1, label: '1 day' },
  { days: 7, label: '1 week' },
  { days: 30, label: '1 month' },
];

const Y_TICKS = [0, 50, 100];

export function ForgettingCurve() {
  const { reduced } = useMotionPolicy();

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
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
            x2={W - PAD.right}
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
          y={H - 8}
          textAnchor="middle"
          className="fill-[var(--text-4)]"
          style={{ fontSize: 9, fontWeight: 700 }}
        >
          {tick.label}
        </text>
      ))}

      {/* area wash, revealed with the line */}
      <motion.path
        d={AREA}
        fill="url(#dory-curve-fill)"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: reduced ? 0.25 : 0.9, delay: reduced ? 0 : 0.45 }}
      />

      {/* the curve itself — draws left to right on entry */}
      <motion.path
        d={CURVE}
        fill="none"
        stroke="oklch(var(--lavender))"
        strokeWidth="2.4"
        strokeLinecap="round"
        initial={reduced ? { opacity: 0 } : { pathLength: 0 }}
        whileInView={reduced ? { opacity: 1 } : { pathLength: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: reduced ? 0.25 : 1.5, ease: reduced ? 'linear' : SETTLE }}
      />

      {/* the point the callout is about */}
      <motion.circle
        cx={xOf(30)}
        cy={yOf(Math.exp(-30 / S))}
        r="4"
        fill="oklch(var(--lavender))"
        initial={{ scale: 0, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: reduced ? 0.2 : 0.4, delay: reduced ? 0 : 1.35 }}
        style={{ transformOrigin: `${xOf(30)}px ${yOf(Math.exp(-30 / S))}px` }}
      />
    </svg>
  );
}
