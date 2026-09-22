import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { DashboardMock } from './DashboardMock';
import { Slab3D } from './slab/Slab3D';
import { useSlabMode } from './slab/slabMode';
import { mockEntrance, useMotionPolicy } from '../motion';

/**
 * The hero's product shot, in two forms.
 *
 *   flat  the Tier-1 picture: <DashboardMock> at a fixed angle with a cursor
 *         tilt. Narrow screens, where a spinnable object has no room and no
 *         obvious affordance.
 *   slab  the same mock as the front face of a real CSS 3D slab you can grab
 *         and turn — back face, thickness and all.
 *
 * Both hang off the same box, so the hero's layout does not know which one it
 * got. The perspective lives here rather than on Hero's .landing-stage: the
 * stage only lends perspective to its own children, and both of these are a
 * level deeper.
 */

/** How far the flat mock rotates toward the pointer, in degrees. Small on
 *  purpose — it should read as parallax, not as a toy. */
const TILT = 6;

/** The flat mock's resting angle. Matches REST_YAW in useSlabSpin so the two
 *  modes show the picture from the same place. */
const BASE_ROTATE_Y = -13;

function useCursorTilt(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const spring = { stiffness: 120, damping: 18, mass: 0.6 };
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-TILT, TILT]), spring);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [TILT, -TILT]), spring);

  function onPointerMove(e: React.PointerEvent) {
    // Coarse pointers (touch) have no hover state to track, and reduced-motion
    // users opted out of exactly this kind of continuous movement.
    if (!enabled || e.pointerType !== 'mouse') return;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    x.set((e.clientX - box.left) / box.width - 0.5);
    y.set((e.clientY - box.top) / box.height - 0.5);
  }

  function onPointerLeave() {
    x.set(0);
    y.set(0);
  }

  return { ref, rotateX, rotateY, onPointerMove, onPointerLeave };
}

export function DashboardSlab() {
  const { reduced, variants } = useMotionPolicy();
  const mode = useSlabMode();
  const grab = useRef<HTMLDivElement>(null);
  const tilt = useCursorTilt(!reduced && mode === 'flat');

  const spinnable = mode === 'slab';

  return (
    // The entrance rides the outer box, not the scene: it tilts on rotateX and
    // needs the perspective .landing-stage lends *its own* children, which the
    // scene (a level deeper) would not get.
    <motion.div
      className="landing-slab"
      ref={grab}
      data-mode={mode}
      data-grab={spinnable ? 'on' : 'off'}
      variants={variants(mockEntrance)}
      initial="hidden"
      animate="shown"
    >
      <div className="landing-slab-shade" />

      <div className="landing-slab-scene">
        {spinnable ? (
          <Slab3D grab={grab} reduced={reduced} />
        ) : (
          <motion.div
            className="landing-tilt"
            ref={tilt.ref}
            onPointerMove={tilt.onPointerMove}
            onPointerLeave={tilt.onPointerLeave}
            style={reduced ? undefined : { rotateX: tilt.rotateX, rotateY: tilt.rotateY }}
          >
            <div style={{ transform: `rotateY(${reduced ? 0 : BASE_ROTATE_Y}deg)` }}>
              <DashboardMock />
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
