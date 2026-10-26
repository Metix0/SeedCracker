import { CFG, type Range } from '../config';
import { TAU } from '../core/math';
import { K_BLADE, K_COMET, K_FALL, K_HALF, K_HOLE, K_LASER, K_MINE, K_RING, K_SEEKER, K_SHARD, K_VOID } from './entities';
import type { World } from './world';

const S = CFG.spawn;
const OB = CFG.obstacle;

const T_ORB = 0, T_HALF = 1, T_FALL = 2, T_SHARD = 3, T_RING = 4, T_MINE = 5, T_VOID = 6, T_COMET = 7, T_BOOST = 8;
const T_BLADE = 9, T_SEEKER = 10, T_LASER = 11, T_HOLE = 12;
const T_COUNT = 13;
/** Phase in which each spawn category is introduced. */
const INTRO = [1, 1, 2, 3, 4, 4, 5, 6, 1, 2, 3, 4, 5];
/** Relative chance of each booster (order of BOOSTERS in entities.ts). */
const BOOSTER_WEIGHTS = [3, 1.2, 1.2, 1.2, 1.4, 1.0, 0.8, 1.0, 1.2, 1.1, 0.9, 1.0, 1.0, 0.9, 1.0];

/**
 * The Director decides WHAT spawns WHEN. It only consumes the world's seeded RNG and
 * the simulation clock, so a daily-challenge seed produces the same board for everybody.
 */
