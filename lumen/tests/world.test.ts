import { describe, expect, it } from 'vitest';
import { CFG } from '../src/config';
import { B_DOUBLE, B_FREEZE, B_GHOST, B_LEVIT, B_SHOWER, B_SPRING, B_TWIN, K_BLADE, K_HALF, K_HOLE, K_LASER, K_SEEKER } from '../src/game/entities';
import { MODE_DEAD, MODE_PLAY, World, type WorldEvents } from '../src/game/world';

const noop = (): void => undefined;
const events = (): WorldEvents => ({
  collect: noop, smash: noop, chain: noop, multUp: noop, multDown: noop, phase: noop, nearMiss: noop, thread: noop,
  booster: noop, boosterEnding: noop, shieldBreak: noop, death: noop, warn: noop, mineBoom: noop, heatWarn: noop,
  heatBurst: noop, convert: noop, twinLost: noop, laserFire: noop,
});

const DT = 1 / CFG.sim.hz;

/** Fresh run with the director silenced, and one static half-orb parked on the orbit ahead of the spark. */
function setup(lightFacesSpark: boolean, prism = false): World {
  const w = new World(events());
  w.reset(MODE_PLAY, 1234, false);
  w.cx = w.cy = 0;
  w.gravityK = 0; // keep the spark at its height: these tests are about the light/dark rule
  w.vr = 0;
  // park the obstacle on the orbit, a quarter turn ahead (clockwise)
  const a = w.ang + Math.PI / 2;
  const x = w.cx + Math.cos(a) * w.orbitR, y = w.cy + Math.sin(a) * w.orbitR;
  // clockwise travel at that point is along (-sin a, cos a); the spark arrives from the opposite
  // direction, so the normal pointing at the incoming spark is a - 90°
  const towardSpark = a - Math.PI / 2;
  const o = w.spawnObstacle(K_HALF, x, y, 0, 0, 40, lightFacesSpark ? towardSpark : towardSpark + Math.PI, 0)!;
  o.fade = 1;
  if (prism) w.activate(0);
  // keep the director from spawning anything else during the test
  (w.director as unknown as { update: () => void }).update = noop;
  return w;
}

function orbit(w: World, seconds: number): void {
  for (let i = 0; i < seconds / DT && w.mode === MODE_PLAY; i++) {
    // pin the core so it cannot drift away from the parked obstacle
    w.cx = w.cy = w.cpx = w.cpy = 0;
    w.held = true;
    w.step(DT);
  }
}

describe('world: light/dark rule end-to-end', () => {
  it('orbiting into the light side smashes and scores', () => {
    const w = setup(true);
    orbit(w, 1.5);
    expect(w.mode).toBe(MODE_PLAY);
    expect(w.stats.smashes).toBe(1);
    expect(w.score).toBeGreaterThan(0);
  });

  it('orbiting into the dark side ends the run', () => {
    const w = setup(false);
    orbit(w, 1.5);
    expect(w.mode).toBe(MODE_DEAD);
    expect(w.stats.smashes).toBe(0);
  });

  it('Prism smashes the dark side instead of dying', () => {
    const w = setup(false, true);
    orbit(w, 1.5);
    expect(w.mode).toBe(MODE_PLAY);
    expect(w.stats.prismSmashes).toBe(1);
  });
});

describe('world: gravity and bounces', () => {
  const fresh = (): World => {
    const w = new World(events());
    w.reset(MODE_PLAY, 77, false);
    (w.director as unknown as { update: () => void }).update = noop;
    w.obs.clear();
    w.orbs.clear();
    return w;
  };
  const run = (w: World, s: number): void => { for (let i = 0; i < s / DT && w.mode === MODE_PLAY; i++) w.step(DT); };

  it('with nothing to bounce on, the spark falls into the core and the run ends', () => {
    const w = fresh();
    run(w, 6);
    expect(w.mode).toBe(MODE_DEAD);
    expect(w.orbitR).toBeLessThanOrEqual(CFG.spark.deathRadius + 1);
  });

  it('collecting an orb bounces the spark away from the core', () => {
    const w = fresh();
    w.vr = -200;
    // an orb exactly where the spark will be next step
    w.spawnOrb(w.sx, w.sy + 0.01, 0, 0, true, 0, 5);
    w.step(DT);
    expect(w.vr).toBeGreaterThan(CFG.spark.bounceOrb - 10);
    expect(w.stats.orbs).toBe(1);
  });

  it('the shield saves one fall into the core', () => {
    const w = fresh();
    w.activate(4);
    run(w, 6);
    // first fall is absorbed (bounce + invulnerability), the second one kills
    expect(w.mode).toBe(MODE_DEAD);
    expect(w.runT).toBeGreaterThan(3);
  });

  it('the long tether catches the spark above the core', () => {
    const w = fresh();
    w.activate(7);
    run(w, 4);
    expect(w.mode).toBe(MODE_PLAY);
    expect(w.orbitR).toBeGreaterThanOrEqual(CFG.booster.longTetherRadius - 1);
  });

  it('the flight ceiling follows the screen: higher along the long side of a phone', () => {
    const w = fresh();
    w.viewHalfW = 420; w.viewHalfH = 910; // S24 Ultra portrait in world units
    const up = w.maxR(-Math.PI / 2), side = w.maxR(0);
    expect(up).toBeGreaterThan(side * 1.6);
    w.ang = 0;
    w.vr = 5000;
    w.step(DT);
    expect(w.orbitR).toBeLessThanOrEqual(side + 1e-6);
  });
});

