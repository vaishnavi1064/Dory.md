import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Search } from 'lucide-react';
import { SectionReveal } from '../components/SectionReveal';
import { staggerChild, staggerParent, useMotionPolicy, useRevealViewport } from '../motion';

const BUCKETS = [
  { label: 'Strong', count: 12, color: 'var(--good)', pct: 88 },
  { label: 'Fading', count: 8, color: 'var(--warn)', pct: 62 },
  { label: 'Weak', count: 6, color: 'var(--weak)', pct: 34 },
  { label: 'Critical', count: 3, color: 'var(--danger)', pct: 12 },
];

const SEARCH_TAGS = ['semantic', 'decay-aware', 'recency', 'hybrid ranking'];

const SCHEDULE = [
  { when: 'Today', what: 'Scaled dot-product attention', tone: 'var(--danger)' },
  { when: 'Tomorrow', what: 'CAP theorem trade-offs', tone: 'var(--weak)' },
  { when: 'In 4 days', what: 'B+ tree index internals', tone: 'var(--warn)' },
  { when: 'In 2 weeks', what: 'Union-find with path compression', tone: 'var(--good)' },
];

/** Decorative only for Tier 1 — the grid is not a carousel yet, so these must
 *  not be focusable or announced as controls that do nothing. */
function CarouselArrows() {
  return (
    <div aria-hidden className="hidden items-center gap-2 sm:flex">
      {[ArrowLeft, ArrowRight].map((Icon, i) => (
        <span
          key={i}
          className="grid h-9 w-9 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)]"
        >
          <Icon size={15} />
        </span>
      ))}
    </div>
  );
}

function MemoryHealthCard() {
  return (
    <div className="landing-card-dark flex h-full flex-col p-6">
      <h3 className="text-[1.05rem] font-extrabold text-[var(--landing-deep-fg)]">
        Memory health
      </h3>
      <p className="mt-2 text-[0.88rem] leading-relaxed text-[var(--landing-deep-muted)]">
        Every chunk is scored and bucketed, so a glance tells you where your knowledge is
        solid and where it is about to go.
      </p>

      <ul className="mt-6 space-y-3">
        {BUCKETS.map((b) => (
          <li key={b.label} className="flex items-center gap-3">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: b.color }}
            />
            <span className="w-16 shrink-0 text-[0.8rem] font-bold text-[var(--landing-deep-fg)]">
              {b.label}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[oklch(1_0_0/0.09)]">
              <span
                className="block h-full rounded-full"
                style={{ width: `${b.pct}%`, background: b.color }}
              />
            </span>
            <span className="w-6 shrink-0 text-right text-[0.82rem] font-extrabold text-[var(--landing-deep-fg)]">
              {b.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SmartSearchCard() {
  return (
    <div className="landing-card flex h-full flex-col p-6">
      <h3 className="text-[1.05rem] font-extrabold text-[var(--text-1)]">Smart search</h3>
      <p className="landing-subtle mt-2 text-[0.88rem] leading-relaxed">
        Dense retrieval re-ranked by what you are most at risk of forgetting — not just
        what matches.
      </p>

      <div className="mt-5 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
        <Search size={14} className="shrink-0 text-[var(--text-3)]" />
        <span className="landing-subtle truncate text-[0.82rem] font-semibold">
          how does consensus work
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {SEARCH_TAGS.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-[oklch(var(--lavender)/0.35)] bg-[oklch(var(--lavender)/0.12)] px-2.5 py-1 text-[0.72rem] font-bold text-[var(--text-2)]"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function SpacedRepetitionCard() {
  return (
    <div className="landing-card flex h-full flex-col p-6">
      <h3 className="text-[1.05rem] font-extrabold text-[var(--text-1)]">Spaced repetition</h3>
      <p className="landing-subtle mt-2 text-[0.88rem] leading-relaxed">
        FSRS-4 picks the moment each card is worth seeing again.
      </p>

      <ul className="mt-5 space-y-2.5">
        {SCHEDULE.map((item) => (
          <li key={item.what} className="flex items-center gap-3">
            <span
              className="h-6 w-1 shrink-0 rounded-full"
              style={{ background: item.tone }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.82rem] font-semibold text-[var(--text-2)]">
                {item.what}
              </span>
            </span>
            <span className="landing-subtle shrink-0 text-[0.74rem] font-bold">
              {item.when}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuizCard() {
  return (
    <div className="landing-card flex h-full flex-col p-6">
      <h3 className="text-[1.05rem] font-extrabold text-[var(--text-1)]">AI quizzes</h3>
      <p className="landing-subtle mt-2 text-[0.88rem] leading-relaxed">
        Your weakest chunks become multiple-choice questions, graded server-side.
      </p>

      <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
        <p className="text-[0.84rem] font-bold leading-snug text-[var(--text-1)]">
          What does S represent in R(t) = e^(-t/S)?
        </p>
        <ul className="mt-3 space-y-1.5">
          {['Speed of learning', 'Memory stability', 'Stress coefficient'].map((opt, i) => (
            <li
              key={opt}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[0.78rem] font-semibold ${
                i === 1
                  ? 'border-[oklch(var(--good)/0.4)] bg-[oklch(var(--good)/0.1)] text-[var(--good)]'
                  : 'border-[var(--border)] text-[var(--text-3)]'
              }`}
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-current/40 text-[0.6rem]">
                {String.fromCharCode(65 + i)}
              </span>
              {opt}
              {i === 1 && <Check size={13} className="ml-auto" />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function FeaturesSection() {
  const reveal = useRevealViewport();
  const { variants } = useMotionPolicy();

  return (
    <SectionReveal id="features" className="landing-band-soft border-t border-[var(--border)]">
      <div className="landing-shell py-20 lg:py-28">
        <div className="flex items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="landing-eyebrow">Feature highlights</p>
            <h2 className="landing-display landing-h2 mt-4 text-[var(--text-1)]">
              Everything you need to build a lasting mind.
            </h2>
          </div>
          <CarouselArrows />
        </div>

        <motion.div
          className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3"
          variants={variants(staggerParent(0.09))}
          initial="hidden"
          whileInView="shown"
          viewport={reveal}
        >
          <motion.div variants={variants(staggerChild)} className="md:col-span-2">
            <MemoryHealthCard />
          </motion.div>
          <motion.div variants={variants(staggerChild)}>
            <SmartSearchCard />
          </motion.div>
          <motion.div variants={variants(staggerChild)}>
            <SpacedRepetitionCard />
          </motion.div>
          <motion.div variants={variants(staggerChild)} className="md:col-span-2">
            <QuizCard />
          </motion.div>
        </motion.div>
      </div>
    </SectionReveal>
  );
}
