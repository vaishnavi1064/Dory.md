/** Public marketing page at `/`. Deliberately outside the auth gate and outside
 *  AppShell: it has its own nav, its own scroll container, and no dependency on
 *  a session. Sections live in ./sections and are composed here in document
 *  order so the dark -> light -> dark rhythm is readable at a glance. */
export function LandingPage() {
  return (
    <div className="landing-root">
      <main />
    </div>
  );
}