describe('new boosters', () => {
  const fresh = (): World => {
    const w = new World(events());
    w.reset(MODE_PLAY, 91, false);
    (w.director as unknown as { update: () => void }).update = noop;
    w.obs.clear(); w.orbs.clear();
    return w;
  };
  it('spring makes bounces stronger', () => {
    const a = fresh(), b = fresh();
    b.activate(B_SPRING);
    a.vr = b.vr = -100;
    a.bounce(300); b.bounce(300);
    expect(b.vr).toBeCloseTo(300 * CFG.booster.springScale, 5);
    expect(a.vr).toBe(300);
  });
  it('double points doubles awards', () => {
    const w = fresh();
    const base = w.award(10);
    w.activate(B_DOUBLE);
    expect(w.award(10)).toBe(base * 2);
  });
  it('levitation stops the fall', () => {
    const w = fresh();
    w.activate(B_LEVIT);
    const r0 = w.orbitR;
    for (let i = 0; i < 240; i++) w.step(DT);
    expect(w.mode).toBe(MODE_PLAY);
    expect(Math.abs(w.orbitR - r0)).toBeLessThan(60);
  });
  it('ghost survives falling into the core', () => {
    const w = fresh();
    w.activate(B_GHOST);
    for (let i = 0; i < 4 * 120 && w.mode === MODE_PLAY; i++) w.step(DT);
    expect(w.mode).toBe(MODE_PLAY);
  });
  it('freeze stops obstacles', () => {
    const w = fresh();
    w.gravityK = 0;
    const o = w.spawnObstacle(K_HALF, 600, 0, -100, 0, 40, 0, 1)!;
    w.activate(B_FREEZE);
    for (let i = 0; i < 60; i++) w.step(DT);
    expect(o.x).toBe(600);
  });
  it('the twin collects orbs on the other side of the core', () => {
    const w = fresh();
    w.gravityK = 0; w.vr = 0;
    w.activate(B_TWIN);
    w.step(DT);
    w.spawnOrb(w.tsx, w.tsy, 0, 0, true, 0, 5);
    w.step(DT);
    expect(w.stats.orbs).toBe(1);
  });
  it('light shower fills the map with orbs', () => {
    const w = fresh();
    w.activate(B_SHOWER);
    expect(w.orbs.countActive()).toBe(CFG.booster.showerOrbs);
  });
});

describe('new hazards', () => {
  const fresh = (): World => {
    const w = new World(events());
    w.reset(MODE_PLAY, 92, false);
    (w.director as unknown as { update: () => void }).update = noop;
    w.obs.clear(); w.orbs.clear();
    w.gravityK = 0; w.vr = 0;
    return w;
  };
  it('a laser only hurts after its warning', () => {
    const w = fresh();
    // beam straight through the spark
    const o = w.spawnObstacle(K_LASER, w.sx, w.sy, 0, 0, 2600, 0.7, 0)!;
    o.fuse = CFG.obstacle.laserWarn;
    for (let i = 0; i < 100; i++) w.step(DT);
    expect(w.mode).toBe(MODE_PLAY); // still warning
    for (let i = 0; i < 60 && w.mode === MODE_PLAY; i++) w.step(DT);
    expect(w.mode).toBe(MODE_DEAD);
  });
  it('a spinning blade kills, prism smashes it', () => {
    const a = fresh();
    a.spawnObstacle(K_BLADE, a.sx, a.sy, 0, 0, 100, 0, 2);
    a.step(DT);
    expect(a.mode).toBe(MODE_DEAD);
    const b = fresh();
    b.activate(0);
    b.spawnObstacle(K_BLADE, b.sx, b.sy, 0, 0, 100, 0, 2);
    b.step(DT);
    expect(b.mode).toBe(MODE_PLAY);
    expect(b.stats.smashes).toBe(1);
  });
  it('a seeker steers towards the spark', () => {
    const w = fresh();
    const s = w.spawnObstacle(K_SEEKER, w.sx + 600, w.sy, 0, 200, 15, 0, 0)!;
    s.fuse = 5;
    const d0 = Math.hypot(s.x - w.sx, s.y - w.sy);
    // starts flying sideways; turns and closes in within two seconds
    for (let i = 0; i < 240; i++) w.step(DT);
    expect(Math.hypot(s.x - w.sx, s.y - w.sy)).toBeLessThan(d0 - 250);
  });
  it('a black hole pulls the spark towards it', () => {
    const w = fresh();
    const h = w.spawnObstacle(K_HOLE, w.sx * 1.6, w.sy * 1.6, 0, 0, 34, 0, 0)!;
    h.fuse = 5;
    for (let i = 0; i < 120; i++) w.step(DT);
    expect(w.vr).toBeGreaterThan(5); // pulled outwards, away from the core, towards the hole
  });
});

describe('daily challenge determinism', () => {
  it('same seed + same input → identical board', () => {
    const run = (): number[] => {
      const w = new World(events());
      w.god = true;
      w.reset(MODE_PLAY, 20261026, true);
      for (let i = 0; i < 40 * CFG.sim.hz; i++) {
        w.held = (i % 240) < 150;
        w.step(DT);
      }
      const out: number[] = [];
      for (const o of w.obs.items) if (o.active) out.push(o.kind, Math.round(o.x), Math.round(o.y));
      return out;
    };
    const a = run(), b = run();
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it('frame rate does not matter: the simulation runs on a fixed step', () => {
    expect(DT).toBeCloseTo(1 / 120, 10);
  });
});
