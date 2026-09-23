/**
 * The forgetting curve's geometry, separated from its rendering.
 *
 * R(t) = e^(-t / S), sampled rather than hand-drawn — it is the same model the
 * product uses, so the marketing chart should not be a doodle. The x axis is
 * logarithmic so 1 day / 1 week / 1 month land evenly spaced, which is how the
 * forgetting curve is conventionally shown.
 *
 * This lives apart from ForgettingCurve.tsx because two things now need it: the
 * SVG that draws the line, and the particle field that has to come to rest
 * along it. One of them reading a second copy of the maths would be a bug
 * waiting for someone to tune the curve.
 */

export const VIEWBOX = { width: 340, height: 190 };
export const PAD = { top: 12, right: 14, bottom: 26, left: 32 };

export const T_MIN = 0.25; // 6 hours
export const T_MAX = 30; // one month
export const S = 6; // stability, in days — tuned for the classic curve shape

const plotW = VIEWBOX.width - PAD.left - PAD.right;
const plotH = VIEWBOX.height - PAD.top - PAD.bottom;

export function xOf(days: number) {
  const ratio = Math.log(days / T_MIN) / Math.log(T_MAX / T_MIN);
  return PAD.left + ratio * plotW;
}

export function yOf(retention: number) {
  return PAD.top + (1 - retention) * plotH;
}

/** Days at position `u` along the curve, u in 0..1. */
export function daysAt(u: number) {
  return T_MIN * Math.pow(T_MAX / T_MIN, u);
}

export function retentionAt(days: number) {
  return Math.exp(-days / S);
}

export interface CurvePoint {
  x: number;
  y: number;
}

/**
 * `count` points spread along the curve in viewBox units. Even in u means even
 * along the drawn line, because the x axis is already logarithmic.
 *
 * Allocates — call it once at setup, never per frame.
 */
export function sampleCurve(count: number): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const u = count === 1 ? 0.5 : i / (count - 1);
    const days = daysAt(u);
    points.push({ x: xOf(days), y: yOf(retentionAt(days)) });
  }
  return points;
}

/** The SVG path data for the line itself. */
export function buildCurvePath() {
  const steps = 72;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const days = daysAt(i / steps);
    parts.push(
      `${i === 0 ? 'M' : 'L'}${xOf(days).toFixed(2)} ${yOf(retentionAt(days)).toFixed(2)}`,
    );
  }
  return parts.join(' ');
}

export const CURVE_PATH = buildCurvePath();

/** The same line closed down to the baseline, for the area wash. */
export const CURVE_AREA = `${CURVE_PATH} L${xOf(T_MAX).toFixed(2)} ${yOf(0).toFixed(
  2,
)} L${xOf(T_MIN).toFixed(2)} ${yOf(0).toFixed(2)} Z`;

/** Marks the elements the scroll engine takes over. Attributes rather than
 *  classes, so a styling change cannot quietly unhook the animation. */
export const CURVE_HOOK = {
  svg: 'data-curve-svg',
  line: 'data-curve-line',
  area: 'data-curve-area',
  dot: 'data-curve-dot',
} as const;
