/**
 * Where the light ends up: gathered back into a single card.
 *
 * Every beat before this one spread the field wider than it found it — down a
 * curve, across a search card's rows, out along three horizons of a projection.
 * This one runs the other way, and that is the point of it: one target, and the
 * ninety particles scattered over the time machine's timeline contract onto it.
 *
 * So there is no weight table here. There is nothing to share out.
 */

/** Marks the elements the scroll engine aims the field at. Attributes rather
 *  than classes, same reasoning as CURVE_HOOK, SEARCH_HOOK and TM_HOOK. */
export const REVIEW_HOOK = {
  /** The flashcard: what the beat's ScrollTrigger is anchored to. */
  card: 'data-review-card',
  /**
   * And what the field actually closes onto — the recall medallion on the card.
   *
   * Two hooks rather than one, because the card is the wrong size to be a
   * target. The time machine leaves the field spread over roughly 150x160px of
   * projection bars; this card is 564x321, so gathering "onto the card" would
   * have been the field spreading out again with a different shape. The beat is
   * a contraction or it is nothing, so it aims at the one small thing on the
   * card that the whole section is about.
   */
  gather: 'data-review-gather',
} as const;

/** The single landing, as a list, because that is the shape LandingFrame takes
 *  and a beat that gathers onto one thing should not need its own machinery. */
export const REVIEW_LANDINGS: readonly string[] = [''];

/** What the medallion reads. The same figure the time machine's furthest
 *  horizon lands on — this is a note at the bottom of its curve, which is why
 *  it is due, and why the reddest light in the field gathers into it. */
export const RECALL_PCT = 38;

export interface Grade {
  label: string;
  /** What FSRS would schedule next for this answer. */
  interval: string;
  /** Token for the pip beside it. */
  tone: string;
}

/** The four answers FSRS asks for, worst to best. The intervals are the shape
 *  an early review really produces — minutes if it has gone, days if it held. */
export const GRADES: readonly Grade[] = [
  { label: 'Again', interval: '<1m', tone: 'var(--danger)' },
  { label: 'Hard', interval: '2d', tone: 'var(--weak)' },
  { label: 'Good', interval: '5d', tone: 'var(--good)' },
  { label: 'Easy', interval: '12d', tone: 'oklch(var(--lavender))' },
];
