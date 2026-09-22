import { Brain } from 'lucide-react';

/**
 * The slab's reverse side.
 *
 * Not a mirror of the dashboard — the point of a turnable object is that the
 * other side is worth turning to. This is the back of a product card: the
 * wordmark, the promise, and nothing else competing for attention.
 *
 * Live HTML like the front, so it themes and scales with everything else. All
 * of it is in .landing-slab-back* in landing.css.
 */
export function SlabBackFace() {
  return (
    <div className="landing-slab-back" aria-hidden>
      <div className="landing-slab-back-grid" />
      <div className="landing-slab-back-glow" />

      <div className="landing-slab-back-body">
        <span className="landing-slab-back-mark">
          <Brain size={34} strokeWidth={1.7} />
        </span>

        <p className="landing-slab-back-wordmark">Dory.md</p>
        <p className="landing-slab-back-tagline">Remember what matters.</p>

        <span className="landing-slab-back-rule" />

        <p className="landing-slab-back-kicker">Memory-aware notes</p>
      </div>

      <p className="landing-slab-back-footer">FSRS · Spaced repetition · AI recall</p>
    </div>
  );
}
