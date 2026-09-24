/**
 * Timing shared between a signal's writer and its readers.
 *
 * Numbers live here when two sides have to agree about *when* something happens
 * inside a span — the scroll engine placing a tween, and a render loop deciding
 * what a signal means at a given value. Two copies of one of these is a bug
 * that only shows up as "the timing feels slightly off".
 */

/**
 * The slice of `curveSeed` any one particle spends in flight.
 *
 * Particles leave in order along the curve, so the last one starts at
 * `1 - PARTICLE_TRAVEL` and everything has landed exactly at 1. Which means the
 * landings run from `PARTICLE_TRAVEL` to 1 — the window the curve's own line
 * draws across, so its leading edge sits where the particles are arriving.
 */
export const PARTICLE_TRAVEL = 0.62;

/**
 * The slice of `searchSeed` any one particle spends crossing from the curve to
 * its landing on the search card.
 *
 * Larger than PARTICLE_TRAVEL because this leg has nothing drawing along with
 * it. The curve's line had to be written by the arrivals, which pinned that
 * number to the chart; here the only constraint is that the field should be in
 * motion for most of the span rather than snapping into place and waiting, so
 * the departures are packed into the first `1 - SEARCH_TRAVEL` of it.
 */
export const SEARCH_TRAVEL = 0.55;

/**
 * The slice of `tmSeed` any one particle spends crossing to its horizon.
 *
 * Shorter than SEARCH_TRAVEL, which spreads the departures wider. The search
 * card's landings sit within a few dozen pixels of each other and reading them
 * as an order needed help; the projection rows are a column with a direction
 * already built into it, so a longer stagger is what makes the field arrive
 * visibly nearest-first rather than all at once.
 */
export const TM_TRAVEL = 0.45;

/**
 * The slice of `reviewSeed` any one particle spends closing on the card.
 *
 * The longest of the four, which is what makes this leg read as a gathering
 * rather than a move. A short travel with a wide stagger arrives in ranks; here
 * almost every particle is in the air at once and they tighten together, so the
 * contraction is something you watch happen to the whole field.
 */
export const REVIEW_TRAVEL = 0.78;

/**
 * The slice of `ctaSeed` any one particle spends reforming into the CTA glow.
 *
 * The widest of all of them, and for the opposite reason to the others. Every
 * earlier leg wanted an order you could read — light leaving in curve order,
 * rows filling nearest-first. This one wants no order at all: the field is
 * coming to rest for the last time, and a stagger you can follow would make the
 * ending look like a queue. At this width the departures are nearly together
 * and the whole cluster settles as one thing.
 */
export const CTA_TRAVEL = 0.88;
