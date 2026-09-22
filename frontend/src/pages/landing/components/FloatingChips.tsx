import { AlarmClock, Gauge, TrendingDown } from 'lucide-react';

/** Stat chips that hover around the dashboard mock.
 *
 *  Each gets its own animation-delay so they drift out of phase rather than
 *  bobbing in unison. The drift keyframe (and its reduced-motion off switch)
 *  lives in landing.css.
 *
 *  `hideBelow` drops the two secondary chips on small screens, where the mock
 *  is already narrow and overlapping chips would cover it.
 */
const CHIPS = [
  {
    icon: AlarmClock,
    text: 'Review · 3 cards due',
    // Positions are percentages of the stage so they track the mock as it scales.
    style: { top: '6%', left: '-6%' },
    delay: '0s',
    primary: true,
  },
  {
    icon: Gauge,
    text: 'Retention 66%',
    style: { top: '44%', right: '-7%' },
    delay: '-2.4s',
    primary: false,
  },
  {
    icon: TrendingDown,
    text: "You'll forget this in 5 days",
    style: { bottom: '8%', left: '-9%' },
    delay: '-4.8s',
    primary: false,
  },
];

export function FloatingChips() {
  return (
    // A flat layer of its own, stretched over the stage and stacked above the
    // slab. The chips must never join the slab's 3D context — they are labels
    // pointing at the product, not parts of it, and would otherwise turn (and
    // disappear) with it. See .landing-chip-layer.
    <div className="landing-chip-layer" aria-hidden>
      {CHIPS.map((chip) => (
        <div
          key={chip.text}
          className={`landing-mock-chip ${chip.primary ? '' : 'hidden md:inline-flex'}`}
          style={{ ...chip.style, animationDelay: chip.delay }}
        >
          <chip.icon size={13} className="text-[oklch(var(--lavender))]" />
          {chip.text}
        </div>
      ))}
    </div>
  );
}
