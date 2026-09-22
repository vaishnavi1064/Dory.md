import { type RefObject, useRef } from 'react';
import { DashboardMock } from '../DashboardMock';
import { SlabBackFace } from './SlabBackFace';
import { useSlabSpin } from './useSlabSpin';

/**
 * The hero's dashboard as a solid, spinnable object — built out of CSS 3D
 * transforms rather than WebGL.
 *
 * That choice is the whole point. An earlier pass rendered the dashboard to a
 * texture and mapped it onto a three.js slab; the text went soft, because a
 * screenshot of type is not type. Here the front face *is* the live
 * <DashboardMock> — real DOM, real fonts, rasterised by the browser at device
 * resolution, and themed by the same tokens as everything else.
 *
 * The box is the classic six-plane construction: a preserve-3d rotor, the front
 * and back pushed out to ±half the depth, and four strips standing on edge
 * between them. Only the front face sits in normal flow, so the mock's natural
 * size is the slab's size and nothing here needs measuring in JS.
 *
 * Geometry lives in landing.css (.landing-slab-face / .landing-slab-edge) —
 * the transforms are unreadable inline and belong next to each other.
 */

interface Slab3DProps {
  /** The outer box that fields the grab. Owned by DashboardSlab, because the
   *  hit target should be the mock's footprint, not whatever the rotor happens
   *  to be showing mid-spin. */
  grab: RefObject<HTMLElement | null>;
  /** The OS asked for less motion: no drift, no float, no inertia. Still
   *  draggable — see useSlabSpin. */
  reduced: boolean;
}

export function Slab3D({ grab, reduced }: Slab3DProps) {
  const rotor = useRef<HTMLDivElement>(null);

  useSlabSpin({ rotor, grab, reduced });

  return (
    <div className="landing-slab-rotor" ref={rotor}>
      {/* In flow: this is what gives the rotor — and so every absolutely
          positioned face below — its size. */}
      <div className="landing-slab-face landing-slab-face-front">
        <DashboardMock />
      </div>

      <div className="landing-slab-face landing-slab-face-back">
        <SlabBackFace />
      </div>

      {/* The four sides. Thin, but real: turn the slab and you see a solid rim
          rather than two cards back to back. */}
      <span className="landing-slab-edge landing-slab-edge-t" aria-hidden />
      <span className="landing-slab-edge landing-slab-edge-b" aria-hidden />
      <span className="landing-slab-edge landing-slab-edge-l" aria-hidden />
      <span className="landing-slab-edge landing-slab-edge-r" aria-hidden />
    </div>
  );
}
