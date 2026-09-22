import { Link } from 'react-router-dom';
import { Brain, Github, Heart, Linkedin, Twitter } from 'lucide-react';

/** Internal destinations are <Link>; anchors stay on the page; anything that
 *  does not exist yet points at a real section rather than a dead '#'. */
const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', to: '#features' },
      { label: 'Time machine', to: '#faq' },
      { label: 'Memory health', to: '#product' },
      { label: 'Pricing', to: '#start' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'The science', to: '#science' },
      { label: 'How it works', to: '#product' },
      { label: 'Changelog', to: '#start' },
      { label: 'Support', to: '#start' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '#product' },
      { label: 'Sign in', to: '/login', internal: true },
      { label: 'Get started', to: '/register', internal: true },
      { label: 'Contact', to: '#start' },
    ],
  },
];

const SOCIALS = [
  { icon: Github, label: 'GitHub', href: 'https://github.com/vaishnavi1064/Dory.md' },
  { icon: Twitter, label: 'Twitter', href: 'https://twitter.com' },
  { icon: Linkedin, label: 'LinkedIn', href: 'https://linkedin.com' },
];

export function Footer() {
  return (
    <footer className="landing-band-dark border-t border-[var(--landing-deep-border)]">
      <div className="landing-shell py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
          {/* brand */}
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[oklch(var(--lavender)/0.18)] text-[oklch(var(--lavender))]">
                <Brain size={17} />
              </span>
              <span className="text-[1.02rem] font-extrabold tracking-tight text-[var(--landing-deep-fg)]">
                Dory.md
              </span>
            </div>
            <p className="landing-muted mt-3 max-w-xs text-[0.86rem] leading-relaxed">
              The notes app that remembers so you don&rsquo;t have to forget.
            </p>
            <p className="landing-subtle mt-5 flex items-center gap-1.5 text-[0.8rem] font-semibold">
              Built with
              <Heart size={13} className="fill-current text-[oklch(var(--lavender))]" />
              for curious minds
            </p>
          </div>

          {/* link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-[0.76rem] font-extrabold uppercase tracking-[0.13em] text-[var(--landing-deep-fg)]">
                  {col.title}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      {'internal' in link && link.internal ? (
                        <Link to={link.to} className="landing-navlink text-[0.86rem]">
                          {link.label}
                        </Link>
                      ) : (
                        <a href={link.to} className="landing-navlink text-[0.86rem]">
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* bottom bar */}
        <div className="mt-12 flex flex-col-reverse items-start gap-5 border-t border-[var(--landing-deep-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="landing-subtle text-[0.8rem] font-medium">
            © {new Date().getFullYear()} Dory.md · {' '}
            <a href="#start" className="landing-navlink">Privacy</a> · {' '}
            <a href="#start" className="landing-navlink">Terms</a> · {' '}
            <a href="#start" className="landing-navlink">Security</a>
          </p>

          <ul className="flex items-center gap-2">
            {SOCIALS.map((s) => (
              <li key={s.label}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={s.label}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--landing-deep-border)] bg-[var(--landing-deep-card)] text-[var(--landing-deep-muted)] transition-colors hover:border-[oklch(var(--lavender)/0.45)] hover:text-[var(--landing-deep-fg)]"
                >
                  <s.icon size={15} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
