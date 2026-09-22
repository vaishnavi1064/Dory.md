import { motion } from 'framer-motion';
import { CalendarCheck, FileText, Sparkles, TrendingDown } from 'lucide-react';
import { SectionReveal } from '../components/SectionReveal';
import { VIEWPORT, staggerChild, staggerParent, useMotionPolicy } from '../motion';

const STEPS = [
  {
    icon: FileText,
    title: 'Capture',
    body: 'Drop in Markdown, PDFs, DOCX or a quick note. Dory chunks it and files it away.',
  },
  {
    icon: Sparkles,
    title: 'Understand',
    body: 'Every chunk is embedded and categorised, then linked to the notes it relates to.',
  },
  {
    icon: TrendingDown,
    title: 'Track decay',
    body: 'A forgetting-curve model scores each chunk so you can see what is slipping.',
  },
  {
    icon: CalendarCheck,
    title: 'Review & remember',
    body: 'FSRS schedules the right cards at the right moment, and reviewing one lifts its neighbours.',
  },
];

export function ApproachSection() {
  const { variants } = useMotionPolicy();

  return (
    <SectionReveal className="landing-band-soft">
      <div className="landing-shell py-20 lg:py-28">
        <div className="max-w-2xl">
          <p className="landing-eyebrow">The Dory approach</p>
          <h2 className="landing-display landing-h2 mt-4 text-[var(--text-1)]">
            A smarter way to remember.
          </h2>
          <p className="landing-lede landing-muted mt-5">
            Four steps, running quietly in the background. You write notes the way you
            already do — Dory works out what is fading and brings it back before it goes.
          </p>
        </div>

        <motion.ol
          className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6"
          variants={variants(staggerParent(0.09))}
          initial="hidden"
          whileInView="shown"
          viewport={VIEWPORT}
        >
          {STEPS.map((step, i) => (
            <motion.li key={step.title} variants={variants(staggerChild)} className="relative">
              {/* Connector between steps, desktop only — it implies a sequence
                  that the stacked mobile layout already conveys by order. */}
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-[3.1rem] top-[1.4rem] hidden h-px w-[calc(100%-2.6rem)] bg-[var(--border)] lg:block"
                />
              )}

              <div className="relative flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[oklch(var(--lavender))] shadow-[0_1px_0_var(--card-highlight)]">
                  <step.icon size={19} />
                </span>
                <span className="landing-subtle text-[0.72rem] font-extrabold tracking-[0.16em]">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>

              <h3 className="mt-4 text-[1.05rem] font-extrabold text-[var(--text-1)]">
                {step.title}
              </h3>
              <p className="landing-subtle mt-2 text-[0.88rem] leading-relaxed">{step.body}</p>
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </SectionReveal>
  );
}
