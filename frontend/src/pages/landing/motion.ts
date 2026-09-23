import { useMemo } from 'react';
import { useReducedMotion, type Variants } from 'framer-motion';
import { useEnhancedViewport } from './viewport';

/** The app's easing for anything that "settles" rather than just fades. */
export const SETTLE = [0.16, 1, 0.3, 1] as const;

/** Section-level scroll reveal: fade + rise, once, slightly before fully in view. */
export const sectionReveal: Variants = {
  hidden: { opacity: 0, y: 26 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.6, ease: SETTLE } },
};

/** Stagger container for a row of cards / steps / stats. */
export function staggerParent(stagger = 0.08, delay = 0): Variants {
  return {
    hidden: {},
    shown: { transition: { staggerChildren: stagger, delayChildren: delay } },
  };
}

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 18 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease: SETTLE } },
};

/** Hero headline: each line sits in an overflow-hidden mask and slides up. */
export const maskedLineParent: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.11, delayChildren: 0.06 } },
};

export const maskedLineChild: Variants = {
  hidden: { y: '100%' },
  shown: { y: '0%', transition: { duration: 0.85, ease: SETTLE } },
};

/** Everything below the headline: fade + rise, keyed off a shared delay ramp. */
export function riseIn(delay: number): Variants {
  return {
    hidden: { opacity: 0, y: 16 },
    shown: { opacity: 1, y: 0, transition: { duration: 0.6, delay, ease: SETTLE } },
  };
}

/** The dashboard mock's entrance — the one deliberately slow move on the page. */
export const mockEntrance: Variants = {
  hidden: { opacity: 0, scale: 0.92, rotateX: 9 },
  shown: {
    opacity: 1,
    scale: 1,
    rotateX: 0,
    transition: { duration: 1.2, delay: 0.25, ease: SETTLE },
  },
};

/** Shared viewport config so every section triggers at the same point. */
export const VIEWPORT = { once: true, amount: 0.25 } as const;

/**
 * Whether an in-view reveal should fire once and stay put.
 *
 * True by default, which is right for a page you read top to bottom. False once
 * the scroll story is driving, because there every other beat is scrubbed to
 * scroll position and can be run backwards — a reveal that has already spent
 * itself would be the one thing on the page that cannot. Scroll up and back
 * down and it is simply missing.
 *
 * The condition is the same one the scroll engine arms on, so the two agree
 * without having to talk to each other.
 */
export function useRevealOnce(): boolean {
  const reduced = useReducedMotion() ?? false;
  const wide = useEnhancedViewport();
  return !(wide && !reduced);
}

/** Viewport config for a reveal, replaying or not per useRevealOnce. Memoised
 *  because Framer re-creates its observer when the object identity changes. */
export function useRevealViewport(amount = 0.25) {
  const once = useRevealOnce();
  return useMemo(() => ({ once, amount }), [once, amount]);
}

/**
 * Motion policy for the whole page.
 *
 * `reduced` is true when the OS asks for less motion. Callers use it to drop
 * transforms and keep a plain fade — content must never be gated behind an
 * animation that will not run.
 */
export function useMotionPolicy() {
  const reduced = useReducedMotion() ?? false;

  /** Swap any variant set for a fade-only version when motion is reduced. */
  const variants = (full: Variants): Variants =>
    reduced
      ? {
          hidden: { opacity: 0 },
          shown: { opacity: 1, transition: { duration: 0.25 } },
        }
      : full;

  return { reduced, variants };
}
