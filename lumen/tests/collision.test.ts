import { describe, expect, it } from 'vitest';
import { CFG } from '../src/config';
import {
  RING_NONE, RING_RIM, RING_THREAD, SIDE_DARK, SIDE_LIGHT, SIDE_NONE,
  contactCos, darkDiskContact, halfDiskContact, halfDiskDarkGap, ringContact, shardContact, subSteps, waveContact,
} from '../src/game/collision';

const R = 60; // obstacle radius
const SR = 16; // spark radius
const touch = R + SR - 2; // overlapping distance (inside the light reach)

/** spark position at distance d from the origin in direction angle a */
const at = (a: number, d: number): [number, number] => [Math.cos(a) * d, Math.sin(a) * d];

describe('two-sided disk (half-shaded orb)', () => {
  it('hitting the LIGHT side smashes it', () => {
    // light normal points to +x (rot = 0); the spark touches from the right
    const [x, y] = at(0, touch);
    expect(halfDiskContact(0, 0, 0, R, x, y, SR, false)).toBe(SIDE_LIGHT);
    // 60° off the normal is still clearly the light half
    const [x2, y2] = at(Math.PI / 3, touch);
    expect(halfDiskContact(0, 0, 0, R, x2, y2, SR, false)).toBe(SIDE_LIGHT);
  });

  it('touching the DARK side kills (once inside the forgiving hitbox)', () => {
    const deep = (R + SR) * CFG.hitbox.darkScale - 1;
    const [x, y] = at(Math.PI, deep);
    expect(halfDiskContact(0, 0, 0, R, x, y, SR, false)).toBe(SIDE_DARK);
  });

  it('dark hitbox is ~15% smaller than the visuals (grazing the dark edge is safe)', () => {
    const visualTouch = R + SR - 1;
    const [x, y] = at(Math.PI, visualTouch);
    expect(halfDiskContact(0, 0, 0, R, x, y, SR, false)).toBe(SIDE_NONE);
  });

  it('respects the CURRENT orientation, not just overlap', () => {
    // same spark position, object rotated by 180° → dark side now faces the spark
    const deep = (R + SR) * CFG.hitbox.darkScale - 1;
    const [x, y] = at(0, deep);
    expect(halfDiskContact(0, 0, 0, R, x, y, SR, false)).toBe(SIDE_LIGHT);
    expect(halfDiskContact(0, 0, Math.PI, R, x, y, SR, false)).toBe(SIDE_DARK);
    // rotated by 90°: the light normal points down (+y); contact from below is light
    const [x2, y2] = at(Math.PI / 2, touch);
    expect(halfDiskContact(0, 0, Math.PI / 2, R, x2, y2, SR, false)).toBe(SIDE_LIGHT);
  });

  it('contact exactly on the light/dark boundary goes to the player', () => {
    const deep = (R + SR) * CFG.hitbox.darkScale - 1;
    // exactly perpendicular to the normal (cos = 0)
    const [x, y] = at(Math.PI / 2, deep);
    expect(contactCos(0, 0, 0, x, y)).toBeCloseTo(0, 6);
    expect(halfDiskContact(0, 0, 0, R, x, y, SR, false)).toBe(SIDE_LIGHT);
    // slightly into the dark half, still within the tolerance band
    const eps = Math.asin(CFG.hitbox.boundaryEps) * 0.9;
    const [x2, y2] = at(Math.PI / 2 + eps, deep);
    expect(halfDiskContact(0, 0, 0, R, x2, y2, SR, false)).toBe(SIDE_LIGHT);
    // clearly past the tolerance → dark
    const [x3, y3] = at(Math.PI / 2 + eps * 3, deep);
    expect(halfDiskContact(0, 0, 0, R, x3, y3, SR, false)).toBe(SIDE_DARK);
  });

  it('with Prism every contact smashes, even the dark side', () => {
    const [x, y] = at(Math.PI, touch);
    expect(halfDiskContact(0, 0, 0, R, x, y, SR, true)).toBe(SIDE_LIGHT);
  });

  it('no contact when apart', () => {
    const [x, y] = at(0.3, R + SR + 5);
    expect(halfDiskContact(0, 0, 0, R, x, y, SR, false)).toBe(SIDE_NONE);
    expect(halfDiskContact(0, 0, 0, R, x, y, SR, true)).toBe(SIDE_NONE);
  });

  it('dark gap is reported only on the dark side (near-miss)', () => {
    const [x, y] = at(Math.PI, R + SR + 10);
    expect(halfDiskDarkGap(0, 0, 0, R, x, y, SR)).toBeCloseTo(10, 5);
    const [x2, y2] = at(0, R + SR + 10);
    expect(halfDiskDarkGap(0, 0, 0, R, x2, y2, SR)).toBe(Infinity);
  });
});

describe('fully dark objects (void orb, core, mine)', () => {
  it('kills without Prism, smashes with Prism', () => {
    expect(darkDiskContact(0, 0, 20, 30, 0, SR, false)).toBe(SIDE_DARK);
    expect(darkDiskContact(0, 0, 20, 30, 0, SR, true)).toBe(SIDE_LIGHT);
    expect(darkDiskContact(0, 0, 20, 60, 0, SR, false)).toBe(SIDE_NONE);
  });
});

describe('shards (two-sided triangles)', () => {
  const S = 24;
  it('light side (local +x) smashes', () => {
    expect(shardContact(0, 0, 0, S, S * 0.45 + SR - 2, 0, SR, false)).toBe(SIDE_LIGHT);
  });
  it('dark side (local -x) kills when deep enough', () => {
    expect(shardContact(0, 0, 0, S, -(S * 0.43 + SR * CFG.hitbox.darkScale - 4), 0, SR, false)).toBe(SIDE_DARK);
  });
  it('rotation flips the sides', () => {
    const x = -(S * 0.43 + SR * CFG.hitbox.darkScale - 4);
    expect(shardContact(0, 0, Math.PI, S, x, 0, SR, false)).toBe(SIDE_LIGHT);
  });
  it('apex (on the boundary axis) counts as light', () => {
    expect(shardContact(0, 0, 0, S, 0, S + SR - 2, SR, false)).toBe(SIDE_LIGHT);
  });
  it('Prism smashes the dark side', () => {
    expect(shardContact(0, 0, 0, S, -(S * 0.43 + SR - 4), 0, SR, true)).toBe(SIDE_LIGHT);
  });
});

describe('rings, waves, sub-stepping', () => {
  it('ring zones', () => {
    expect(ringContact(0, 0, 60, 9, 0, 0, SR)).toBe(RING_THREAD);
    expect(ringContact(0, 0, 60, 9, 60, 0, SR)).toBe(RING_RIM);
    expect(ringContact(0, 0, 60, 9, 120, 0, SR)).toBe(RING_NONE);
  });
  it('mine wave band', () => {
    expect(waveContact(0, 0, 100, 26, 100, 0, SR)).toBe(true);
    expect(waveContact(0, 0, 100, 26, 160, 0, SR)).toBe(false);
  });
  it('fast relative motion is sub-stepped (nothing tunnels)', () => {
    expect(subSteps(1, SR)).toBe(1);
    expect(subSteps(30, SR)).toBeGreaterThanOrEqual(5);
    expect(subSteps(10000, SR)).toBe(16);
  });
});
