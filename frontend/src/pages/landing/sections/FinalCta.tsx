import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Play } from 'lucide-react';
import { Annotation } from '../components/Annotation';
import { CTA_HOOK } from '../components/ctaGeometry';
import { GlowOrb } from '../components/GlowOrb';
import { sectionReveal, useMotionPolicy, useRevealViewport } from '../motion';

export function FinalCta() {
  const reveal = useRevealViewport();
  const { variants } = useMotionPolicy();

  return (
    <section id="start" className="landing-band-dark relative overflow-hidden">
      {/* Smaller and calmer than the hero's — this is a close, not an opening. */}
      <GlowOrb className="-top-[22%] left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 opacity-70" />

      {/* Where the scroll story ends. The particle field reforms into this,
          having left its twin behind the hero's dashboard six beats ago — which
          is why it is a static element of its own rather than the drifting orb
          above it. See components/ctaGeometry. */}
      <div className="landing-cta-glow" aria-hidden {...{ [CTA_HOOK.glow]: '' }} />

      <motion.div
        className="landing-shell relative z-10 flex flex-col items-center py-24 text-center lg:py-32"
        variants={variants(sectionReveal)}
        initial="hidden"
        whileInView="shown"
        viewport={reveal}
      >
        <p className="landing-eyebrow">Your ideas deserve a better memory</p>

        <h2 className="landing-display landing-h2 mt-5 max-w-3xl text-[var(--landing-deep-fg)]">
          Start remembering today.
        </h2>

        <p className="landing-lede landing-muted mt-5">
          Bring your notes, and let Dory keep track of what is fading. Free to start, no
          card, and your library is yours to export whenever you want.
        </p>

        <div className="relative mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link to="/register" className="landing-cta landing-cta-filled">
            Get started free
            <ArrowRight size={16} />
          </Link>
          <a href="#product" className="landing-cta landing-cta-ghost">
            <Play size={15} />
            Watch demo
          </a>

          <Annotation arrow="down-left" className="absolute -right-56 -top-8">
            A calmer mind for bigger ideas
          </Annotation>
        </div>
      </motion.div>
    </section>
  );
}
