import { describe, expect, it } from 'vitest';
import { CFG } from '../src/config';
import { K_HALF } from '../src/game/entities';
import { MODE_DEAD, MODE_PLAY, World, type WorldEvents } from '../src/game/world';

const noop = (): void => undefined;
const events = (): WorldEvents => ({
  collect: noop, smash: noop, chain: noop, multUp: noop, multDown: noop, phase: noop, nearMiss: noop, thread: noop,
  booster: noop, boosterEnding: noop, shieldBreak: noop, death: noop, warn: noop, mineBoom: noop, heatWarn: noop,
  heatBurst: noop, convert: noop,
});

const DT = 1 / CFG.sim.hz;

/** Fresh run with the director silenced, and one static half-orb parked on the orbit ahead of the spark. */
function setup(lightFacesSpark: boolean, prism = false): World {
  const w = new World(events());
  w.reset(MODE_PLAY, 1234, false);
  w.cx = w.cy = 0;
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
