import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { watchSignals } from '../scroll/signals';

/**
 * Renders one frame whenever a scroll signal moves.
 *
 * Both canvases pause their frame loop when their part of the page is out of
 * view, which is right for the work they do continuously — but it leaves a hole
 * the size of this bug: a loop that is asleep cannot notice that the thing it
 * draws has changed, so it keeps whatever pose it was holding when it stopped.
 * Scroll down past the hero and the orb parks itself dimmed; scroll back and
 * there is nothing to tell it the light came back.
 *
 * Rather than trying to guarantee the loop is awake at exactly the right
 * moments, this removes the failure mode: a signal change always buys at least
 * one frame, awake or not. Drop it into any canvas that reads scrollSignals.
 */
export function WakeOnSignals() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => watchSignals(() => invalidate()), [invalidate]);
  return null;
}
