import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Brain, Menu, X } from 'lucide-react';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { riseIn, useMotionPolicy } from '../motion';

/** Anchor targets are the section ids rendered by LandingPage. Pricing and FAQ
 *  have no section yet, so both point at the final CTA — a real destination
 *  rather than a dead '#' or a link that lands somewhere unrelated. */
const LINKS = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'Science', href: '#science' },
  { label: 'Pricing', href: '#start' },
  { label: 'FAQ', href: '#start' },
];

function Wordmark() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Dory.md home">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[oklch(var(--lavender)/0.18)] text-[oklch(var(--lavender))]">
        <Brain size={17} />
      </span>
      <span className="text-[1.02rem] font-extrabold tracking-tight text-[var(--landing-deep-fg)]">
        Dory.md
      </span>
    </Link>
  );
}

export function TopNav() {
  const [open, setOpen] = useState(false);
  const { variants } = useMotionPolicy();

  // A hash jump while the drawer is open should close it.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, [open]);

  return (
    <motion.header
      className="landing-band-dark landing-nav sticky top-0 z-50 border-b border-[var(--landing-deep-border)] backdrop-blur-md"
      variants={variants(riseIn(0))}
      initial="hidden"
      animate="shown"
    >
      <nav className="landing-shell flex h-16 items-center justify-between gap-4">
        <Wordmark />

        <div className="hidden items-center gap-7 lg:flex">
          {LINKS.map((link) => (
            <a key={link.label} href={link.href} className="landing-navlink">
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/login"
            className="landing-navlink hidden px-2 py-2 sm:inline-flex"
          >
            Sign in
          </Link>
          <Link to="/register" className="landing-cta landing-cta-filled !min-h-0 !px-4 !py-2.5">
            Get started
          </Link>
          <button
            type="button"
            className="landing-navlink -mr-1 grid h-9 w-9 place-items-center lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="landing-mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </nav>

      {open && (
        <div
          id="landing-mobile-nav"
          className="landing-shell border-t border-[var(--landing-deep-border)] pb-4 pt-3 lg:hidden"
        >
          <ul className="flex flex-col">
            {LINKS.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="landing-navlink block py-2.5 text-[0.95rem]"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li className="sm:hidden">
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="landing-navlink block py-2.5 text-[0.95rem]"
              >
                Sign in
              </Link>
            </li>
          </ul>
        </div>
      )}
    </motion.header>
  );
}