export class Director {
  private timers = new Float32Array(T_COUNT);
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
    this.timers[T_BLADE] = 3.0;
    this.timers[T_SEEKER] = 3.0;
    this.timers[T_LASER] = 2.5;
    this.timers[T_HOLE] = 3.5;
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
      for (let i = 1; i < T_COUNT; i++) if (i !== T_BOOST && INTRO[i] === w.phase) this.timers[i] = Math.min(this.timers[i], 2.2);
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
    for (let i = 1; i < T_COUNT; i++) {
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
        case T_BLADE: this.blade(); this.timers[i] = this.next(S.blade); break;
        case T_SEEKER: this.seeker(); this.timers[i] = this.next(S.seeker); break;
        case T_LASER: this.laser(); this.timers[i] = this.next(S.laser); break;
        case T_HOLE: this.hole(); this.timers[i] = this.next(S.hole); break;
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  /** Spawn point on the fixed spawn circle and a velocity aimed across the orbit. */
  private aimed(speed: number, offsetMin: number, offsetMax: number, out: Float32Array): void {
    const w = this.w, r = w.rng;
    const a = r.next() * TAU;
    const R = w.spawnR();
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

  /** How far from the core hazards aim (grows with the screen: the whole map is in play). */
  private band(): number {
    return Math.max(220, this.w.reachMin() * 0.8);
  }

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
      this.aimed(r.rr(OB.halfOrbSpeed), rad + 70, this.band() + 50, o);
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
    this.aimed(r.rr(OB.shardSpeed), 120, this.band() + 40, o);
    const n = r.int(4, 6 + Math.min(3, w.phase - 3));
    for (let k = 0; k < n; k++) {
      const ox = r.range(-70, 70), oy = r.range(-70, 70);
      const jitter = r.range(0.92, 1.08);
      w.spawnObstacle(K_SHARD, o[0] + ox, o[1] + oy, o[2] * jitter, o[3] * jitter, r.rr(OB.shardSize), r.next() * TAU, r.rr(OB.shardSpin) * r.sign());
    }
  }

  private ring(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    this.aimed(r.range(120, 180), this.band() * 0.85, this.band() * 1.1, o);
    w.spawnObstacle(K_RING, o[0], o[1], o[2], o[3], r.rr(OB.ringRadius), 0, 0);
  }

  private mine(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    this.aimed(r.range(80, 120), 150, this.band() + 60, o);
    w.spawnObstacle(K_MINE, o[0], o[1], o[2], o[3], OB.mineRadius, 0, 0);
  }

  private voidOrb(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    this.aimed(r.range(140, 220), 110, this.band() + 40, o);
    w.spawnObstacle(K_VOID, o[0], o[1], o[2], o[3], r.rr(OB.voidRadius), 0, 0);
  }

  private comet(): void {
    const w = this.w, r = w.rng;
    const a = r.next() * TAU;
    const dx = Math.cos(a), dy = Math.sin(a);
    const off = r.range(110, this.band() + 50) * r.sign();
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
    const ahead = r.range(1.2, 3.6);
    w.spawnBubble(type, ahead, r.range(140, Math.max(160, w.maxR(w.ang + ahead) * 0.85)));
  }

  private blade(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    const len = r.rr(OB.bladeHalfLen);
    this.aimed(r.rr(OB.bladeSpeed), len * 0.5 + 90, this.band() + 60, o);
    w.spawnObstacle(K_BLADE, o[0], o[1], o[2], o[3], len, r.next() * TAU, r.rr(OB.bladeSpin) * r.sign());
  }

  private seeker(): void {
    const w = this.w, r = w.rng, o = this.tmp;
    const n = w.phase >= 6 && r.chance(0.4) ? 2 : 1;
    for (let k = 0; k < n; k++) {
      this.aimed(OB.seekerSpeed, 0, 100, o);
      const s = w.spawnObstacle(K_SEEKER, o[0] * 0.8, o[1] * 0.8, o[2], o[3], OB.seekerRadius, 0, 0);
      if (s) s.fuse = OB.seekerLife;
    }
    w.ev.warn(K_SEEKER);
  }

  /** A beam across the whole screen, never through the core; warned ~1 s ahead. */
  private laser(): void {
    const w = this.w, r = w.rng;
    const th = r.next() * TAU;
    const off = r.range(95, this.band()) * r.sign();
    const nx = -Math.sin(th), ny = Math.cos(th);
    const o = w.spawnObstacle(K_LASER, w.cx + nx * off, w.cy + ny * off, 0, 0, 2600, th, 0);
    if (!o) return;
    o.fade = 1;
    o.fuse = OB.laserWarn;
    w.ev.warn(K_LASER);
  }

  /** A black hole opens somewhere in the play area (away from the spark) and drifts slowly. */
  private hole(): void {
    const w = this.w, r = w.rng;
    const a = w.ang + r.range(1.4, TAU - 1.4);
    const rad = r.range(170, Math.max(190, w.reachMin() * 0.8));
    const x = w.cx + Math.cos(a) * rad, y = w.cy + Math.sin(a) * rad;
    const sp = r.rr(OB.holeSpeed) * r.sign();
    const o = w.spawnObstacle(K_HOLE, x, y, -Math.sin(a) * sp, Math.cos(a) * sp, OB.holeRadius, 0, 1.2);
    if (!o) return;
    o.fuse = OB.holeLife;
  }

  // ---------------------------------------------------------------- orb patterns
  //
  // The core pulls the spark in and every orb bounces it back out, so the patterns are
  // "stepping stones" at different heights: rings, arcs, descending spirals, rotating wreaths
  // and clusters. Holding the finger steers the falling spark onto them.

  /** Motion applied by orbArc() to the orbs it spawns (reused scratch, see Orb polar fields). */
  private mo = { amp: 0, freq: 0, k: 0, ph: 0, phStep: 0, aamp: 0, af: 0, sink: 0 };

  private still(): void {
    const m = this.mo;
    m.amp = m.freq = m.k = m.ph = m.phStep = m.aamp = m.af = m.sink = 0;
  }

  private orbPattern(): void {
    const w = this.w, r = w.rng, m = this.mo;
    if (w.orbs.countActive() > 140) return;
    const attract = w.mode !== 1;
    const t = w.runT;
    const life = CFG.orb.anchoredLife;
    this.still();
    // first seconds: generous, gently breathing rings just under the spark (the first fall bounces)
    if (attract || this.firstPattern || (t < 10 && r.chance(0.6))) {
      this.firstPattern = false;
      m.amp = 14; m.freq = 1.8;
      this.orbArc(r.range(118, 160), 0, TAU, r.range(-0.25, 0.25), life);
      return;
    }
    const roll = r.next();
    const RM = w.reachMin();
    if (roll < 0.08) {
      // breathing ring: the whole ring swells and shrinks (with a gap later in the run)
      const gap = w.phase >= 3 ? r.range(0.5, 1.1) : 0;
      m.amp = r.range(25, 45); m.freq = r.range(1.6, 2.6);
      this.orbArc(r.range(140, RM * 0.85), r.next() * TAU, TAU - gap, r.range(-0.3, 0.3), life);
    } else if (roll < 0.19) {
      // flower: a ring with travelling waves (k petals) that also turns
      m.amp = r.range(24, 40); m.freq = r.range(1.6, 2.6) * r.sign(); m.k = r.int(3, 5);
      this.orbArc(r.range(150, RM * 0.85), r.next() * TAU, TAU, r.range(-0.3, 0.3), life);
    } else if (roll < 0.31) {
      // pendulum: an arc ahead of the spark swinging back and forth
      m.aamp = r.range(0.35, 0.7); m.af = r.range(1.2, 2.0);
      const a0 = w.ang + r.range(0.6, 2.4);
      const rad = Math.max(110, Math.min(w.maxR(a0) * 0.9, w.orbitR - r.range(-60, 90)));
      this.orbArc(rad, a0, r.range(0.9, 1.8), 0, life);
    } else if (roll < 0.41) {
      // sinking spiral: turns while slowly falling into the core, from far out
      const n = r.int(12, 18);
      const a0 = w.ang + r.range(0.3, 1.2);
      const r0 = w.maxR(a0) * r.range(0.75, 0.92);
      for (let i = 0; i < n; i++) {
        const a = a0 + i * 0.4;
        const rad = Math.min(w.maxR(a) * 0.92, r0 - i * ((r0 - 120) / n));
        const o = w.spawnOrb(w.cx + Math.cos(a) * rad, w.cy + Math.sin(a) * rad, 0, 0, true, i * 0.03, life, 0, 0.35);
        if (o) o.sink = -r.range(16, 30);
      }
    } else if (roll < 0.49) {
      // two counter-rotating half wreaths, breathing in opposite phase
      const inner = r.range(110, Math.max(130, RM * 0.45));
      m.amp = 18; m.freq = 2.2;
      this.orbArc(inner, r.next() * TAU, TAU * 0.5, 0.55, life);
      m.ph = Math.PI;
      this.orbArc(Math.min(RM * 0.9, inner + r.range(80, 140)), r.next() * TAU, TAU * 0.5, -0.45, life);
    } else if (roll < 0.57) {
      // snake: a wiggling train of orbs slithering around the core
      m.amp = r.range(38, 58); m.freq = r.range(3.0, 4.2); m.phStep = 0.55;
      const n = r.int(10, 14);
      this.orbArc(r.range(160, RM * 0.8), w.ang + r.range(1.5, 3.5), n * 0.2, r.sign() * r.range(0.8, 1.15), life);
    } else if (roll < 0.67) {
      // fountain: orbs shoot out from the core, slow down and fall back — catch them mid-air
      const a0 = w.ang + r.range(0.8, 2.6);
      const n = r.int(7, 10);
      const g = 330;
      const top = w.maxR(a0) * r.range(0.55, 0.9);
      for (let i = 0; i < n; i++) {
        const a = a0 + (i - n / 2) * 0.07 + r.range(-0.03, 0.03);
        const sp = Math.sqrt(2 * g * (top - 72)) * r.range(0.85, 1.0);
        const x = w.cx + Math.cos(a) * 72, y = w.cy + Math.sin(a) * 72;
        const o = w.spawnOrb(x, y, Math.cos(a) * sp, Math.sin(a) * sp, false, i * 0.09, 6);
        if (o) o.grav = g;
      }
    } else if (roll < 0.76) {
      // ladder: stepping stones from near the core up to the edge of the map, swaying
      const a0 = w.ang + r.range(0.9, 3.0);
      const far = w.maxR(a0) * 0.9;
      const ph = r.next() * TAU;
      for (let rad = 140, i = 0; rad < far; rad += 58, i++) {
        const o = w.spawnOrb(w.cx + Math.cos(a0) * rad, w.cy + Math.sin(a0) * rad, 0, 0, true, i * 0.05, life, 0, 0.12);
        if (o) { o.aamp = 0.08; o.af = 1.6; o.ph = ph + i * 0.4; }
      }
    } else if (roll < 0.86) {
      // wanderers: orbs scattered all over the map, bobbing in little loops
      const n = r.int(10, 14);
      for (let i = 0; i < n; i++) {
        const a = r.next() * TAU;
        const rad = r.range(120, w.maxR(a) * 0.92);
        const o = w.spawnOrb(w.cx + Math.cos(a) * rad, w.cy + Math.sin(a) * rad, 0, 0, true, i * 0.05, life, 0, r.range(-0.15, 0.15));
        if (o) { o.amp = 18; o.freq = r.range(1.5, 2.6); o.ph = r.next() * TAU; o.aamp = 0.1; o.af = r.range(1.2, 2.2); }
      }
    } else if (roll < 0.94) {
      // drifting clusters that wobble in little loops
      const k = r.int(3, 4);
      for (let c = 0; c < k; c++) {
        const a = r.next() * TAU, rad = r.range(130, w.maxR(a) * 0.88), ph = r.next() * TAU;
        for (let i = 0; i < 4; i++) {
          const ox = r.range(-24, 24), oy = r.range(-24, 24);
          const o = w.spawnOrb(w.cx + Math.cos(a) * rad + ox, w.cy + Math.sin(a) * rad + oy, 0, 0, true, c * 0.08 + i * 0.03, life, 0, 0.25);
          if (o) { o.amp = 22; o.freq = 2.4; o.ph = ph; o.aamp = 0.14; o.af = 1.9; }
        }
      }
    } else {
      // a curving stream of orbs flying in from the edge, bent by the core's pull
      const n = r.int(7, 10);
      const a = r.next() * TAU;
      const dx = -Math.cos(a), dy = -Math.sin(a);
      const off = r.range(140, RM * 0.8) * r.sign();
      const start = w.spawnR() * 0.7;
      const bx = w.cx + Math.cos(a) * start - dy * off, by = w.cy + Math.sin(a) * start + dx * off;
      for (let i = 0; i < n; i++) {
        const o = w.spawnOrb(bx - dx * i * 40, by - dy * i * 40, dx * 190, dy * 190, false, 0, 10);
        if (o) o.grav = 45;
      }
    }
  }

  /** Orbs on an arc of radius `rad` from angle a0 spanning `span` (~50 units apart), moving per `mo`. */
  private orbArc(rad: number, a0: number, span: number, spin: number, life: number): void {
    const w = this.w, m = this.mo;
    const full = span >= TAU - 1e-3;
    const n = Math.max(4, Math.round((rad * span) / 50));
    for (let i = 0; i < n; i++) {
      const a = a0 + (full ? (i / n) * TAU : (i / Math.max(1, n - 1)) * span);
      const o = w.spawnOrb(w.cx + Math.cos(a) * rad, w.cy + Math.sin(a) * rad, 0, 0, true, i * 0.02, life, 0, spin);
      if (!o) continue;
      o.amp = m.amp; o.freq = m.freq; o.k = m.k; o.ph = m.ph + m.phStep * i;
      o.aamp = m.aamp; o.af = m.af; o.sink = m.sink;
    }
  }
}
