import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { watchSignals } from '../scroll/signals';

/**
 * Renders one frame whenever a scroll signal moves.
 *
 * A canvas pauses its frame loop when its part of the page is out of view,
 * which is right for work it does continuously — but it leaves a hole: a loop
 * that is asleep cannot notice that the thing it draws has changed, so it keeps
 * whatever pose it was holding when it stopped. Scrub back past the beat while
 * it sleeps and there is nothing to tell it to clear.
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
