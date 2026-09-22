import { useEffect } from 'react';
import { ApproachSection } from './sections/ApproachSection';
import { FeaturesSection } from './sections/FeaturesSection';
import { Hero } from './sections/Hero';
import { ProblemSection } from './sections/ProblemSection';
import { TopNav } from './sections/TopNav';
import './landing.css';

/** Public marketing page at `/`.
 *
 *  Deliberately outside the auth gate and outside AppShell: it has its own nav
 *  and no dependency on a session. Sections live in ./sections and are composed
 *  here in document order, so the dark -> light -> dark rhythm of the page is
 *  readable at a glance.
 */
export function LandingPage() {
  // AppShell owns the app's scroll container; this page scrolls the document,
  // so make sure a route change into it starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="landing-root">
      <TopNav />
      <main>
        <Hero />
        <ProblemSection />
        <ApproachSection />
        <FeaturesSection />
      </main>
    </div>
  );
}
