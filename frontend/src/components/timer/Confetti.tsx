import { useEffect, useMemo, type CSSProperties } from 'react';

// Lightweight, dependency-free confetti burst for the Custom timer's
// "Session complete" celebration. 18 particles fly out on an upward arc, then
// fall under a slight gravity. Colors come from theme tokens via CSS classes
// (see .confetti-c1..3 in styles.css). pointer-events:none so it never blocks
// interaction, and it lives inside the circle's overflow-hidden wrapper.

const COLOR_CLASSES = ['confetti-c1', 'confetti-c2', 'confetti-c3'];
const PARTICLE_COUNT = 18;
const DURATION_MS = 1500;

interface Particle {
  dx: number;
  peak: number;
  fall: number;
  rot: number;
  cls: string;
}

export function Confetti({ onDone }: { onDone: () => void }) {
  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: PARTICLE_COUNT }, () => {
        const vx = Math.random() * 240 - 120; // -120..+120 px
        const vy = -(Math.random() * 120 + 40); // -160..-40 px (upward first)
        return {
          dx: vx,
          peak: vy,
          fall: vy + 180 + Math.random() * 60, // ends below center (gravity)
          rot: Math.random() * 360,
          cls: COLOR_CLASSES[Math.floor(Math.random() * COLOR_CLASSES.length)],
        };
      }),
    [],
  );

  useEffect(() => {
    const id = window.setTimeout(onDone, DURATION_MS);
    return () => window.clearTimeout(id);
  }, [onDone]);

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
      <div className="relative">
        {particles.map((p, i) => (
          <span
            key={i}
            className={`confetti-particle ${p.cls}`}
            style={
              {
                '--cx': `${p.dx}px`,
                '--peak': `${p.peak}px`,
                '--fall': `${p.fall}px`,
                '--rot': `${p.rot}deg`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}
