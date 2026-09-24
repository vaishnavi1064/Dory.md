import { motion } from 'framer-motion';
import { RotateCcw } from 'lucide-react';
import { SectionReveal } from '../components/SectionReveal';
import { GRADES, RECALL_PCT, REVIEW_HOOK } from '../components/reviewGeometry';
import { riseIn, useMotionPolicy, useRevealViewport } from '../motion';

/**
 * The payoff of the whole page: the moment a fading note comes back.
 *
 * Sits between the time machine and the closing CTA on purpose. The time
 * machine shows the damage coming; this shows the one thing that undoes it,
 * which is what earns "Start remembering today" immediately afterwards.
 *
 * It is also where the scroll story lands. The particle field spends the page
 * spreading further apart — down the forgetting curve, across the search card,
 * out along three horizons — and gathers back onto this one card, brightening
 * and losing the decay tint as it comes. The card keeps a stable hook for that
 * (see components/reviewGeometry): move or rename it and the beat follows.
 */

const CARD = {
  due: 'Due now · 4th review',
  source: 'distributed-systems.md',
  question: 'CAP theorem: under a partition, what do you give up?',
  answer:
    'Consistency or availability — never both. A partitioned system either refuses the write or serves a stale read.',
};

const POINTS = [
  'Scheduled from your real recall, not a fixed calendar',
  'Answer once, and the notes it links to lift with it',
];

export function ReviewSection() {
  const reveal = useRevealViewport();
  const { variants } = useMotionPolicy();

  return (
    <SectionReveal id="review" className="landing-band-soft border-t border-[var(--border)]">
      <div className="landing-shell grid items-center gap-12 py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-16 lg:py-28">
        {/* ── Left: the turn ── */}
        <div>
          <p className="landing-eyebrow">Review</p>
          <h2 className="landing-display landing-h2 mt-4 text-[var(--text-1)]">
            Then remember it again.
          </h2>
          <p className="landing-lede landing-muted mt-5">
            Everything the curve took, one card gives back. Dory surfaces the chunk at the
            moment it is about to go, you answer honestly, and FSRS picks when you will
            need it next — so the same note costs you less time every round.
          </p>

          <motion.ul
            className="mt-9 space-y-3"
            variants={variants(riseIn(0.1))}
            initial="hidden"
            whileInView="shown"
            viewport={reveal}
          >
            {POINTS.map((line) => (
              <li
                key={line}
                className="landing-muted flex gap-3 text-[0.92rem] leading-relaxed"
              >
                <RotateCcw
                  size={16}
                  className="mt-0.5 shrink-0 text-[oklch(var(--lavender))]"
                />
                {line}
              </li>
            ))}
          </motion.ul>
        </div>

        {/* ── Right: the card the light gathers into ── */}
        <motion.div
          variants={variants(riseIn(0.05))}
          initial="hidden"
          whileInView="shown"
          viewport={reveal}
        >
          {/* The beat's ScrollTrigger is anchored to this card; what the field
              actually closes onto is the medallion below. Both carry stable
              hooks rather than being found by class. */}
          <div className="landing-card p-6" {...{ [REVIEW_HOOK.card]: '' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="landing-pill">{CARD.due}</span>
              <span className="landing-subtle text-[0.72rem] font-bold">{CARD.source}</span>
            </div>

            <div className="mt-5 flex items-center gap-4">
              {/* THE LANDING. Small on purpose: the field contracts onto this,
                  so it has to be smaller than the spread it is arriving from.
                  See components/reviewGeometry for why it is not the card. */}
              <span
                className="grid h-[4.5rem] w-[4.5rem] shrink-0 place-items-center rounded-full border border-[oklch(var(--lavender)/0.4)] bg-[oklch(var(--lavender)/0.1)] text-center"
                {...{ [REVIEW_HOOK.gather]: '' }}
              >
                <span className="landing-display text-[1.05rem] leading-none text-[var(--text-1)]">
                  {RECALL_PCT}%
                </span>
                <span className="landing-subtle text-[0.54rem] font-extrabold uppercase tracking-[0.1em]">
                  recall
                </span>
              </span>

              <p className="text-[1.02rem] font-extrabold leading-snug text-[var(--text-1)]">
                {CARD.question}
              </p>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
              <p className="landing-subtle text-[0.66rem] font-extrabold uppercase tracking-[0.12em]">
                Answer
              </p>
              <p className="mt-2 text-[0.88rem] leading-relaxed text-[var(--text-2)]">
                {CARD.answer}
              </p>
            </div>

            {/* Decorative, like the features carousel's arrows: this is a
                picture of the review screen, not a review screen. Spans rather
                than buttons, and out of the accessibility tree, so nothing is
                announced as a control that does nothing. */}
            <div aria-hidden className="mt-5 grid grid-cols-4 gap-2">
              {GRADES.map((grade) => (
                <span
                  key={grade.label}
                  className="flex flex-col items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2"
                >
                  <span className="flex items-center gap-1.5 text-[0.78rem] font-extrabold text-[var(--text-1)]">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: grade.tone }}
                    />
                    {grade.label}
                  </span>
                  <span className="landing-subtle text-[0.68rem] font-bold">
                    {grade.interval}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </SectionReveal>
  );
}
