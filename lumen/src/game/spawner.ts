import { CFG, type Range } from '../config';
import { TAU } from '../core/math';
import { K_COMET, K_FALL, K_HALF, K_MINE, K_RING, K_SHARD, K_VOID } from './entities';
import type { World } from './world';

const S = CFG.spawn;
const OB = CFG.obstacle;

const T_ORB = 0, T_HALF = 1, T_FALL = 2, T_SHARD = 3, T_RING = 4, T_MINE = 5, T_VOID = 6, T_COMET = 7, T_BOOST = 8;
/** Phase in which each spawn category is introduced. */
const INTRO = [1, 1, 2, 3, 4, 4, 5, 6, 1];
/** Typical band the spark moves in (between the core and the rim): obstacles aim across it. */
const PLAY_R = 220;
const BOOSTER_WEIGHTS = [3, 1.2, 1.2, 1.2, 1.4, 1.0, 0.8, 1.0];

/**
 * The Director decides WHAT spawns WHEN. It only consumes the world's seeded RNG and
 * the simulation clock, so a daily-challenge seed produces the same board for everybody.
 */
export class Director {
  private timers = new Float32Array(9);
  private tutorial = 0;
  private boosters = 0;
  private lastPhase = 1;
  private firstPattern = true;

  constructor(private w: World) {}

  reset(): void {
    const r = this.w.rng;
    this.timers[T_ORB] = 0.6;
    this.timers[T_HALF] = 18;
    this.timers[T_FALL] = 2.5;
    this.timers[T_SHARD] = 2.5;
    this.timers[T_RING] = 2.0;
    this.timers[T_MINE] = 6.0;
    this.timers[T_VOID] = 3.0;
    this.timers[T_COMET] = 2.5;
    this.timers[T_BOOST] = S.firstBooster + r.range(0, 2);
    this.tutorial = 0;
    this.boosters = 0;
    this.lastPhase = 1;
    this.firstPattern = true;
  }

  private density(): number {
    return Math.max(S.densityFloor, 1 - S.densityPerPhase * (this.w.phase - 1));
  }

  private next(range: Range): number {
    return this.w.rng.rr(range) * this.density();
  }

