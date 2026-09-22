import { useEnhancedViewport } from '../../viewport';

/**
 * Who gets the WebGL orb, and what colour it is.
 *
 * Free of any `three` import on purpose: HeroOrb is in the eager landing
 * bundle and has to be able to decide *not* to load the canvas. Everything
 * WebGL lives behind the lazy ./OrbCanvas chunk.
 */

let webglCache: boolean | null = null;

/** True when the browser can actually give us a WebGL context. Probes once and
 *  immediately drops the probe context — contexts are scarce and we should not
 *  spend one of the browser's handful on a feature test. */
export function hasWebGL(): boolean {
  if (webglCache !== null) return webglCache;
  try {
    const canvas = document.createElement('canvas');
    const ctx =
      canvas.getContext('webgl2') ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    webglCache = ctx !== null;
    ctx?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglCache = false;
  }
  return webglCache;
}

/** Whether to mount the orb at all. The width half is the page-wide gate; the
 *  orb only adds the requirement that WebGL actually exists. */
export function useOrbEnabled(): boolean {
  return useEnhancedViewport() && hasWebGL();
}

/** Literal fallback: the sRGB rendering of the light theme's --lavender. */
export const LAVENDER_FALLBACK = '#c3b9ff';

/**
 * Resolves a CSS colour expression — including `var(--token)` and `oklch()` —
 * to a plain `#rrggbb` literal that WebGL can use.
 *
 * three has no CSS parser: `new Color('oklch(0.82 0.1 290)')` means nothing to
 * it, and the app's tokens are stored as bare oklch *components*
 * (`--lavender: 0.82 0.10 290`). So substitute the custom properties by hand,
 * then let the 2D canvas — which does speak oklch — do the conversion and read
 * the sRGB bytes back out.
 */
export function cssColorHex(expr: string, fallback: string): string {
  try {
    const root = getComputedStyle(document.documentElement);
    const resolved = expr.replace(/var\((--[a-z0-9-]+)\)/gi, (_match, name: string) =>
      root.getPropertyValue(name).trim(),
    );
    if (!resolved || resolved.includes('var(')) return fallback;

    const ctx = document
      .createElement('canvas')
      .getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;

    // An unparseable value leaves fillStyle untouched, so seed it with the
    // fallback: whatever comes back is either the real colour or the fallback,
    // never a surprise black.
    ctx.fillStyle = fallback;
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);

    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  } catch {
    return fallback;
  }
}
