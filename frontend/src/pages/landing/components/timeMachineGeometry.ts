/**
 * Where the light goes after the search card: out along the projection
 * timeline, and further from the eye the further into the future it lands.
 *
 * The three beats before this one each had a different source of truth. The
 * curve had maths, the search card had nothing but laid-out boxes. This one has
 * data: the section publishes real retention and at-risk/critical counts per
 * horizon, and the whole look of the landing is derived from them rather than
 * chosen. How many particles reach a horizon, how bright they stay and how far
 * they shift toward the critical colour are three readings of the same three
 * numbers — so retuning the projections retunes the beat, and the picture
 * cannot drift away from the figures printed beside it.
 */

/** Marks the elements the scroll engine aims the field at. Attributes rather
 *  than classes, same reasoning as CURVE_HOOK and SEARCH_HOOK. */
export const TM_HOOK = {
  /** The projections column: what the beat's ScrollTrigger is anchored to. */
  column: 'data-tm-column',
  /** One landing — a projection's retention bar. Its value is a key below. */
  landing: 'data-tm-landing',
} as const;

export interface Projection {
  /** Ties the row to its landing. */
  key: string;
  horizon: string;
  /** Percent of knowledge still held at this horizon. */
  retention: number;
  atRisk: number;
  critical: number;
}

/**
 * The section's own figures, and the field's only copy of them.
 *
 * Lives here rather than in TimeMachineSection because two things read it now:
 * the rows that print the numbers, and the beat that turns them into light. A
 * second copy would be a bug waiting for someone to retune one of them.
 *
 * Order is timeline order — nearest future first. Everything downstream relies
 * on that: the field is handed out in this order, so it arrives in it too.
 */
export const PROJECTIONS: readonly Projection[] = [
  { key: 'd7', horizon: '7 days', retention: 74, atRisk: 9, critical: 4 },
  { key: 'd30', horizon: '30 days', retention: 62, atRisk: 24, critical: 18 },
  { key: 'd90', horizon: '90 days', retention: 38, atRisk: 41, critical: 33 },
];

const RETENTION_TOTAL = PROJECTIONS.reduce((sum, p) => sum + p.retention, 0);
const RETENTION_MAX = Math.max(...PROJECTIONS.map((p) => p.retention));
const CRITICAL_MAX = Math.max(...PROJECTIONS.map((p) => p.critical));

export interface TimeMachineLanding {
  key: string;
  /** Share of the field that reaches this horizon. Sums to 1. */
  weight: number;
  /** How far toward the critical colour the light has gone by the time it
   *  settles here. 0 keeps the brand lavender, 1 is fully the danger token. */
  cool: number;
  /** Resting brightness, relative to the nearest horizon. */
  dim: number;
}

/**
 * The three readings.
 *
 * `weight` from retention, so fewer particles make it to each further horizon —
 * the field itself thins out into the future rather than merely changing
 * colour. `cool` from the critical count, which is the section's own word for
 * what has gone wrong, normalised against its own worst case so the far
 * horizon lands exactly on the danger colour. `dim` from retention again,
 * against the nearest horizon rather than the total, so the 7-day row sits at
 * full resting brightness and the others fall away from it.
 */
export const TM_LANDINGS: readonly TimeMachineLanding[] = PROJECTIONS.map((p) => ({
  key: p.key,
  weight: p.retention / RETENTION_TOTAL,
  cool: p.critical / CRITICAL_MAX,
  dim: p.retention / RETENTION_MAX,
}));