  update(dt: number): void {
    const w = this.w;
    const attract = w.mode !== 1;
    // orb patterns always run (attract mode = gentle demo on the title screen)
    this.timers[T_ORB] -= dt;
    if (this.timers[T_ORB] <= 0) {
      this.orbPattern();
      this.timers[T_ORB] = attract ? 1.6 : w.rng.rr(S.orbPattern) * (0.85 + 0.15 * this.density());
    }
    if (attract) return;

    // new phase: bring the newly introduced type in quickly
    if (w.phase !== this.lastPhase) {
      this.lastPhase = w.phase;
      for (let i = 1; i < 8; i++) if (INTRO[i] === w.phase) this.timers[i] = Math.min(this.timers[i], 2.2);
    }

    // tutorial: first ~15 s are gentle and teach without text
    const t = w.runT;
    if (this.tutorial === 0 && t >= S.firstHalfOrb) {
      this.tutorial = 1;
      this.tutorialHalfOrb(true);
    } else if (this.tutorial === 1 && t >= S.secondHalfOrb) {
      this.tutorial = 2;
      this.tutorialHalfOrb(false);
    }

    const ph = w.phase;
    for (let i = 1; i < 9; i++) {
      if (ph < INTRO[i]) continue;
      if (i === T_HALF && t < 18) continue;
      this.timers[i] -= dt;
      if (this.timers[i] > 0) continue;
      switch (i) {
        case T_HALF: this.halfOrb(); this.timers[i] = this.next(S.halfOrb); break;
        case T_FALL: this.falling(); this.timers[i] = this.next(S.falling); break;
        case T_SHARD: this.shards(); this.timers[i] = this.next(S.shardSwarm); break;
        case T_RING: this.ring(); this.timers[i] = this.next(S.ring); break;
        case T_MINE: this.mine(); this.timers[i] = this.next(S.mine); break;
        case T_VOID: this.voidOrb(); this.timers[i] = this.next(S.void); break;
        case T_COMET: this.comet(); this.timers[i] = this.next(S.comet); break;
        case T_BOOST: this.booster(); this.timers[i] = w.rng.rr(S.booster); break;
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  /** Spawn point on the fixed spawn circle and a velocity aimed across the orbit. */
  private aimed(speed: number, offsetMin: number, offsetMax: number, out: Float32Array): void {
    const w = this.w, r = w.rng;
    const a = r.next() * TAU;
    const R = CFG.world.spawnRadius;
    const x = Math.cos(a) * R, y = Math.sin(a) * R;
    let dx = w.cx - x, dy = w.cy - y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= d; dy /= d;
    const off = r.range(offsetMin, offsetMax) * r.sign();
    const tx = w.cx - dy * off, ty = w.cy + dx * off;
    let vx = tx - x, vy = ty - y;
    const l = Math.sqrt(vx * vx + vy * vy) || 1;
    vx = (vx / l) * speed * w.tempo;
    vy = (vy / l) * speed * w.tempo;
    out[0] = x; out[1] = y; out[2] = vx; out[3] = vy;
  }

  private tmp = new Float32Array(4);

  private tutorialHalfOrb(lightForward: boolean): void {
    const w = this.w, o = this.tmp;
    this.aimed(125, 150, 190, o);
    // light side faces outwards at the closest approach: the falling spark lands on it and smashes it
    const vv = o[2] * o[2] + o[3] * o[3];
    const tc = -((o[0] - w.cx) * o[2] + (o[1] - w.cy) * o[3]) / vv;
    const px = o[0] + o[2] * tc, py = o[1] + o[3] * tc;
    const outward = Math.atan2(py - w.cy, px - w.cx);
    w.spawnObstacle(K_HALF, o[0], o[1], o[2], o[3], 56, lightForward ? outward : w.rng.next() * TAU, lightForward ? 0 : 0.35);
  }

  private halfOrb(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    const count = w.phase >= 3 && r.chance(0.35) ? 2 : 1;
    for (let k = 0; k < count; k++) {
      // pass through the spark's band, never right over the core (the spark must fall there)
      const rad = r.rr(OB.halfOrbRadius);
      this.aimed(r.rr(OB.halfOrbSpeed), rad + 70, PLAY_R + 50, o);
      w.spawnObstacle(K_HALF, o[0], o[1], o[2], o[3], rad, r.next() * TAU, r.rr(OB.halfOrbSpin) * r.sign());
    }
  }

  private falling(): void {
    const w = this.w, r = w.rng;
    const lanes = w.phase >= 4 && r.chance(0.4) ? 2 : 1;
    // the two lanes (if any) go on opposite sides of the core, never straight over it
    const side = r.sign();
    for (let k = 0; k < lanes; k++) {
      const rad = r.rr(OB.fallingRadius);
      const x = w.cx + (k === 0 ? side : -side) * r.range(rad + 80, rad + 190);
      w.spawnWarning(K_FALL, x, 0, 0, 1, OB.fallingWarn + k * 0.35, rad, r.rr(OB.fallingSpeed) * w.tempo, r.next() * TAU, r.range(0.3, 0.8) * r.sign());
    }
  }

  private shards(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    this.aimed(r.rr(OB.shardSpeed), 120, PLAY_R + 40, o);
    const n = r.int(4, 6 + Math.min(3, w.phase - 3));
    for (let k = 0; k < n; k++) {
      const ox = r.range(-70, 70), oy = r.range(-70, 70);
      const jitter = r.range(0.92, 1.08);
      w.spawnObstacle(K_SHARD, o[0] + ox, o[1] + oy, o[2] * jitter, o[3] * jitter, r.rr(OB.shardSize), r.next() * TAU, r.rr(OB.shardSpin) * r.sign());
    }
  }

  private ring(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    this.aimed(r.range(120, 180), PLAY_R * 0.85, PLAY_R * 1.1, o);
    w.spawnObstacle(K_RING, o[0], o[1], o[2], o[3], r.rr(OB.ringRadius), 0, 0);
  }

  private mine(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    this.aimed(r.range(80, 120), 150, PLAY_R + 60, o);
    w.spawnObstacle(K_MINE, o[0], o[1], o[2], o[3], OB.mineRadius, 0, 0);
  }

  private voidOrb(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    this.aimed(r.range(140, 220), 110, PLAY_R + 40, o);
    w.spawnObstacle(K_VOID, o[0], o[1], o[2], o[3], r.rr(OB.voidRadius), 0, 0);
  }

  private comet(): void {
    const w = this.w, r = w.rng;
    const a = r.next() * TAU;
    const dx = Math.cos(a), dy = Math.sin(a);
    const off = r.range(110, PLAY_R + 50) * r.sign();
    const tx = w.cx - dy * off, ty = w.cy + dx * off;
    const L = 1500;
    w.spawnWarning(K_COMET, tx - dx * L, ty - dy * L, dx, dy, OB.cometWarn, OB.cometRadius, r.rr(OB.cometSpeed) * Math.min(1.25, w.tempo), 0, 0);
  }

  private booster(): void {
    const w = this.w, r = w.rng;
    let type = 0;
    if (this.boosters > 0) {
      let sum = 0;
      for (let i = 0; i < BOOSTER_WEIGHTS.length; i++) sum += BOOSTER_WEIGHTS[i];
      let pick = r.next() * sum;
      for (let i = 0; i < BOOSTER_WEIGHTS.length; i++) {
        pick -= BOOSTER_WEIGHTS[i];
        if (pick <= 0) { type = i; break; }
      }
    }
    this.boosters++;
    w.spawnBubble(type, r.range(1.2, 3.6), r.range(140, 260));
  }

  // ---------------------------------------------------------------- orb patterns
  //
  // The core pulls the spark in and every orb bounces it back out, so the patterns are
  // "stepping stones" at different heights: rings, arcs, descending spirals, rotating wreaths
  // and clusters. Holding the finger steers the falling spark onto them.

  private orbPattern(): void {
    const w = this.w, r = w.rng;
    if (w.orbs.countActive() > 140) return;
    const attract = w.mode !== 1;
    const t = w.runT;
    const life = CFG.orb.anchoredLife;
    // first seconds: generous rings just under the spark, so the very first fall bounces
    if (attract || this.firstPattern || (t < 10 && r.chance(0.6))) {
      this.firstPattern = false;
      this.orbArc(r.range(118, 165), 0, TAU, r.range(-0.25, 0.25), life);
      return;
    }
    const roll = r.next();
    if (roll < 0.12) {
      // full ring (with one gap late in the run)
      const gap = w.phase >= 3 ? r.range(0.5, 1.1) : 0;
      this.orbArc(r.range(110, 270), r.next() * TAU, TAU - gap, r.range(-0.35, 0.35), life);
    } else if (roll < 0.46) {
      // arc ahead of the spark, slightly below it
      const rad = Math.max(105, Math.min(270, w.orbitR - r.range(-40, 100)));
      this.orbArc(rad, w.ang + r.range(0.4, 2.4), r.range(1.0, 2.6), r.range(-0.4, 0.4), life);
    } else if (roll < 0.7) {
      // descending spiral: follows the path of a spark that orbits while falling
      const n = r.int(12, 18);
      const a0 = w.ang + r.range(0.3, 1.2);
      const r0 = r.range(230, 275);
      for (let i = 0; i < n; i++) {
        const a = a0 + i * 0.36;
        const rad = r0 - i * ((r0 - 110) / n);
        w.spawnOrb(w.cx + Math.cos(a) * rad, w.cy + Math.sin(a) * rad, 0, 0, true, i * 0.03, life);
      }
    } else if (roll < 0.84) {
      // two counter-rotating wreaths
      const inner = r.range(110, 150);
      this.orbArc(inner, r.next() * TAU, TAU * 0.5, 0.55, life);
      this.orbArc(inner + r.range(80, 120), r.next() * TAU, TAU * 0.5, -0.45, life);
    } else if (roll < 0.94) {
      // clusters scattered around the core
      const k = r.int(3, 5);
      for (let c = 0; c < k; c++) {
        const a = r.next() * TAU, rad = r.range(115, 265);
        for (let i = 0; i < 4; i++) {
          const ox = r.range(-26, 26), oy = r.range(-26, 26);
          w.spawnOrb(w.cx + Math.cos(a) * rad + ox, w.cy + Math.sin(a) * rad + oy, 0, 0, true, c * 0.08 + i * 0.03, life);
        }
      }
    } else {
      // a line of orbs drifting across the field
      const n = r.int(6, 9);
      const a = r.next() * TAU;
      const dx = -Math.cos(a), dy = -Math.sin(a);
      const off = r.range(-200, 200);
      const bx = w.cx + Math.cos(a) * 640 - dy * off, by = w.cy + Math.sin(a) * 640 + dx * off;
      for (let i = 0; i < n; i++) w.spawnOrb(bx - dx * i * 38, by - dy * i * 38, dx * 150, dy * 150, false, 0, 10);
    }
  }

  /** Orbs on an arc of radius `rad` from angle a0 spanning `span`, spaced ~44 units apart. */
  private orbArc(rad: number, a0: number, span: number, spin: number, life: number): void {
    const w = this.w;
    const full = span >= TAU - 1e-3;
    const n = Math.max(4, Math.round((rad * span) / 50));
    for (let i = 0; i < n; i++) {
      const a = a0 + (full ? (i / n) * TAU : (i / Math.max(1, n - 1)) * span);
      w.spawnOrb(w.cx + Math.cos(a) * rad, w.cy + Math.sin(a) * rad, 0, 0, true, i * 0.02, life, 0, spin);
    }
  }
}
