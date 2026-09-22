import { motion } from 'framer-motion';
import { TrendingDown } from 'lucide-react';
import { CountUp } from '../components/CountUp';
import { ForgettingCurve } from '../components/ForgettingCurve';
import { SectionReveal } from '../components/SectionReveal';
import { VIEWPORT, staggerChild, staggerParent, useMotionPolicy } from '../motion';

/** Either a number we count up to, or a glyph that cannot be counted. */
type Stat =
  | { kind: 'count'; value: number; suffix?: string; label: string }
  | { kind: 'glyph'; glyph: string; label: string };

const STATS: Stat[] = [
  { kind: 'count', value: 80, suffix: '%', label: 'of what you read is gone within a month' },
  { kind: 'count', value: 0, label: 'visibility into what you are losing' },
  { kind: 'glyph', glyph: '∞', label: 'ideas quietly lost to time' },
];

export function ProblemSection() {
  const { variants } = useMotionPolicy();

  return (
    <SectionReveal id="science" className="landing-band-soft border-y border-[var(--border)]">
      <div className="landing-shell grid gap-12 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:gap-16 lg:py-28">
        {/* ── Left: the argument ── */}
        <div>
          <p className="landing-eyebrow">The problem</p>
          <h2 className="landing-display landing-h2 mt-4 text-[var(--text-1)]">
            You take great notes. But you forget most of it.
          </h2>
          <p className="landing-lede landing-muted mt-5">
            Within a month, roughly 80% of what you carefully wrote down is gone. Not
            deleted — just unreachable. Your notes app remembers the text perfectly and
            tells you nothing about what is fading out of your head.
          </p>

          <motion.dl
            className="mt-10 grid gap-6 sm:grid-cols-3"
            variants={variants(staggerParent(0.1))}
            initial="hidden"
            whileInView="shown"
            viewport={VIEWPORT}
          >
            {STATS.map((stat) => (
              <motion.div key={stat.label} variants={variants(staggerChild)}>
                <dt className="landing-display text-[2.4rem] leading-none text-[oklch(var(--lavender))]">
                  {stat.kind === 'glyph' ? (
                    stat.glyph
                  ) : (
                    <CountUp to={stat.value} suffix={stat.suffix} />
                  )}
                </dt>
                <dd className="landing-subtle mt-2 text-[0.84rem] font-semibold leading-snug">
                  {stat.label}
                </dd>
              </motion.div>
            ))}
          </motion.dl>
        </div>

        {/* ── Right: the curve ── */}
        <div className="landing-card p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="app-section-title text-[0.95rem]">The forgetting curve</h3>
            <span className="landing-subtle text-[0.72rem] font-bold uppercase tracking-[0.12em]">
              No review
            </span>
          </div>
          <p className="landing-subtle mt-1 text-[0.8rem]">
            Retention of a single note over time, with nothing to reinforce it.
          </p>

          <div className="mt-5">
            <ForgettingCurve />
          </div>

          <div className="landing-card-dark mt-5 flex items-center gap-3 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[oklch(var(--lavender)/0.18)] text-[oklch(var(--lavender))]">
              <TrendingDown size={17} />
            </span>
            <div>
              <p className="text-[0.86rem] font-extrabold text-[var(--landing-deep-fg)]">
                Most of it is gone
              </p>
              <p className="text-[0.78rem] font-medium text-[var(--landing-deep-muted)]">
                A month later you are down to a few percent — unless something brings it back.
              </p>
            </div>
          </div>
        </div>
      </div>
    </SectionReveal>
  );
}
