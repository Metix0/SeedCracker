/**
 * Light/dark collision rules (pure functions — unit tested in tests/collision.test.ts).
 *
 * Every two-sided object has an orientation `rot`. Its LIGHT half is the half-plane
 * in front of the normal n = (cos rot, sin rot); the DARK half is behind it.
 * The side that was hit is decided by the direction of the CONTACT POINT relative
 * to that normal — not merely by "the circles overlap".
 *
 *  - Light hits use the full visual radius (smashing feels generous).
 *  - Dark hits use a hitbox ~15% smaller than the visuals (dying feels fair).
 *  - Contacts on (or within a small tolerance of) the boundary count as LIGHT.
 *  - With the Prism booster everything is smashable.
 */
import { CFG } from '../config';

export const SIDE_NONE = 0;
export const SIDE_LIGHT = 1;
export const SIDE_DARK = 2;
export type Side = 0 | 1 | 2;

const H = CFG.hitbox;

/** Cosine of the contact direction against the light normal: +1 dead-center light, -1 dead-center dark. */
export function contactCos(cx: number, cy: number, rot: number, px: number, py: number): number {
  const dx = px - cx, dy = py - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return 0; // exactly at the center: boundary → player's favour
  return (dx * Math.cos(rot) + dy * Math.sin(rot)) / d;
}

/** Two-sided disk (half-shaded orb, falling orb, comet). */
export function halfDiskContact(
  cx: number, cy: number, rot: number, radius: number,
  sx: number, sy: number, sr: number,
  prism: boolean,
): Side {
  const dx = sx - cx, dy = sy - cy;
  const d2 = dx * dx + dy * dy;
  const lightReach = radius * H.lightScale + sr;
  if (d2 >= lightReach * lightReach) return SIDE_NONE;
  if (prism) return SIDE_LIGHT;
  const c = contactCos(cx, cy, rot, sx, sy);
  if (c >= -H.boundaryEps) return SIDE_LIGHT;
  const darkReach = (radius + sr) * H.darkScale;
  return d2 < darkReach * darkReach ? SIDE_DARK : SIDE_NONE;
}

/** Fully dark disk (void orb, mine body, the core itself). */
export function darkDiskContact(
  cx: number, cy: number, radius: number,
  sx: number, sy: number, sr: number,
  prism: boolean,
): Side {
  const dx = sx - cx, dy = sy - cy;
  const d2 = dx * dx + dy * dy;
  if (prism) {
    const r = radius + sr;
    return d2 < r * r ? SIDE_LIGHT : SIDE_NONE;
  }
  const r = (radius + sr) * H.darkScale;
  return d2 < r * r ? SIDE_DARK : SIDE_NONE;
}

/** Distance from the spark to the dark boundary (for near-miss detection); Infinity when not applicable. */
export function halfDiskDarkGap(
  cx: number, cy: number, rot: number, radius: number,
  sx: number, sy: number, sr: number,
): number {
  const c = contactCos(cx, cy, rot, sx, sy);
  if (c >= -H.boundaryEps) return Infinity;
  const dx = sx - cx, dy = sy - cy;
  return Math.sqrt(dx * dx + dy * dy) - radius - sr;
}

// ---------------------------------------------------------------- triangles

// Unit equilateral triangle (circumradius 1), apex on +y, split by the x=0 axis:
// x >= 0 is LIGHT (normal = local +x).
const TX0 = 0, TY0 = 1;
const TX1 = -0.8660254, TY1 = -0.5;
const TX2 = 0.8660254, TY2 = -0.5;

// Scratch output (avoid allocations): closest point
let qx = 0, qy = 0;

/** Closest point on triangle (scaled by s) to local point (px,py). Result in qx,qy. */
function closestOnTri(px: number, py: number, s: number): void {
  const ax = TX0 * s, ay = TY0 * s, bx = TX1 * s, by = TY1 * s, cx = TX2 * s, cy = TY2 * s;
  const abx = bx - ax, aby = by - ay, acx = cx - ax, acy = cy - ay;
  const apx = px - ax, apy = py - ay;
  const d1 = abx * apx + aby * apy, d2 = acx * apx + acy * apy;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; return; }
  const bpx = px - bx, bpy = py - by;
  const d3 = abx * bpx + aby * bpy, d4 = acx * bpx + acy * bpy;
  if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    qx = ax + abx * v; qy = ay + aby * v; return;
  }
  const cpx = px - cx, cpy = py - cy;
  const d5 = abx * cpx + aby * cpy, d6 = acx * cpx + acy * cpy;
  if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    qx = ax + acx * w; qy = ay + acy * w; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; return;
  }
  // inside
  qx = px; qy = py;
}

/** Two-sided spinning triangle (shard). `size` = circumradius. */
export function shardContact(
  cx: number, cy: number, rot: number, size: number,
  sx: number, sy: number, sr: number,
  prism: boolean,
): Side {
  // to local space
  const dx = sx - cx, dy = sy - cy;
  const c = Math.cos(-rot), s = Math.sin(-rot);
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  // light test with the full triangle
  closestOnTri(lx, ly, size * H.lightScale);
  let ex = lx - qx, ey = ly - qy;
  if (ex * ex + ey * ey >= sr * sr) return SIDE_NONE;
  if (prism) return SIDE_LIGHT;
  if (qx >= -H.boundaryEps * size) return SIDE_LIGHT;
  // dark test with shrunken triangle + shrunken spark
  closestOnTri(lx, ly, size * H.darkScale);
  ex = lx - qx; ey = ly - qy;
  const r = sr * H.darkScale;
  if (ex * ex + ey * ey >= r * r) return SIDE_NONE;
  return qx >= -H.boundaryEps * size ? SIDE_LIGHT : SIDE_DARK;
}

// ---------------------------------------------------------------- rings & waves

export const RING_NONE = 0;
export const RING_RIM = 1;
export const RING_THREAD = 2;

/**
 * Hoop. Returns THREAD when the spark is (mostly) inside the hole, RIM when it overlaps the
 * rim band, NONE otherwise. The world tracks "engaged → left without threading" = rim smash.
 */
export function ringContact(
  cx: number, cy: number, radius: number, thickness: number,
  sx: number, sy: number, sr: number,
): number {
  const dx = sx - cx, dy = sy - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < radius - thickness * 0.5 - sr * 0.3) return RING_THREAD;
  if (Math.abs(d - radius) < thickness * 0.5 + sr) return RING_RIM;
  return RING_NONE;
}

/** Expanding mine shock wave: a band of given radius. */
export function waveContact(cx: number, cy: number, radius: number, band: number, sx: number, sy: number, sr: number): boolean {
  const dx = sx - cx, dy = sy - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.abs(d - radius) < (band * 0.5 + sr) * H.darkScale;
}

/** Distance from point to segment a→b. */
export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + abx * t), ey = py - (ay + aby * t);
  return Math.sqrt(ex * ex + ey * ey);
}

/** Number of sub-steps needed so that neither body moves more than ~40% of the spark radius per sub-step. */
export function subSteps(relMove: number, sr: number): number {
  const n = Math.ceil(relMove / (sr * 0.4));
  return n < 1 ? 1 : n > 16 ? 16 : n;
}
