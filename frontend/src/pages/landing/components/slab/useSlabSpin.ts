import { useEffect, useRef, type RefObject } from 'react';

/**
 * Grab-to-spin plus idle drift for the hero's dashboard slab.
 *
 * Hand-rolled rather than a library, because the motion *is* the design here: a
 * slow revolving-door drift that a pointer can interrupt, throw, and hand back.
 *
 * It drives one CSS transform on the rotor element from a single rAF loop —
 * never React state, never a re-render. Angles are in degrees because that is
 * what CSS wants; the physics is the same either way.
 */

const DEG = 360;

/** One slow revolution every 26s. Fast enough to notice, slow enough to ignore. */
const AUTO_SPEED = DEG / 26;
/** e-folds per second that a thrown spin loses. */
const SPIN_DAMPING = 1.7;
/** deg/s below which the throw is over and the velocity snaps to zero. */
const SPIN_EPS = 1.2;
/** Quiet beat after the slab settles before the drift creeps back in. */
const RESUME_DELAY = 0.8;
/** How quickly idle drift blends back to full speed. */
const AUTO_RAMP = 0.9;

const YAW_PER_PX = 0.49;
const PITCH_PER_PX = 0.23;
/** Pitch is the secondary axis — let it move, but never enough to look broken. */
const MAX_PITCH = 21;
/** deg/s. Caps a flick so the slab never becomes a blur. */
const MAX_THROW = 400;
/** How fast pitch drifts home once the pointer lets go. */
const PITCH_HOME = 1.6;

/** A pointer that stopped moving before it lifted means "leave it here". */
const STALE_THROW_MS = 90;

const FLOAT_SPEED = 0.55;
const FLOAT_AMP_PX = 7;

/** Resting pose. The yaw matches the Tier-1 mock's fixed angle, so switching
 *  between the flat fallback and the slab does not move the picture. */
const REST_YAW = -13;
const REST_PITCH = 2;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Three decimals is well under a pixel at this size and keeps the style
 *  string short — it is rewritten every frame. */
const round = (v: number) => Math.round(v * 1000) / 1000;

interface SpinState {
  yaw: number;
  pitch: number;
  yawVel: number;
  pitchVel: number;
  clock: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
  lastT: number;
  sinceRelease: number;
  /** 0 while the user is in charge, 1 once idle drift has fully taken over. */
  auto: number;
}

function restState(): SpinState {
  return {
    yaw: REST_YAW,
    pitch: REST_PITCH,
    yawVel: 0,
    pitchVel: 0,
    clock: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    sinceRelease: RESUME_DELAY,
    auto: 1,
  };
}

function write(el: HTMLElement, s: SpinState, float: number) {
  // Read right-to-left: yaw, then pitch, then the float in the parent's frame —
  // the same order three.js applies an XYZ Euler, so the feel carries over.
  el.style.transform = `translateY(${round(float)}px) rotateX(${round(
    s.pitch,
  )}deg) rotateY(${round(s.yaw)}deg)`;
}

export interface SlabSpinOptions {
  /** The preserve-3d element whose transform is written each frame. */
  rotor: RefObject<HTMLElement | null>;
  /** The box that listens for the grab — usually the slab's outer bounds. */
  grab: RefObject<HTMLElement | null>;
  /** False on the flat fallback and under reduced motion: park it and stop. */
  enabled: boolean;
}

export function useSlabSpin({ rotor, grab, enabled }: SlabSpinOptions) {
  const spin = useRef<SpinState>(restState());

  useEffect(() => {
    const el = rotor.current;
    const surface = grab.current;
    if (!el || !surface) return;

    if (!enabled) {
      // Facing front, dead still. Clearing the inline value hands the pose back
      // to the stylesheet rather than freezing whatever the last frame wrote.
      el.style.transform = '';
      return;
    }

    const s = (spin.current = restState());
    // Paint the resting pose now; without it the first frame pops from flat.
    write(el, s, 0);

    // ── grab ────────────────────────────────────────────────────────────────
    const onDown = (e: PointerEvent) => {
      s.dragging = true;
      s.yawVel = 0;
      s.pitchVel = 0;
      s.auto = 0;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.lastT = e.timeStamp;
      surface.dataset.grabbing = 'true';
      surface.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!s.dragging) return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      // A 240Hz pointer can report two events in the same millisecond; floor
      // the interval so the derived velocity cannot blow up.
      const dt = Math.max((e.timeStamp - s.lastT) / 1000, 1 / 240);
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.lastT = e.timeStamp;

      const dYaw = dx * YAW_PER_PX;
      const dPitch = dy * PITCH_PER_PX;
      s.yaw += dYaw;
      s.pitch = clamp(s.pitch + dPitch, -MAX_PITCH, MAX_PITCH);

      // Smoothed, so the throw reflects the gesture rather than its last frame.
      s.yawVel = clamp(s.yawVel * 0.6 + (dYaw / dt) * 0.4, -MAX_THROW, MAX_THROW);
      s.pitchVel = clamp(s.pitchVel * 0.6 + (dPitch / dt) * 0.4, -MAX_THROW, MAX_THROW);
    };

    const onUp = (e: PointerEvent) => {
      if (!s.dragging) return;
      s.dragging = false;
      s.sinceRelease = 0;
      if (e.timeStamp - s.lastT > STALE_THROW_MS) {
        s.yawVel = 0;
        s.pitchVel = 0;
      }
      delete surface.dataset.grabbing;
      if (surface.hasPointerCapture(e.pointerId)) {
        surface.releasePointerCapture(e.pointerId);
      }
    };

    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('pointercancel', onUp);

    // ── the loop ────────────────────────────────────────────────────────────
    let raf = 0;
    let previous = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // A backgrounded tab hands back one enormous delta; cap it or the slab
      // teleports on return.
      const dt = previous ? Math.min((now - previous) / 1000, 1 / 20) : 0;
      previous = now;
      s.clock += dt;

      if (!s.dragging) {
        s.yaw += s.yawVel * dt;
        s.pitch = clamp(s.pitch + s.pitchVel * dt, -MAX_PITCH, MAX_PITCH);

        const decay = Math.exp(-SPIN_DAMPING * dt);
        s.yawVel *= decay;
        s.pitchVel *= decay;
        if (Math.abs(s.yawVel) < SPIN_EPS) s.yawVel = 0;
        if (Math.abs(s.pitchVel) < SPIN_EPS) s.pitchVel = 0;

        s.sinceRelease += dt;
        const settled = s.yawVel === 0 && s.pitchVel === 0 && s.sinceRelease > RESUME_DELAY;
        s.auto += ((settled ? 1 : 0) - s.auto) * (1 - Math.exp(-AUTO_RAMP * dt));
        s.yaw += AUTO_SPEED * s.auto * dt;

        s.pitch += (REST_PITCH - s.pitch) * (1 - Math.exp(-PITCH_HOME * dt));
      }

      // Keep yaw in one turn's worth of range; it accumulates forever otherwise.
      if (s.yaw > DEG) s.yaw -= DEG;
      else if (s.yaw < -DEG) s.yaw += DEG;

      write(el, s, Math.sin(s.clock * FLOAT_SPEED) * FLOAT_AMP_PX);
    };

    const start = () => {
      if (raf) return;
      previous = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    // Scrolled past the hero, the slab has no business holding a frame loop.
    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { rootMargin: '120px' },
    );
    io.observe(surface);

    return () => {
      stop();
      io.disconnect();
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onUp);
      delete surface.dataset.grabbing;
    };
  }, [enabled, rotor, grab]);
}
