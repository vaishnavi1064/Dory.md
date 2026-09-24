/**
 * Where the light goes after the forgetting curve.
 *
 * The curve had a model behind it — sampleCurve() put every particle on a real
 * point of R(t) = e^(-t/S). There is no equivalent maths here: the Smart search
 * card is laid out by the browser, so the geometry is whatever the elements
 * measure at, read live through getBoundingClientRect (see particles/anchors).
 * What lives in this file is the part that is a decision rather than a
 * measurement — which elements catch the light, in what order, and with how
 * much of the field each.
 *
 * WHAT THIS IS NOT, YET. The beat wants search *results* to land on, and the
 * card has none: it is a feature blurb with a query and four ranking-signal
 * tags, not a results list. So the landings below are the real elements that
 * exist. If result rows are ever added to SmartSearchCard, retargeting is this
 * list plus the hooks in the markup — nothing in the field or the signal knows
 * what it is aiming at.
 */

/** Marks the elements the scroll engine aims the field at. Attributes rather
 *  than classes, so restyling the card cannot quietly unhook the beat — same
 *  reasoning as CURVE_HOOK. */
export const SEARCH_HOOK = {
  /** The card itself: what the beat's ScrollTrigger is anchored to. */
  card: 'data-search-card',
  /** One landing. Its value is a key below. */
  landing: 'data-search-landing',
} as const;

export interface SearchLanding {
  /** Value of the landing attribute on the element. */
  key: string;
  /** Share of the field that comes to rest here. Sums to 1. */
  weight: number;
}

/**
 * The landings, in the order they light up.
 *
 * Order is the whole point of the arrangement. Particles are handed out in
 * index order, and index order along the curve runs left to right — early
 * indices sit at the top of the curve where retention is still high, late ones
 * in the flat tail where it has decayed to nothing. Putting `decay` last
 * therefore does two things at once: the eye finishes on the tag that explains
 * the ranking, and the particles that land on it are the ones that were lying
 * in the most-forgotten part of the curve.
 *
 * The weights are a share of a fixed field, not a density: the query row is
 * four times the width of a tag, so an even split would leave it sparse and the
 * tags packed solid.
 */
export const SEARCH_LANDINGS: readonly SearchLanding[] = [
  { key: 'query', weight: 0.28 },
  { key: 'semantic', weight: 0.16 },
  { key: 'recency', weight: 0.15 },
  { key: 'hybrid', weight: 0.15 },
  { key: 'decay', weight: 0.26 },
] as const;
