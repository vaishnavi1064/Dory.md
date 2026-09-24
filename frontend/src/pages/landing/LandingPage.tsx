import { useEffect } from 'react';
import { ApproachSection } from './sections/ApproachSection';
import { FeaturesSection } from './sections/FeaturesSection';
import { FinalCta } from './sections/FinalCta';
import { Footer } from './sections/Footer';
import { Hero } from './sections/Hero';
import { ProblemSection } from './sections/ProblemSection';
import { ReviewSection } from './sections/ReviewSection';
import { TimeMachineSection } from './sections/TimeMachineSection';
import { MemoryParticles } from './components/particles/MemoryParticles';
import { TopNav } from './sections/TopNav';
import { useScrollEngine } from './scroll/useScrollEngine';
import './landing.css';

/** Public marketing page at `/`.
 *
 *  Deliberately outside the auth gate and outside AppShell: it has its own nav
 *  and no dependency on a session. Sections live in ./sections and are composed
 *  here in document order, so the dark -> light -> dark rhythm of the page is
 *  readable at a glance:
 *
 *    TopNav           dark
 *    Hero             dark    #product
 *    ProblemSection   light   #science
 *    ApproachSection  light
 *    FeaturesSection  light   #features
 *    TimeMachine      light   #time-machine
 *    Review           light   #review
 *    FinalCta         dark    #start
 *    Footer           dark
 */
export function LandingPage() {
  // AppShell owns the app's scroll container; this page scrolls the document,
  // so make sure a route change into it starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Smooth scrolling and everything tied to scroll position. Lazy, gated to
  // desktop widths with motion allowed, and additive — the page below is
  // exactly what renders without it.
  useScrollEngine();

  return (
    <div className="landing-root">
      <TopNav />
      <main>
        <Hero />
        <ProblemSection />
        <ApproachSection />
        <FeaturesSection />
        <TimeMachineSection />
        <ReviewSection />
        <FinalCta />
      </main>
      <Footer />

      {/* A fixed, full-viewport layer. Lives at the root because the beat it
          draws crosses two sections. */}
      <MemoryParticles />
    </div>
  );
}
