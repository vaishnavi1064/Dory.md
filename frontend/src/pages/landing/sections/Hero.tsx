import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { ArrowRight, BrainCircuit, CalendarCheck, Play, Search, Sparkles } from 'lucide-react';
import { Annotation } from '../components/Annotation';
import { DashboardMock } from '../components/DashboardMock';
import { FloatingChips } from '../components/FloatingChips';
import { GlowOrb } from '../components/GlowOrb';
import {
  maskedLineChild,
  maskedLineParent,
  mockEntrance,
  riseIn,
  useMotionPolicy,
} from '../motion';

const HEADLINE = ['Remember what', 'matters.'];

const FEATURES = [
  { icon: Search, label: 'Smarter search' },
  { icon: CalendarCheck, label: 'Spaced repetition' },
  { icon: BrainCircuit, label: 'AI quizzes' },
];

const STACK = ['Python', 'React', 'FastAPI', 'ChromaDB', 'FSRS'];

/** How far the mock rotates toward the pointer, in degrees. Small on purpose —
 *  it should read as parallax, not as a toy. */
const TILT = 6;

function useCursorTilt(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const spring = { stiffness: 120, damping: 18, mass: 0.6 };
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-TILT, TILT]), spring);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [TILT, -TILT]), spring);

  function onPointerMove(e: React.PointerEvent) {
    // Coarse pointers (touch) have no hover state to track, and reduced-motion
    // users opted out of exactly this kind of continuous movement.
    if (!enabled || e.pointerType !== 'mouse') return;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    x.set((e.clientX - box.left) / box.width - 0.5);
    y.set((e.clientY - box.top) / box.height - 0.5);
  }

  function onPointerLeave() {
    x.set(0);
    y.set(0);
  }

  return { ref, rotateX, rotateY, onPointerMove, onPointerLeave };
}

export function Hero() {
  const { reduced, variants } = useMotionPolicy();
  const tilt = useCursorTilt(!reduced);

  // The mock sits at a fixed angle and the cursor nudges it from there.
  const baseRotateY = reduced ? 0 : -13;

  return (
    <section id="product" className="landing-band-dark relative overflow-hidden">
      <GlowOrb className="-right-[18%] -top-[28%] h-[46rem] w-[46rem] opacity-90" />
      <GlowOrb className="-bottom-[34%] left-[-14%] h-[34rem] w-[34rem] opacity-60" layered={false} />

      <div className="landing-shell relative z-10 grid items-center gap-14 py-16 md:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)] lg:gap-10 lg:py-28">
        {/* ── Left: the pitch ── */}
        <div>
          <motion.div variants={variants(riseIn(0.05))} initial="hidden" animate="shown">
            <span className="landing-pill">
              <Sparkles size={13} className="text-[oklch(var(--lavender))]" />
              Built for curious minds
            </span>
          </motion.div>

          <motion.h1
            className="landing-display landing-h1 mt-6 text-[var(--landing-deep-fg)]"
            variants={variants(maskedLineParent)}
            initial="hidden"
            animate="shown"
          >
            {HEADLINE.map((line, i) => (
              <span key={line} className="landing-reveal-line">
                <motion.span
                  className="block"
                  variants={reduced ? undefined : maskedLineChild}
                >
                  {i === HEADLINE.length - 1 ? <span className="landing-accent">{line}</span> : line}
                </motion.span>
              </span>
            ))}
          </motion.h1>

          <motion.p
            className="landing-lede landing-muted mt-6"
            variants={variants(riseIn(0.45))}
            initial="hidden"
            animate="shown"
          >
            Dory.md is a memory-aware notes app that shows you what you&rsquo;re forgetting,
            helps you review at the right time, and turns notes into lasting knowledge.
          </motion.p>

          <motion.div
            className="mt-8 flex flex-wrap items-center gap-3"
            variants={variants(riseIn(0.58))}
            initial="hidden"
            animate="shown"
          >
            <Link to="/register" className="landing-cta landing-cta-filled">
              Get started free
              <ArrowRight size={16} />
            </Link>
            <a href="#science" className="landing-cta landing-cta-ghost">
              <Play size={15} />
              Watch demo
            </a>
          </motion.div>

          <motion.ul
            className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3"
            variants={variants(riseIn(0.7))}
            initial="hidden"
            animate="shown"
          >
            {FEATURES.map((f) => (
              <li
                key={f.label}
                className="landing-muted flex items-center gap-2 text-[0.86rem] font-semibold"
              >
                <f.icon size={15} className="text-[oklch(var(--lavender))]" />
                {f.label}
              </li>
            ))}
          </motion.ul>

          <motion.div
            className="mt-9 border-t border-[var(--landing-deep-border)] pt-5"
            variants={variants(riseIn(0.8))}
            initial="hidden"
            animate="shown"
          >
            <p className="landing-subtle flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.74rem] font-bold tracking-wide">
              <span className="uppercase tracking-[0.14em]">Built with</span>
              {STACK.map((tech, i) => (
                <span key={tech} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden>·</span>}
                  {tech}
                </span>
              ))}
            </p>
          </motion.div>
        </div>

        {/* ── Right: the product shot ── */}
        <div className="relative">
          <Annotation
            arrow="down-left"
            className="absolute -top-14 right-2 z-20 xl:-top-20 xl:right-8"
          >
            A second brain that remembers with you
          </Annotation>

          <div
            className="landing-stage relative"
            ref={tilt.ref}
            onPointerMove={tilt.onPointerMove}
            onPointerLeave={tilt.onPointerLeave}
          >
            <motion.div
              className="landing-tilt relative"
              variants={variants(mockEntrance)}
              initial="hidden"
              animate="shown"
              style={
                reduced
                  ? undefined
                  : { rotateX: tilt.rotateX, rotateY: tilt.rotateY }
              }
            >
              <div style={{ transform: `rotateY(${baseRotateY}deg)` }}>
                <DashboardMock />
              </div>
            </motion.div>

            <FloatingChips />
          </div>
        </div>
      </div>
    </section>
  );
}
