import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Clock } from 'lucide-react';
import { Annotation } from '../components/Annotation';
import { CountUp } from '../components/CountUp';
import { SectionReveal } from '../components/SectionReveal';
import { PROJECTIONS, TM_HOOK } from '../components/timeMachineGeometry';
import {
  staggerChild,
  staggerParent,
  useMotionPolicy,
  useRevealViewport,
} from '../motion';

const RING = { size: 132, stroke: 11 };
const RADIUS = (RING.size - RING.stroke) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const RING_PCT = 62;

function ProjectionRing() {
  const { reduced } = useMotionPolicy();
  const reveal = useRevealViewport(0.6);
  const offset = CIRCUMFERENCE * (1 - RING_PCT / 100);

  return (
    <div className="relative grid place-items-center">
      <svg width={RING.size} height={RING.size} className="-rotate-90">
        <circle
          cx={RING.size / 2}
          cy={RING.size / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--border)"
          strokeWidth={RING.stroke}
        />
        <motion.circle
          cx={RING.size / 2}
          cy={RING.size / 2}
          r={RADIUS}
          fill="none"
          stroke="oklch(var(--lavender))"
          strokeWidth={RING.stroke}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          initial={{ strokeDashoffset: reduced ? offset : CIRCUMFERENCE }}
          whileInView={{ strokeDashoffset: offset }}
          viewport={reveal}
          transition={{ duration: reduced ? 0 : 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute grid place-items-center text-center">
        <span className="landing-display text-[1.9rem] leading-none text-[var(--text-1)]">
          <CountUp to={RING_PCT} suffix="%" />
        </span>
        <span className="landing-subtle mt-1 text-[0.66rem] font-extrabold uppercase tracking-[0.12em]">
          retained
        </span>
      </div>
    </div>
  );
}

export function TimeMachineSection() {
  const { variants } = useMotionPolicy();
  const reveal = useRevealViewport();

  return (
    <SectionReveal id="time-machine" className="landing-band-soft border-t border-[var(--border)]">
      <div className="landing-shell grid items-center gap-14 py-20 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:gap-16 lg:py-28">
        {/* ── Left: the pitch ── */}
        <div className="relative">
          <p className="landing-eyebrow">Time machine</p>
          <h2 className="landing-display landing-h2 mt-4 text-[var(--text-1)]">
            See your future knowledge.
          </h2>
          <p className="landing-lede landing-muted mt-5">
            Scrub forward and watch the curve play out. Dory projects where every chunk
            lands in a week, a month, a quarter — so you can fix the slide before it
            happens instead of rediscovering the damage later.
          </p>

          <Link to="/register" className="landing-cta landing-cta-ghost mt-8">
            <Clock size={16} />
            Explore the Time Machine
            <ArrowRight size={15} />
          </Link>

          <Annotation arrow="up-right" className="absolute -bottom-24 left-2">
            Don&rsquo;t let it fade away
          </Annotation>
        </div>

        {/* ── Right: projections ── */}
        <motion.div
          className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          {...{ [TM_HOOK.column]: '' }}
          variants={variants(staggerParent(0.1))}
          initial="hidden"
          whileInView="shown"
          viewport={reveal}
        >
          <div className="space-y-3">
            {PROJECTIONS.map((p) => (
              <motion.div
                key={p.key}
                variants={variants(staggerChild)}
                className="landing-card flex items-center gap-4 p-4"
              >
                <span className="landing-subtle w-16 shrink-0 text-[0.76rem] font-extrabold uppercase tracking-[0.1em]">
                  {p.horizon}
                </span>
                <div className="min-w-0 flex-1">
                  {/* The particle field lands along this track — the bar, not
                      the fill inside it, so the light reads against the empty
                      part of the horizon too. See components/particles/anchors. */}
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]"
                    {...{ [TM_HOOK.landing]: p.key }}
                  >
                    <div
                      className="h-full rounded-full bg-[oklch(var(--lavender))]"
                      style={{ width: `${p.retention}%` }}
                    />
                  </div>
                  <p className="landing-subtle mt-1.5 text-[0.72rem] font-semibold">
                    {p.atRisk} at risk · {p.critical} critical
                  </p>
                </div>
                <span className="w-10 shrink-0 text-right text-[0.95rem] font-extrabold text-[var(--text-1)]">
                  {p.retention}%
                </span>
              </motion.div>
            ))}
          </div>

          <motion.div
            variants={variants(staggerChild)}
            className="landing-card flex flex-col items-center gap-3 p-6"
          >
            <p className="landing-subtle text-center text-[0.74rem] font-extrabold uppercase tracking-[0.12em]">
              Knowledge in 30 days
            </p>
            <ProjectionRing />
            <div className="flex items-center gap-4 text-center">
              <div>
                <p className="text-[1.05rem] font-extrabold text-[var(--weak)]">24</p>
                <p className="landing-subtle text-[0.68rem] font-bold">at risk</p>
              </div>
              <span className="h-7 w-px bg-[var(--border)]" />
              <div>
                <p className="text-[1.05rem] font-extrabold text-[var(--danger)]">18</p>
                <p className="landing-subtle text-[0.68rem] font-bold">critical</p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </SectionReveal>
  );
}
