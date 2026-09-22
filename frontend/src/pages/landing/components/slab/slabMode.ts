import { useEnhancedViewport } from '../../viewport';

export type SlabMode = 'flat' | 'slab';

/**
 * Whether this visit gets the spinnable slab or the Tier-1 flat mock.
 *
 * The threshold itself lives in ../../viewport, shared with the orb and the
 * scroll engine — they have to agree, and when they did not, the two that
 * disagreed silently did nothing on ordinary desktops.
 */
export function useSlabMode(): SlabMode {
  return useEnhancedViewport() ? 'slab' : 'flat';
}
