import { useEffect, useRef, useState } from 'react';
import { useInView } from 'framer-motion';
import { useMotionPolicy, useRevealOnce } from '../motion';

interface CountUpProps {
  to: number;
  suffix?: string;
  durationMs?: number;
}

/** Counts from 0 to `to` when it scrolls into view — once, or on every pass
 *  while the scroll story is driving the page and everything else replays.
 *
 *  Renders the final value immediately when motion is reduced — the number is
 *  content, so it must never be withheld pending an animation.
 */
export function CountUp({ to, suffix = '', durationMs = 1100 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const once = useRevealOnce();
  const inView = useInView(ref, { once, amount: 0.6 });
  const { reduced } = useMotionPolicy();
  const [value, setValue] = useState(reduced ? to : 0);

  useEffect(() => {
    if (!inView || reduced) return;
    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Same ease-out as the rest of the page, so the number settles with it.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * to));
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduced, to, durationMs]);

  return (
    <span ref={ref}>
      {value}
      {suffix}
    </span>
  );
}
