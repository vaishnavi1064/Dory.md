/**
 * Where the light finally rests: the glow behind the closing call to action.
 *
 * This one closes a loop rather than opening anything. The story begins with
 * the field leaving `.landing-slab-glow` behind the hero's dashboard and ends
 * with it reforming into `.landing-cta-glow` behind the last thing on the page
 * — the same kind of element, the same brand colour, the same job of being a
 * soft light with a stable box. The hero's glow exists because the beat needed
 * a source; this one exists because the beat needed a destination, and the two
 * being twins is the point.
 *
 * NOT THE EXISTING <GlowOrb>. The final CTA already has one, and it is the
 * wrong thing to aim at twice over: `.landing-orb` runs a 13-second drift
 * keyframe that translates and scales it, so its rect moves every frame and the
 * field would chase it; and three of them render on the page, so there is no
 * selector that means "this one". The glow below is static, hooked, and its own
 * element.
 */

/** Marks the elements the scroll engine aims the field at. Attributes rather
 *  than classes, same reasoning as every hook before it. */
export const CTA_HOOK = {
  /** The glow behind the CTA: both the beat's anchor and its one landing. */
  glow: 'data-cta-glow',
} as const;

/** The single landing, as a list, because that is the shape LandingFrame takes.
 *  Same reasoning as REVIEW_LANDINGS. */
export const CTA_LANDINGS: readonly string[] = [''];
