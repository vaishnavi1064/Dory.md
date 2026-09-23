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
