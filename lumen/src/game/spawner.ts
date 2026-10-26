import { CFG, type Range } from '../config';
import { TAU } from '../core/math';
import { K_COMET, K_FALL, K_HALF, K_MINE, K_RING, K_SHARD, K_VOID } from './entities';
import type { World } from './world';

const S = CFG.spawn;
const OB = CFG.obstacle;

const T_ORB = 0, T_HALF = 1, T_FALL = 2, T_SHARD = 3, T_RING = 4, T_MINE = 5, T_VOID = 6, T_COMET = 7, T_BOOST = 8;
/** Phase in which each spawn category is introduced. */
const INTRO = [1, 1, 2, 3, 4, 4, 5, 6, 1];
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
      this.timers[T_ORB] = attract ? 3.2 : w.rng.rr(S.orbPattern) * (0.75 + 0.25 * this.density());
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
    this.aimed(125, 0, 30, o);
    const travel = Math.atan2(o[3], o[2]);
    w.spawnObstacle(K_HALF, o[0], o[1], o[2], o[3], 62, lightForward ? travel : w.rng.next() * TAU, lightForward ? 0.1 : 0.35);
  }

  private halfOrb(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    const count = w.phase >= 3 && r.chance(0.35) ? 2 : 1;
    for (let k = 0; k < count; k++) {
      this.aimed(r.rr(OB.halfOrbSpeed), 0, CFG.spark.orbitRadius * 1.1, o);
      w.spawnObstacle(K_HALF, o[0], o[1], o[2], o[3], r.rr(OB.halfOrbRadius), r.next() * TAU, r.rr(OB.halfOrbSpin) * r.sign());
    }
  }

  private falling(): void {
    const w = this.w, r = w.rng;
    const lanes = w.phase >= 4 && r.chance(0.4) ? 2 : 1;
    const span = CFG.spark.orbitRadius * 1.15;
    let prev = 1e9;
    for (let k = 0; k < lanes; k++) {
      let x = w.cx + r.range(-span, span);
      if (Math.abs(x - prev) < 230) x = prev + (x > prev ? 260 : -260);
      prev = x;
      const rad = r.rr(OB.fallingRadius);
      w.spawnWarning(K_FALL, x, 0, 0, 1, OB.fallingWarn + k * 0.35, rad, r.rr(OB.fallingSpeed) * w.tempo, r.next() * TAU, r.range(0.3, 0.8) * r.sign());
    }
  }

  private shards(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    this.aimed(r.rr(OB.shardSpeed), 0, CFG.spark.orbitRadius, o);
    const n = r.int(4, 6 + Math.min(3, w.phase - 3));
    for (let k = 0; k < n; k++) {
      const ox = r.range(-70, 70), oy = r.range(-70, 70);
      const jitter = r.range(0.92, 1.08);
      w.spawnObstacle(K_SHARD, o[0] + ox, o[1] + oy, o[2] * jitter, o[3] * jitter, r.rr(OB.shardSize), r.next() * TAU, r.rr(OB.shardSpin) * r.sign());
    }
  }

  private ring(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    this.aimed(r.range(120, 180), CFG.spark.orbitRadius * 0.85, CFG.spark.orbitRadius * 1.1, o);
    w.spawnObstacle(K_RING, o[0], o[1], o[2], o[3], r.rr(OB.ringRadius), 0, 0);
  }

  private mine(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    this.aimed(r.range(80, 120), CFG.spark.orbitRadius * 0.4, CFG.spark.orbitRadius * 1.3, o);
    w.spawnObstacle(K_MINE, o[0], o[1], o[2], o[3], OB.mineRadius, 0, 0);
  }

  private voidOrb(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    this.aimed(r.range(140, 220), 0, CFG.spark.orbitRadius * 1.1, o);
    w.spawnObstacle(K_VOID, o[0], o[1], o[2], o[3], r.rr(OB.voidRadius), 0, 0);
  }

  private comet(): void {
    const w = this.w, r = w.rng;
    const a = r.next() * TAU;
    const dx = Math.cos(a), dy = Math.sin(a);
    const off = r.range(-CFG.spark.orbitRadius * 1.2, CFG.spark.orbitRadius * 1.2);
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
    w.spawnBubble(type, r.range(1.7, 3.8));
  }

  // ---------------------------------------------------------------- orb patterns

  private orbPattern(): void {
    const w = this.w, r = w.rng;
    if (w.orbs.countActive() > 220) return;
    const attract = w.mode !== 1;
    // the very first pattern of a run is always a ring: orbiting it teaches the game without text
    const roll = this.firstPattern ? 0 : r.next();
    this.firstPattern = false;
    const R = w.orbitR;
    if (attract || roll < 0.38) {
      // full ring around the core — orbiting plays a melody
      const n = r.int(10, 16);
      const start = w.ang + 0.5;
      for (let i = 0; i < n; i++) {
        const a = start + (i / n) * TAU;
        w.spawnOrb(w.cx + Math.cos(a) * R, w.cy + Math.sin(a) * R, 0, 0, true, i * 0.035, CFG.orb.anchoredLife);
      }
    } else if (roll < 0.62) {
      // arc ahead of the spark
      const n = r.int(5, 9);
      const start = w.ang + r.range(0.6, 2.2);
      const span = r.range(1.2, 2.6);
      for (let i = 0; i < n; i++) {
        const a = start + (i / (n - 1)) * span;
        w.spawnOrb(w.cx + Math.cos(a) * R, w.cy + Math.sin(a) * R, 0, 0, true, i * 0.04, CFG.orb.anchoredLife);
      }
    } else if (roll < 0.84) {
      // inward spiral: crosses the orbit and gets collected by circling
      const n = r.int(12, 18);
      const a0 = r.next() * TAU;
      const dir = r.sign();
      for (let i = 0; i < n; i++) {
        const a = a0 + dir * i * 0.42;
        const rad = 560 + i * 26;
        const x = w.cx + Math.cos(a) * rad, y = w.cy + Math.sin(a) * rad;
        const inX = -Math.cos(a), inY = -Math.sin(a);
        const sp = 105;
        w.spawnOrb(x, y, inX * sp - inY * 40 * dir, inY * sp + inX * 40 * dir, false, i * 0.03, 9);
      }
    } else {
      // line of orbs drifting across the orbit
      const n = r.int(6, 9);
      const a = r.next() * TAU;
      const dx = -Math.cos(a), dy = -Math.sin(a);
      const off = r.range(-R, R);
      const bx = w.cx + Math.cos(a) * 720 - dy * off, by = w.cy + Math.sin(a) * 720 + dx * off;
      for (let i = 0; i < n; i++) {
        w.spawnOrb(bx - dx * i * 38, by - dy * i * 38, dx * 150, dy * 150, false, 0, 10);
      }
    }
  }
}
