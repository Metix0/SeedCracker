import { CFG } from '../config';
import { TAU, damp, clamp, angleDiff } from '../core/math';
import { Rng } from '../core/rng';
import {
  SIDE_DARK, SIDE_LIGHT, RING_RIM, RING_THREAD,
  darkDiskContact, halfDiskContact, halfDiskDarkGap, ringContact, segmentDistance, shardContact, subSteps, waveContact,
} from './collision';
import {
  B_BOLT, B_DOUBLE, B_FREEZE, B_GHOST, B_LEVIT, B_MAGNET, B_NOVA, B_PRISM, B_ROCKET, B_SHIELD, B_SHOWER, B_SLOW,
  B_SPRING, B_TETHER, B_TWIN,
  Bolt, Bubble, Floater, K_BLADE, K_COMET, K_FALL, K_HALF, K_HOLE, K_LASER, K_MINE, K_RING, K_SEEKER, K_SHARD, K_VOID,
  Obstacle, Orb, Pool, Shock, Warning, newRunStats, type RunStats,
} from './entities';
import { Director } from './spawner';

export interface WorldEvents {
  collect(x: number, y: number, note: number, points: number): void;
  smash(x: number, y: number, r: number, kind: number, chain: number, points: number, rot: number): void;
  chain(n: number, bonus: number, x: number, y: number): void;
  multUp(level: number): void;
  multDown(level: number): void;
  phase(n: number): void;
  nearMiss(x: number, y: number, points: number): void;
  thread(x: number, y: number, points: number): void;
  booster(type: number): void;
  boosterEnding(type: number): void;
  shieldBreak(x: number, y: number): void;
  death(x: number, y: number): void;
  warn(kind: number): void;
  mineBoom(x: number, y: number): void;
  heatWarn(): void;
  /** the twin spark was destroyed by a dark hit */
  twinLost(x: number, y: number): void;
  laserFire(x: number, y: number): void;
  heatBurst(): void;
  convert(x: number, y: number): void;
}

export const MODE_ATTRACT = 0;
export const MODE_PLAY = 1;
export const MODE_DEAD = 2;

const SP = CFG.spark;
const CO = CFG.core;
const OB = CFG.obstacle;
const BO = CFG.booster;
const SC = CFG.score;
const MU = CFG.multiplier;

/** Float fields start at -0 for a stable double representation (see entities.ts). */
export class World {
  mode = MODE_ATTRACT;
  readonly rng = new Rng(1);
  readonly director: Director;
  ev: WorldEvents;
  daily = false;

  // time
  t = -0;
  runT = -0;
  steps = 0;

  // view (world units) — informs falling-orb entry and warning markers only
  viewHalfW = 500;
  viewHalfH = 500;

  // core
  cx = -0; cy = -0; cpx = -0; cpy = -0;
  crot = -0; cprot = -0;
  private driftPhase = new Float32Array(4);
  heatState = 0; // 0 idle, 1 warning, 2 active
  heatT = -0;
  heatNext = -0;
  heatExt = -0;
  readonly spikeAng = new Float32Array(6);
  spikeCount = 0;

  // spark
  held = false;
  private wasHeld = false;
  ang = -Math.PI / 2;
  pang = -Math.PI / 2;
  omega = -0;
  /** current distance of the spark from the core centre, and its radial velocity (+ = outwards) */
  orbitR = -0;
  vr = -0;
  /** debug/tests: scales gravity (1 = normal) */
  gravityK = 1;
  sx = -0; sy = -0; spx = -0; spy = -0;
  sr = -0;
  readonly trail = new Float32Array(SP.trailLength * 2);
  trailHead = 0;
  trailCount = 0;
  readonly tx = new Float32Array(SP.tetherSegments + 1);
  readonly ty = new Float32Array(SP.tetherSegments + 1);
  private tox = new Float32Array(SP.tetherSegments + 1);
  private toy = new Float32Array(SP.tetherSegments + 1);

  // pools
  readonly obs = new Pool(240, () => new Obstacle());
  readonly orbs = new Pool(420, () => new Orb());
  readonly bubbles = new Pool(6, () => new Bubble());
  readonly warns = new Pool(16, () => new Warning());
  readonly floaters = new Pool(72, () => new Floater());
  readonly bolts = new Pool(32, () => new Bolt());
  readonly shocks = new Pool(28, () => new Shock());

  // scoring
  score = 0;
  mult = 1;
  bar = 0;
  comboT = -0;
  comboLive = false;
  noteIdx = 0;
  chain = 0;
  chainT = -0;
  holdOrbs = 0;
  phase = 1;
  phaseT = -0;
  tempo = -0;
  stats: RunStats = newRunStats();

  // boosters (sim seconds remaining)
  prismT = -0;
  rocketT = -0;
  boltT = -0;
  magnetT = -0;
  slowT = -0;
  tetherT = -0;
  springT = -0;
  doubleT = -0;
  ghostT = -0;
  levT = -0;
  freezeT = -0;
  twinT = -0;
  /** twin spark (opposite side of the core) */
  tsx = -0; tsy = -0; tspx = -0; tspy = -0;
  shield = false;
  invulnT = -0;
  novaT = -0;
  novaX = -0; novaY = -0; novaR = -0;
  private endingFlags = 0;

  // death
  deathX = -0; deathY = -0;
  deadT = -0;

  // ghost (daily challenge)
  readonly ghostRec = new Float32Array(2 * 30 * 60 * 12);
  ghostLen = 0;
  ghost: Float32Array | null = null;
  ghostCount = 0;

  /** debug: never die */
  god = false;

  constructor(ev: WorldEvents) {
    this.ev = ev;
    this.director = new Director(this);
    this.reset(MODE_ATTRACT, 1, false);
  }

  reset(mode: number, seed: number, daily: boolean): void {
    this.mode = mode;
    this.daily = daily;
    this.rng.seed(seed);
    this.t = 0; this.runT = 0; this.steps = 0;
    this.obs.clear(); this.orbs.clear(); this.bubbles.clear(); this.warns.clear();
    this.floaters.clear(); this.bolts.clear(); this.shocks.clear();
    for (let i = 0; i < 4; i++) this.driftPhase[i] = this.rng.next() * TAU;
    this.cx = this.cy = this.cpx = this.cpy = 0;
    this.crot = this.cprot = 0;
    this.heatState = 0; this.heatT = 0; this.heatExt = 0; this.heatNext = this.rng.rr(CO.heatInterval);
    this.held = false; this.wasHeld = false;
    this.ang = this.pang = -Math.PI / 2;
    this.omega = 0;
    this.orbitR = SP.orbitRadius;
    this.vr = mode === MODE_PLAY ? 120 : 0;
    this.sr = SP.radius;
    this.placeSpark();
    this.spx = this.sx; this.spy = this.sy;
    this.trailHead = 0; this.trailCount = 0;
    for (let i = 0; i <= SP.tetherSegments; i++) {
      const f = i / SP.tetherSegments;
      this.tx[i] = this.tox[i] = this.cx + (this.sx - this.cx) * f;
      this.ty[i] = this.toy[i] = this.cy + (this.sy - this.cy) * f;
    }
    this.score = 0; this.mult = 1; this.bar = 0; this.comboT = 0; this.comboLive = false; this.noteIdx = 0;
    this.chain = 0; this.chainT = 0; this.holdOrbs = 0;
    this.phase = 1; this.phaseT = 0; this.tempo = 1;
    this.stats = newRunStats();
    this.stats.daily = daily;
    this.prismT = this.rocketT = this.boltT = this.magnetT = this.slowT = this.tetherT = 0;
    this.springT = this.doubleT = this.ghostT = this.levT = this.freezeT = this.twinT = 0;
    this.shield = false; this.invulnT = 0; this.novaT = -1; this.endingFlags = 0;
    this.deadT = 0;
    this.ghostLen = 0;
    this.ghostCount = 0;
    this.director.reset();
  }

  // ------------------------------------------------------------------ helpers

  barNeed(): number {
    return MU.barBase + MU.barPerLevel * (this.mult - 1);
  }

  get invulnerable(): boolean {
    return this.prismT > 0 || this.rocketT > 0 || this.invulnT > 0 || this.ghostT > 0 || this.god || this.mode !== MODE_PLAY;
  }

  private placeSpark(): void {
    this.sx = this.cx + Math.cos(this.ang) * this.orbitR;
    this.sy = this.cy + Math.sin(this.ang) * this.orbitR;
  }

  /**
   * Flight ceiling in direction `a`: the screen edge (minus margins) — the whole map is in play,
   * so on a tall phone the spark can climb much higher than it can go sideways.
   */
  maxR(a: number): number {
    const c = Math.cos(a), s = Math.sin(a);
    const hw = this.viewHalfW - SP.edgeMargin;
    let d = 1e9;
    if (c > 1e-4) d = Math.min(d, (hw - this.cx) / c);
    else if (c < -1e-4) d = Math.min(d, (hw + this.cx) / -c);
    if (s < -1e-4) d = Math.min(d, (this.viewHalfH - SP.edgeMarginTop + this.cy) / -s);
    else if (s > 1e-4) d = Math.min(d, (this.viewHalfH - SP.edgeMarginBottom - this.cy) / s);
    return d < SP.maxRadius ? SP.maxRadius : d > 1100 ? 1100 : d;
  }

  /** Smallest ceiling over all directions (full rings must fit everywhere). */
  reachMin(): number {
    const a = Math.min(this.viewHalfW - SP.edgeMargin, this.viewHalfH - SP.edgeMarginTop);
    return Math.max(SP.maxRadius, Math.min(1100, a));
  }

  /** Obstacles spawn just outside the visible area (at least the configured radius). */
  spawnR(): number {
    return Math.max(CFG.world.spawnRadius, Math.sqrt(this.viewHalfW * this.viewHalfW + this.viewHalfH * this.viewHalfH) + 140);
  }

  /** Points for an event: base × multiplier (× 2 with the Double points booster). */
  award(base: number): number {
    return base * this.mult * (this.doubleT > 0 ? 2 : 1);
  }

  floater(style: number, x: number, y: number, size: number, life: number, r: number, g: number, b: number): Floater | null {
    const f = this.floaters.get();
    if (!f) return null;
    f.buf.clear();
    f.style = style; f.x = x; f.y = y; f.size = size; f.t = 0; f.life = life;
    f.r = r; f.g = g; f.b = b;
    return f;
  }

  shock(x: number, y: number, maxR: number, dur: number, r: number, g: number, b: number, a: number, band = 22): void {
    const s = this.shocks.get();
    if (!s) return;
    s.x = x; s.y = y; s.maxR = maxR; s.dur = dur; s.t = 0; s.r = r; s.g = g; s.b = b; s.a = a; s.band = band;
  }

  // ------------------------------------------------------------------ step

  step(dt: number): void {
    this.t += dt;
    this.steps++;
    if (this.mode === MODE_DEAD) {
      this.deadT += dt;
      this.updateCore(dt);
      this.updateObstacles(dt, false);
      this.updateOrbs(dt, false);
      this.updateFx(dt);
      return;
    }
    if (this.mode === MODE_PLAY) {
      this.runT += dt;
      this.stats.time = this.runT;
    }

    this.updateCore(dt);
    this.updateSpark(dt);
    this.updatePhase();
    this.director.update(dt);
    this.updateWarnings(dt);
    this.updateOrbs(dt, true);
    this.updateBubbles(dt);
    this.updateObstacles(dt, true);
    this.updateBoosters(dt);
    this.updateScore(dt);
    this.updateFx(dt);

    if (this.daily && this.mode === MODE_PLAY && (this.steps & 3) === 0 && this.ghostLen < this.ghostRec.length) {
      this.ghostRec[this.ghostLen++] = this.sx;
      this.ghostRec[this.ghostLen++] = this.sy;
    }
  }

  private updateCore(dt: number): void {
    this.cpx = this.cx; this.cpy = this.cy; this.cprot = this.crot;
    const hot = this.heatState > 0 ? 1.8 : 1;
    const k = this.t * CO.driftSpeed * (0.8 + this.tempo * 0.35);
    const p = this.driftPhase;
    const E = CO.driftExtent;
    const txx = (Math.sin(k * 1.0 + p[0]) * 0.62 + Math.sin(k * 2.3 + p[1]) * 0.38) * E;
    const tyy = (Math.sin(k * 1.27 + p[2]) * 0.6 + Math.sin(k * 2.9 + p[3]) * 0.4) * E;
    const f = damp(0.9 * hot, dt);
    this.cx += (txx - this.cx) * f;
    this.cy += (tyy - this.cy) * f;
    this.crot += dt * (0.22 + (this.heatState > 0 ? 0.4 : 0));

    // heated core (late phases)
    if (this.mode !== MODE_PLAY || this.phase < 7) {
      this.heatState = 0;
      this.heatExt = Math.max(0, this.heatExt - dt * 4);
      return;
    }
    this.heatT += dt;
    if (this.heatState === 0) {
      this.heatExt = Math.max(0, this.heatExt - dt * 4);
      if (this.heatT >= this.heatNext) {
        this.heatState = 1;
        this.heatT = 0;
        this.spikeCount = Math.min(6, 3 + Math.floor((this.phase - 7) / 2));
        const base = this.rng.next() * TAU;
        for (let i = 0; i < this.spikeCount; i++) this.spikeAng[i] = base + (i / this.spikeCount) * TAU;
        this.ev.heatWarn();
      }
    } else if (this.heatState === 1) {
      if (this.heatT >= CO.heatWarn) {
        this.heatState = 2;
        this.heatT = 0;
        this.ev.heatBurst();
      }
    } else {
      this.heatExt = Math.min(1, this.heatExt + dt * 9);
      if (this.heatT >= CO.heatActive) {
        this.heatState = 0;
        this.heatT = 0;
        this.heatNext = this.rng.rr(CO.heatInterval) * Math.max(0.7, 1 - (this.phase - 7) * 0.05);
      }
    }
    for (let i = 0; i < this.spikeCount; i++) this.spikeAng[i] += dt * 0.35;
  }

  private updateSpark(dt: number): void {
    this.spx = this.sx; this.spy = this.sy; this.pang = this.ang;
    let held = this.held;
    if (this.mode === MODE_ATTRACT) held = (this.t % 7) < 5.2;
    if (held && !this.wasHeld) {
      this.omega += SP.pressKick;
    }
    if (!held && this.wasHeld) this.holdOrbs = 0;
    this.wasHeld = held;
    const rocket = this.rocketT > 0;
    // roughly constant linear speed: slower angular speed far out, capped close to the core
    const omegaMax = Math.min(SP.maxOmegaCap, (SP.maxOmega * SP.orbitRadius) / Math.max(this.orbitR, 60));
    const target = rocket ? omegaMax * BO.rocketOmega : held ? omegaMax : 0;
    const rate = rocket ? 9 : held ? SP.accel : SP.release;
    this.omega += (target - this.omega) * damp(rate, dt);
    if (!held && !rocket && this.omega < 0.02) this.omega = 0;
    this.ang += this.omega * dt;
    if (this.ang > TAU * 64) { this.ang -= TAU * 64; this.pang -= TAU * 64; }

    // radial motion: the core pulls, bounces push out
    if (rocket && this.vr < 300) this.vr = 300;
    this.vr -= this.gravity() * dt;
    if (this.levT > 0) this.vr *= Math.exp(-4 * dt); // levitation: the spark hovers
    this.orbitR += this.vr * dt;
    const ceil = this.maxR(this.ang);
    if (this.orbitR > ceil) {
      this.orbitR = ceil;
      if (this.vr > 0) this.vr = 0;
    }
    if (this.tetherT > 0 && this.orbitR < BO.longTetherRadius) {
      // the long tether goes taut and flicks the spark back up
      this.orbitR = BO.longTetherRadius;
      if (this.vr < 0) this.vr = Math.max(-this.vr * 0.45, SP.bounceOrb * 0.8);
    }
    if (this.orbitR <= SP.deathRadius) this.hitCore();
    const targetSr = SP.radius * (this.prismT > 0 ? BO.prismScale : 1);
    this.sr += (targetSr - this.sr) * damp(10, dt);
    this.placeSpark();
    // twin spark mirrors the spark on the other side of the core
    this.tspx = this.tsx; this.tspy = this.tsy;
    const tr = Math.min(this.orbitR, this.maxR(this.ang + Math.PI));
    this.tsx = this.cx - Math.cos(this.ang) * tr;
    this.tsy = this.cy - Math.sin(this.ang) * tr;
    if (this.twinT <= 0) { this.tspx = this.tsx; this.tspy = this.tsy; }

    // trail
    this.trail[this.trailHead * 2] = this.sx;
    this.trail[this.trailHead * 2 + 1] = this.sy;
    this.trailHead = (this.trailHead + 1) % SP.trailLength;
    if (this.trailCount < SP.trailLength) this.trailCount++;

    // tether (verlet rope, both ends pinned)
    const n = SP.tetherSegments;
    const tx = this.tx, ty = this.ty, ox = this.tox, oy = this.toy;
    for (let i = 1; i < n; i++) {
      const vx = (tx[i] - ox[i]) * 0.9, vy = (ty[i] - oy[i]) * 0.9;
      ox[i] = tx[i]; oy[i] = ty[i];
      tx[i] += vx; ty[i] += vy;
    }
    tx[0] = this.cx; ty[0] = this.cy; tx[n] = this.sx; ty[n] = this.sy;
    const rest = (this.orbitR / n) * 1.01;
    for (let it = 0; it < 5; it++) {
      for (let i = 0; i < n; i++) {
        const dx = tx[i + 1] - tx[i], dy = ty[i + 1] - ty[i];
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const diff = ((d - rest) / d) * SP.tetherStiffness;
        const mx = dx * diff * 0.5, my = dy * diff * 0.5;
        if (i > 0) { tx[i] += mx; ty[i] += my; }
        if (i + 1 < n) { tx[i + 1] -= mx; ty[i + 1] -= my; }
      }
    }
  }

  /** Current pull towards the core. */
  gravity(): number {
    if (this.mode !== MODE_PLAY) return SP.gravity * 0.8;
    if (this.levT > 0) return 0;
    let g = Math.min(SP.gravityMax, SP.gravity + SP.gravityPerPhase * (this.phase - 1));
    if (this.runT < SP.gravityIntroTime) g *= SP.gravityIntroScale + (1 - SP.gravityIntroScale) * (this.runT / SP.gravityIntroTime);
    return g * this.gravityK;
  }

  /** Push the spark outwards (never slows down a faster rise). */
  bounce(speed: number): void {
    if (this.springT > 0) speed *= BO.springScale;
    if (this.vr < speed) this.vr = speed;
  }

  /** The spark fell into the core. */
  private hitCore(): void {
    this.orbitR = SP.deathRadius + 0.5;
    if (this.mode !== MODE_PLAY || this.god || this.prismT > 0 || this.rocketT > 0 || this.invulnT > 0 || this.ghostT > 0) {
      this.vr = SP.bounceCore;
      return;
    }
    if (this.shield) {
      this.shield = false;
      this.invulnT = BO.shieldInvuln;
      this.vr = SP.bounceCore;
      this.placeSpark();
      this.ev.shieldBreak(this.sx, this.sy);
      return;
    }
    this.vr = 0;
    this.placeSpark();
    this.die(this.sx, this.sy);
  }

  private updatePhase(): void {
    if (this.mode !== MODE_PLAY) return;
    const P = CFG.phases;
    let byT = 1;
    for (let i = 0; i < P.byTime.length; i++) if (this.runT >= P.byTime[i]) byT = i + 1;
    const last = P.byTime[P.byTime.length - 1];
    if (this.runT > last) byT = P.byTime.length + Math.floor((this.runT - last) / P.extraEvery);
    let byM = 1;
    if (!this.daily) for (let i = 0; i < P.byMultiplier.length; i++) if (this.stats.peakMult >= P.byMultiplier[i]) byM = i + 1;
    const target = Math.max(byT, byM);
    this.phaseT += 1 / CFG.sim.hz;
    if (target > this.phase) {
      this.phase++;
      this.phaseT = 0;
      this.stats.phase = this.phase;
      this.tempo = Math.min(CFG.phases.tempoMax, 1 + CFG.phases.tempoPerPhase * (this.phase - 1));
      this.ev.phase(this.phase);
    }
  }

  // ------------------------------------------------------------------ spawning API (used by Director)

  spawnObstacle(kind: number, x: number, y: number, vx: number, vy: number, r: number, rot: number, spin: number): Obstacle | null {
    const o = this.obs.get();
    if (!o) return null;
    o.reset();
    o.kind = kind;
    o.x = o.px = x; o.y = o.py = y;
    o.vx = vx; o.vy = vy; o.r = r;
    o.rot = o.prot = rot; o.spin = spin;
    if (kind === K_MINE) o.fuse = this.rng.rr(OB.mineFuse);
    return o;
  }

  /**
   * `spin` (rad/s, + = clockwise) makes an anchored orb circle the core; the spawner can set the
   * other polar motion fields (breathing, waves, pendulum, sinking) on the returned orb.
   */
  spawnOrb(x: number, y: number, vx: number, vy: number, anchored: boolean, delay: number, life: number, homing = 0, spin = 0): Orb | null {
    const o = this.orbs.get();
    if (!o) return null;
    o.anchored = anchored;
    o.ox = x - this.cx; o.oy = y - this.cy;
    o.pr = Math.sqrt(o.ox * o.ox + o.oy * o.oy);
    o.pa = Math.atan2(o.oy, o.ox);
    o.pw = spin;
    o.amp = 0; o.freq = 0; o.k = 0; o.ph = 0; o.aamp = 0; o.af = 0; o.sink = 0; o.grav = 0;
    o.x = o.px = x; o.y = o.py = y;
    o.vx = vx; o.vy = vy;
    o.t = 0; o.delay = delay; o.life = life; o.homing = homing; o.big = false; o.dying = 0;
    return o;
  }

  spawnBubble(type: number, angleAhead: number, radius: number): void {
    const b = this.bubbles.get();
    if (!b) return;
    b.type = type;
    const a = this.ang + angleAhead;
    b.ox = Math.cos(a) * radius;
    b.oy = Math.sin(a) * radius;
    b.x = b.px = this.cx + b.ox;
    b.y = b.py = this.cy + b.oy;
    b.t = 0;
    b.life = BO.life;
  }

  spawnWarning(kind: number, x: number, y: number, dx: number, dy: number, dur: number, r: number, speed: number, rot: number, spin: number): void {
    const w = this.warns.get();
    if (!w) return;
    w.kind = kind; w.x = x; w.y = y; w.dx = dx; w.dy = dy; w.t = 0; w.dur = dur; w.r = r; w.speed = speed; w.rot = rot; w.spin = spin;
    this.ev.warn(kind);
  }

  private updateWarnings(dt: number): void {
    const items = this.warns.items;
    for (let i = 0; i < items.length; i++) {
      const w = items[i];
      if (!w.active) continue;
      w.t += dt;
      if (w.t >= w.dur) {
        w.active = false;
        if (w.kind === K_FALL) {
          const y = -Math.min(this.viewHalfH + w.r + 30, CFG.world.spawnRadius);
          this.spawnObstacle(K_FALL, w.x, y, 0, w.speed, w.r, w.rot, w.spin);
        } else {
          const o = this.spawnObstacle(K_COMET, w.x, w.y, w.dx * w.speed, w.dy * w.speed, w.r, Math.atan2(-w.dy, -w.dx), 0);
          if (o) o.fade = 1;
        }
      }
    }
  }

  // ------------------------------------------------------------------ orbs

  private updateOrbs(dt: number, interact: boolean): void {
    const items = this.orbs.items;
    const magnet = this.magnetT > 0;
    const pr = this.sr + CFG.orb.radius + CFG.orb.pickupPad;
    const pr2 = pr * pr;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      if (!o.active) continue;
      o.px = o.x; o.py = o.y;
      o.t += dt;
      if (o.dying > 0) {
        o.dying -= dt;
        if (o.dying <= 0) o.active = false;
        continue;
      }
      if (o.t < o.delay) {
        if (o.anchored) { this.placeOrb(o, 0); o.px = o.x; o.py = o.y; }
        continue;
      }
      if (o.t > o.life + o.delay) {
        o.dying = 0.35;
        continue;
      }
      if (o.anchored) {
        if (this.placeOrb(o, o.t - o.delay)) { o.dying = 0.3; continue; }
      } else {
        if (this.holes > 0) this.pullByHoles(o, dt);
        if (o.grav > 0) {
          const dx = this.cx - o.x, dy = this.cy - o.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          o.vx += (dx / d) * o.grav * dt;
          o.vy += (dy / d) * o.grav * dt;
        }
        if (o.homing > 0) {
          const dx = this.sx - o.x, dy = this.sy - o.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const acc = o.homing;
          o.vx += (dx / d) * acc * dt;
          o.vy += (dy / d) * acc * dt;
          const k = Math.exp(-1.6 * dt);
          o.vx *= k; o.vy *= k;
        }
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        // absorbed by the core
        const cdx = o.x - this.cx, cdy = o.y - this.cy;
        if (cdx * cdx + cdy * cdy < CO.radius * CO.radius * 0.6) { o.dying = 0.25; continue; }
        if (Math.abs(o.x) > CFG.world.cullRadius || Math.abs(o.y) > CFG.world.cullRadius) { o.active = false; continue; }
      }
      if (magnet && interact) {
        const dx = this.sx - o.x, dy = this.sy - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < BO.magnetRange * BO.magnetRange) {
          const d = Math.sqrt(d2) || 1;
          const pull = (1 - d / BO.magnetRange) * 2200 * dt + 6;
          const m = Math.min(pull, d);
          // a caught orb leaves its pattern and flies freely to the spark
          if (o.anchored) { o.anchored = false; o.vx = 0; o.vy = 0; o.grav = 0; }
          o.x += (dx / d) * m; o.y += (dy / d) * m;
        }
      }
      if (!interact || this.mode === MODE_DEAD) continue;
      // swept pickup: test along the spark's motion this step
      const ex = this.sx - this.spx, ey = this.sy - this.spy;
      const l2 = ex * ex + ey * ey;
      let tt = l2 > 0 ? ((o.x - this.spx) * ex + (o.y - this.spy) * ey) / l2 : 1;
      tt = clamp(tt, 0, 1);
      const qx = this.spx + ex * tt - o.x, qy = this.spy + ey * tt - o.y;
      if (qx * qx + qy * qy < pr2) { this.collect(o); continue; }
      if (this.twinT > 0) {
        const tx = this.tsx - o.x, ty = this.tsy - o.y;
        if (tx * tx + ty * ty < pr2) this.collect(o);
      }
    }
  }

  /** Position an anchored orb from its polar motion; returns true when it sank into the core. */
  private placeOrb(o: Orb, t: number): boolean {
    const a = o.pa + o.pw * t + (o.aamp !== 0 ? o.aamp * Math.sin(o.af * t + o.ph) : 0);
    let r = o.pr + o.sink * t;
    if (o.amp !== 0) r += o.amp * Math.sin(o.freq * t + o.ph + o.k * o.pa);
    o.ox = Math.cos(a) * r;
    o.oy = Math.sin(a) * r;
    o.x = this.cx + o.ox;
    o.y = this.cy + o.oy;
    return r < CO.radius + 14;
  }

  private collect(o: Orb): void {
    o.active = false;
    this.bounce(SP.bounceOrb);
    const play = this.mode === MODE_PLAY;
    const pts = this.award(CFG.orb.value);
    if (play) {
      this.score += pts;
      this.stats.orbs++;
      if (this.held) {
        this.holdOrbs++;
        if (this.holdOrbs > this.stats.holdOrbsMax) this.stats.holdOrbsMax = this.holdOrbs;
      }
      this.addBar(MU.orbFill);
    }
    this.ev.collect(o.x, o.y, this.noteIdx++, play ? pts : 0);
  }

  // ------------------------------------------------------------------ boosters

  private updateBubbles(dt: number): void {
    const items = this.bubbles.items;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (!b.active) continue;
      b.px = b.x; b.py = b.y;
      b.t += dt;
      b.x = this.cx + b.ox + Math.sin(b.t * 2.1) * 6;
      b.y = this.cy + b.oy + Math.cos(b.t * 1.7) * 6;
      if (b.t > b.life) { b.active = false; continue; }
      if (this.mode !== MODE_PLAY) continue;
      const dx = this.sx - b.x, dy = this.sy - b.y;
      const r = this.sr + BO.radius;
      if (dx * dx + dy * dy < r * r) {
        b.active = false;
        this.bounce(SP.bounceBooster);
        this.activate(b.type);
      }
    }
  }

  activate(type: number): void {
    this.stats.boosters[type]++;
    switch (type) {
      case B_PRISM: this.prismT = BO.prism; break;
      case B_ROCKET: this.rocketT = BO.rocket; break;
      case B_BOLT: this.boltT = BO.lightning; break;
      case B_MAGNET: this.magnetT = BO.magnet; break;
      case B_SHIELD: this.shield = true; break;
      case B_SLOW: this.slowT = BO.slowmo * BO.slowmoScale; break;
      case B_NOVA: this.novaT = 0; this.novaX = this.sx; this.novaY = this.sy; this.novaR = 0; break;
      case B_TETHER: this.tetherT = BO.longTether; break;
      case B_SPRING: this.springT = BO.spring; break;
      case B_DOUBLE: this.doubleT = BO.double; break;
      case B_GHOST: this.ghostT = BO.ghost; break;
      case B_LEVIT: this.levT = BO.levit; this.vr = Math.max(this.vr, 0); break;
      case B_SHOWER: this.lightShower(); break;
      case B_FREEZE: this.freezeT = BO.freeze; break;
      case B_TWIN: this.twinT = BO.twin; this.tspx = this.tsx; this.tspy = this.tsy; break;
    }
    this.endingFlags &= ~(1 << type);
    this.ev.booster(type);
  }

  private tick(v: number, dt: number, type: number, warnAt: number): number {
    if (v <= 0) return 0;
    const n = v - dt;
    if (n <= warnAt && !(this.endingFlags & (1 << type))) {
      this.endingFlags |= 1 << type;
      this.ev.boosterEnding(type);
    }
    return n < 0 ? 0 : n;
  }

  private updateBoosters(dt: number): void {
    this.prismT = this.tick(this.prismT, dt, B_PRISM, 1.5);
    this.rocketT = this.tick(this.rocketT, dt, B_ROCKET, 0);
    this.boltT = this.tick(this.boltT, dt, B_BOLT, 0);
    this.magnetT = this.tick(this.magnetT, dt, B_MAGNET, 0);
    this.slowT = this.tick(this.slowT, dt, B_SLOW, 0.5 * BO.slowmoScale);
    this.tetherT = this.tick(this.tetherT, dt, B_TETHER, 1.2);
    this.springT = this.tick(this.springT, dt, B_SPRING, 1);
    this.doubleT = this.tick(this.doubleT, dt, B_DOUBLE, 1);
    this.ghostT = this.tick(this.ghostT, dt, B_GHOST, 1.2);
    this.levT = this.tick(this.levT, dt, B_LEVIT, 1.2);
    this.freezeT = this.tick(this.freezeT, dt, B_FREEZE, 1);
    this.twinT = this.tick(this.twinT, dt, B_TWIN, 1.2);
    if (this.invulnT > 0) this.invulnT = Math.max(0, this.invulnT - dt);
    if (this.novaT >= 0) {
      this.novaT += dt;
      const f = this.novaT / BO.supernovaTime;
      this.novaR = f * 2600;
      const r2 = this.novaR * this.novaR;
      const items = this.obs.items;
      for (let i = 0; i < items.length; i++) {
        const o = items[i];
        if (!o.active) continue;
        const dx = o.x - this.novaX, dy = o.y - this.novaY;
        if (dx * dx + dy * dy < r2) this.convertToOrbs(o);
      }
      if (f >= 1) this.novaT = -1;
    }
  }

  /** Light shower: orbs pop up all over the map, gently bobbing. */
  private lightShower(): void {
    const n = BO.showerOrbs;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const rad = 110 + Math.random() * (this.maxR(a) * 0.92 - 110);
      const o = this.spawnOrb(this.cx + Math.cos(a) * rad, this.cy + Math.sin(a) * rad, 0, 0, true, i * 0.025, 6);
      if (o) { o.amp = 10; o.freq = 2 + Math.random(); o.ph = Math.random() * TAU; }
    }
  }

  private convertToOrbs(o: Obstacle): void {
    o.active = false;
    if (o.kind === K_LASER) return;
    const n = o.kind === K_SHARD ? 1 : o.r > 90 ? 6 : o.r > 50 ? 4 : 3;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU;
      const sp = 40 + Math.random() * 90;
      this.spawnOrb(o.x + Math.cos(a) * o.r * 0.4, o.y + Math.sin(a) * o.r * 0.4, Math.cos(a) * sp, Math.sin(a) * sp, false, 0, 7, 520);
    }
    if (this.mode === MODE_PLAY) {
      this.score += this.award(15);
      this.addBar(0.5);
    }
    this.ev.convert(o.x, o.y);
  }

  // ------------------------------------------------------------------ obstacles

  private updateObstacles(dt: number, interact: boolean): void {
    const items = this.obs.items;
    const prism = this.prismT > 0 || this.rocketT > 0;
    const play = this.mode === MODE_PLAY && interact;
    const cull = this.spawnR() + 600;
    const frozen = this.freezeT > 0;
    let holes = 0;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      if (!o.active) continue;
      o.px = o.x; o.py = o.y; o.prot = o.rot;
      if (o.flash > 0) o.flash = Math.max(0, o.flash - dt * 5);
      o.fade = Math.min(1, o.fade + dt * 3);
      if (o.kind === K_LASER) {
        // lasers keep their timing even when frozen: warning → beam → gone
        o.t += dt;
        o.fuse -= dt;
        if (o.fuse <= 0) {
          if (o.state === 0) {
            o.state = 1;
            o.fuse = OB.laserActive;
            this.ev.laserFire(o.x, o.y);
          } else { o.active = false; continue; }
        }
        if (play && o.state === 1) this.collideLaser(o);
        continue;
      }
      if (frozen) {
        if (o.kind === K_HOLE) holes++;
        if (play) this.collide(o, prism, dt);
        continue;
      }
      o.t += dt;
      if (o.kind === K_SEEKER) {
        // steer towards the spark (limited turning), then fizzle out
        const dx = this.sx - o.x, dy = this.sy - o.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const sp = OB.seekerSpeed * Math.min(1.3, this.tempo);
        const k = damp(OB.seekerTurn, dt);
        o.vx += ((dx / d) * sp - o.vx) * k;
        o.vy += ((dy / d) * sp - o.vy) * k;
        o.rot = Math.atan2(o.vy, o.vx);
        o.fuse -= dt;
        if (o.fuse <= 0) { o.active = false; this.ev.convert(o.x, o.y); continue; }
      } else if (o.kind === K_HOLE) {
        o.fuse -= dt;
        if (o.fuse <= 0) { o.active = false; continue; }
        holes++;
        this.pullSparkByHole(o, dt);
      }
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.rot += o.spin * dt;

      // cull far objects moving away
      const ox = o.x, oy = o.y;
      if (ox * ox + oy * oy > cull * cull && ox * o.vx + oy * o.vy > 0) { o.active = false; continue; }

      if (o.kind === K_MINE) {
        if (o.state === 0) {
          const dx = o.x - this.cx, dy = o.y - this.cy;
          if (dx * dx + dy * dy < 650 * 650) o.fuse -= dt;
          if (o.fuse <= 0) {
            o.state = 1;
            o.waveT = 0;
            o.vx *= 0.2; o.vy *= 0.2;
            this.ev.mineBoom(o.x, o.y);
          }
        } else {
          o.waveT += dt;
          const f = o.waveT / OB.mineWaveTime;
          o.waveR = OB.mineWaveRadius * (1 - (1 - f) * (1 - f));
          if (f >= 1) { o.active = false; continue; }
        }
      }

      if (!play) continue;
      this.collide(o, prism, dt);
    }
    this.holes = holes;
  }

  /** active black holes this step (pull free orbs too) */
  holes = 0;

  /** Strength of a hole's pull at distance d (fades in and out over its life). */
  private holeAccel(o: Obstacle, d: number): number {
    if (d >= OB.holePull || d < 1) return 0;
    const life = Math.min(1, o.t / 0.8, o.fuse / 0.8);
    return OB.holeStrength * (1 - d / OB.holePull) * life;
  }

  /** The spark moves in polar coordinates: split the pull into radial (vr) and angular (omega) parts. */
  private pullSparkByHole(o: Obstacle, dt: number): void {
    if (this.mode !== MODE_PLAY) return;
    const dx = o.x - this.sx, dy = o.y - this.sy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const acc = this.holeAccel(o, d);
    if (acc <= 0) return;
    const ax = (dx / d) * acc, ay = (dy / d) * acc;
    const r = Math.max(this.orbitR, 60);
    const ux = (this.sx - this.cx) / r, uy = (this.sy - this.cy) / r;
    this.vr += (ax * ux + ay * uy) * dt;
    this.omega += ((ax * -uy + ay * ux) / r) * dt;
  }

  private pullByHoles(orb: Orb, dt: number): void {
    const items = this.obs.items;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      if (!o.active || o.kind !== K_HOLE) continue;
      const dx = o.x - orb.x, dy = o.y - orb.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const acc = this.holeAccel(o, d) * 1.4;
      if (acc <= 0) continue;
      orb.vx += (dx / d) * acc * dt;
      orb.vy += (dy / d) * acc * dt;
      if (d < o.r) orb.dying = 0.2; // swallowed
    }
  }

  /** A laser beam is a long segment through (x, y) along `rot`; only its active phase hurts. */
  private collideLaser(o: Obstacle): void {
    const c = Math.cos(o.rot), s = Math.sin(o.rot);
    const L = o.r;
    const d = segmentDistance(this.sx, this.sy, o.x - c * L, o.y - s * L, o.x + c * L, o.y + s * L);
    if (d < (OB.laserWidth * 0.5 + this.sr) * CFG.hitbox.darkScale) this.darkHit(o, this.sx, this.sy);
    if (this.twinT > 0) {
      const dt2 = segmentDistance(this.tsx, this.tsy, o.x - c * L, o.y - s * L, o.x + c * L, o.y + s * L);
      if (dt2 < OB.laserWidth * 0.5 + this.sr * 0.8) this.loseTwin();
    }
  }

  private loseTwin(): void {
    if (this.twinT <= 0) return;
    this.twinT = 0;
    this.ev.twinLost(this.tsx, this.tsy);
  }

  /** Swept collision of the spark against one obstacle (sub-stepped). */
  private collide(o: Obstacle, prism: boolean, dt: number): void {
    const sr = this.sr;
    // broad phase
    const reach = (o.kind === K_MINE && o.state === 1 ? o.waveR + OB.mineWaveBand : o.r * 1.15) + sr + 80;
    const dx0 = this.sx - o.x, dy0 = this.sy - o.y;
    if (dx0 * dx0 + dy0 * dy0 > reach * reach) {
      o.nearIn = false;
      return;
    }
    const relX = (this.sx - this.spx) - (o.x - o.px), relY = (this.sy - this.spy) - (o.y - o.py);
    const rotMove = Math.abs(o.spin * dt) * o.r;
    const n = subSteps(Math.sqrt(relX * relX + relY * relY) + rotMove, sr);
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const sx = this.spx + (this.sx - this.spx) * f, sy = this.spy + (this.sy - this.spy) * f;
      const ox = o.px + (o.x - o.px) * f, oy = o.py + (o.y - o.py) * f;
      const rot = o.prot + (o.rot - o.prot) * f;
      let side = 0;
      switch (o.kind) {
        case K_HALF: case K_FALL: case K_COMET:
          side = halfDiskContact(ox, oy, rot, o.r, sx, sy, sr, prism);
          break;
        case K_SHARD:
          side = shardContact(ox, oy, rot, o.r, sx, sy, sr, prism);
          break;
        case K_VOID: case K_SEEKER:
          side = darkDiskContact(ox, oy, o.r, sx, sy, sr, prism);
          break;
        case K_HOLE:
          // only the dark heart kills; the pull itself is handled by pullSparkByHole
          side = darkDiskContact(ox, oy, o.r * 0.75, sx, sy, sr, prism);
          break;
        case K_BLADE: {
          const c = Math.cos(rot) * o.r, s = Math.sin(rot) * o.r;
          const d = segmentDistance(sx, sy, ox - c, oy - s, ox + c, oy + s);
          if (prism) { if (d < OB.bladeWidth * 0.5 + sr) side = SIDE_LIGHT; }
          else if (d < (OB.bladeWidth * 0.5 + sr) * CFG.hitbox.darkScale) side = SIDE_DARK;
          break;
        }
        case K_MINE:
          if (o.state === 0) side = darkDiskContact(ox, oy, o.r, sx, sy, sr, prism);
          else if (waveContact(ox, oy, o.waveR, OB.mineWaveBand, sx, sy, sr)) side = prism ? 0 : SIDE_DARK;
          break;
        case K_RING: {
          const rc = ringContact(ox, oy, o.r, OB.ringThickness, sx, sy, sr);
          if (rc === RING_THREAD) { this.threadRing(o); return; }
          if (rc === RING_RIM) { o.state = 1; if (prism) { this.smash(o, false); return; } }
          else if (o.state === 1) {
            const ddx = sx - ox, ddy = sy - oy;
            if (ddx * ddx + ddy * ddy > o.r * o.r) { this.smash(o, false); return; }
          }
          break;
        }
      }
      if (side === SIDE_LIGHT) {
        this.smash(o, false);
        return;
      }
      if (side === SIDE_DARK) {
        this.darkHit(o, sx, sy);
        return;
      }
    }
    if (this.twinT > 0) this.collideTwin(o, prism);
    // near miss (round hazards only)
    if (!prism && !o.nearDone && o.kind !== K_RING && o.kind !== K_BLADE && o.kind !== K_HOLE && !(o.kind === K_MINE && o.state === 1)) {
      let gap: number;
      if (o.kind === K_HALF || o.kind === K_FALL || o.kind === K_COMET) gap = halfDiskDarkGap(o.x, o.y, o.rot, o.r, this.sx, this.sy, sr);
      else {
        const dx = this.sx - o.x, dy = this.sy - o.y;
        gap = Math.sqrt(dx * dx + dy * dy) - o.r * (o.kind === K_SHARD ? 0.75 : 1) - sr;
      }
      if (gap < CFG.hitbox.nearMissDist && gap > -sr * 0.3) o.nearIn = true;
      else if (o.nearIn && gap > CFG.hitbox.nearMissDist * 1.6) {
        o.nearIn = false;
        o.nearDone = true;
        const pts = this.award(SC.nearMiss);
        this.score += pts;
        this.stats.nearMisses++;
        this.addBar(1);
        this.ev.nearMiss(this.sx, this.sy, pts);
      }
    }
  }

  private darkHit(o: Obstacle, x: number, y: number): void {
    const beam = o.kind === K_LASER;
    if (this.prismT > 0 || this.rocketT > 0) { if (!beam) this.smash(o, false); return; }
    if (this.invulnT > 0 || this.ghostT > 0 || this.god) return;
    if (this.shield) {
      this.shield = false;
      this.invulnT = BO.shieldInvuln;
      this.ev.shieldBreak(x, y);
      if (!beam && !(o.kind === K_MINE && o.state === 1)) this.smash(o, false);
      return;
    }
    this.die(x, y);
  }

  /** The twin smashes light sides like the spark; a dark hit just destroys the twin. */
  private collideTwin(o: Obstacle, prism: boolean): void {
    if (!o.active) return;
    const x = this.tsx, y = this.tsy, sr = this.sr * 0.85;
    let side = 0;
    switch (o.kind) {
      case K_HALF: case K_FALL: case K_COMET: side = halfDiskContact(o.x, o.y, o.rot, o.r, x, y, sr, prism); break;
      case K_SHARD: side = shardContact(o.x, o.y, o.rot, o.r, x, y, sr, prism); break;
      case K_VOID: case K_SEEKER: side = darkDiskContact(o.x, o.y, o.r, x, y, sr, prism); break;
      case K_MINE: if (o.state === 0) side = darkDiskContact(o.x, o.y, o.r, x, y, sr, prism); break;
      case K_HOLE: side = darkDiskContact(o.x, o.y, o.r * 0.75, x, y, sr, prism); break;
      case K_RING: if (ringContact(o.x, o.y, o.r, OB.ringThickness, x, y, sr) !== 0) side = SIDE_LIGHT; break;
      case K_BLADE: {
        const c = Math.cos(o.rot) * o.r, s = Math.sin(o.rot) * o.r;
        if (segmentDistance(x, y, o.x - c, o.y - s, o.x + c, o.y + s) < OB.bladeWidth * 0.5 + sr) side = prism ? SIDE_LIGHT : SIDE_DARK;
        break;
      }
    }
    if (side === SIDE_LIGHT) this.smash(o, false);
    else if (side === SIDE_DARK && this.ghostT <= 0) this.loseTwin();
  }

  /** Heated-core spikes. */
  private checkSpikes(): void {
    if (this.heatState !== 2 || this.mode !== MODE_PLAY) return;
    const len = CO.radius + CO.heatSpikeLen * this.heatExt;
    for (let i = 0; i < this.spikeCount; i++) {
      const a = this.spikeAng[i];
      const bx = this.cx + Math.cos(a) * len, by = this.cy + Math.sin(a) * len;
      const d = segmentDistance(this.sx, this.sy, this.cx, this.cy, bx, by);
      if (d < (CO.heatSpikeWidth * 0.5 + this.sr) * CFG.hitbox.darkScale) {
        if (this.prismT > 0 || this.rocketT > 0 || this.invulnT > 0 || this.ghostT > 0 || this.god) return;
        if (this.shield) {
          this.shield = false;
          this.invulnT = BO.shieldInvuln;
          this.ev.shieldBreak(this.sx, this.sy);
          return;
        }
        this.die(this.sx, this.sy);
        return;
      }
    }
  }

  smash(o: Obstacle, viaBolt: boolean): void {
    if (!o.active) return;
    o.active = false;
    // the spark itself hit it: bounce away from the core (lightning chains don't move the spark)
    if (!viaBolt) this.bounce(o.kind === K_RING && o.state === 2 ? SP.bounceThread : SP.bounceSmash);
    let base: number;
    switch (o.kind) {
      case K_HALF: base = o.r > 66 ? SC.smashLarge : o.r > 48 ? SC.smashMedium : SC.smashSmall; break;
      case K_FALL: base = SC.smashFalling; break;
      case K_SHARD: base = SC.shard; this.stats.shards++; break;
      case K_RING: base = SC.ringRim; break;
      case K_MINE: base = SC.mineDefuse; break;
      case K_VOID: base = SC.voidSmash; this.stats.voidSmashes++; break;
      case K_COMET: base = SC.cometSmash; break;
      case K_BLADE: base = SC.bladeSmash; break;
      case K_SEEKER: base = SC.seekerSmash; break;
      case K_HOLE: base = SC.holeSmash; break;
      default: base = SC.smashSmall;
    }
    if (this.prismT > 0) this.stats.prismSmashes++;
    this.chain = this.chainT > 0 ? this.chain + 1 : 1;
    this.chainT = SC.chainWindow;
    if (this.chain > this.stats.maxChain) this.stats.maxChain = this.chain;
    let bonus = 0;
    if (this.chain >= 2) {
      const tbl = SC.chainBonus;
      bonus = this.chain < tbl.length ? tbl[this.chain] : tbl[tbl.length - 1] * Math.pow(2, this.chain - tbl.length + 1);
      bonus = Math.min(bonus, 2560);
    }
    const pts = this.award(base);
    const bonusPts = this.award(bonus);
    if (this.mode === MODE_PLAY) {
      this.score += pts + bonusPts;
      this.stats.smashes++;
      this.addBar(MU.smashFill * (o.kind === K_FALL ? 1.6 : o.r > 60 ? 1.3 : 1));
    }
    this.ev.smash(o.x, o.y, o.r, o.kind, this.chain, pts, o.rot);
    if (this.chain >= 2) this.ev.chain(this.chain, bonusPts, o.x, o.y);

    // lightning: arc to nearby light objects
    if (this.boltT > 0 && !viaBolt) {
      let fromX = o.x, fromY = o.y;
      for (let j = 0; j < BO.lightningJumps; j++) {
        const t = this.nearestSmashable(fromX, fromY, BO.lightningRange);
        if (!t) break;
        const b = this.bolts.get();
        if (b) { b.ax = fromX; b.ay = fromY; b.bx = t.x; b.by = t.y; b.t = 0; b.seed = Math.random() * 1000; }
        fromX = t.x; fromY = t.y;
        this.smash(t, true);
      }
    }
  }

  private nearestSmashable(x: number, y: number, range: number): Obstacle | null {
    let best: Obstacle | null = null;
    let bd = range * range;
    const items = this.obs.items;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      if (!o.active || o.kind === K_MINE || o.kind === K_VOID || o.kind === K_LASER || o.kind === K_HOLE) continue;
      const dx = o.x - x, dy = o.y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  private threadRing(o: Obstacle): void {
    const pts = this.award(SC.ringThread);
    if (this.mode === MODE_PLAY) {
      this.score += pts;
      this.stats.threads++;
    }
    this.ev.thread(o.x, o.y, pts);
    o.state = 2; // threaded → strongest bounce
    this.smash(o, false);
  }

  die(x: number, y: number): void {
    if (this.mode !== MODE_PLAY) return;
    this.mode = MODE_DEAD;
    this.deathX = x; this.deathY = y;
    this.deadT = 0;
    this.stats.score = this.score;
    this.held = false;
    this.ev.death(x, y);
  }

  // ------------------------------------------------------------------ scoring

  addBar(v: number): void {
    if (this.mode !== MODE_PLAY) return;
    this.bar += v;
    this.comboT = MU.comboTimeout;
    this.comboLive = true;
    while (this.mult < MU.max && this.bar >= this.barNeed()) {
      this.bar -= this.barNeed();
      this.mult++;
      if (this.mult > this.stats.peakMult) this.stats.peakMult = this.mult;
      this.ev.multUp(this.mult);
    }
    if (this.mult >= MU.max) this.bar = Math.min(this.bar, this.barNeed());
  }

  private updateScore(dt: number): void {
    if (this.mode !== MODE_PLAY) return;
    this.checkSpikes();
    if (this.chainT > 0) {
      this.chainT -= dt;
      if (this.chainT <= 0) this.chain = 0;
    }
    // survival slowly fills the bar
    this.bar += MU.survivalFill * dt;
    while (this.mult < MU.max && this.bar >= this.barNeed()) {
      this.bar -= this.barNeed();
      this.mult++;
      if (this.mult > this.stats.peakMult) this.stats.peakMult = this.mult;
      this.ev.multUp(this.mult);
    }
    if (this.mult >= MU.max) this.bar = Math.min(this.bar, this.barNeed());
    if (this.comboLive) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        this.comboLive = false;
        this.noteIdx = 0;
        this.bar = 0;
        if (this.mult > 1) {
          this.mult--;
          this.ev.multDown(this.mult);
        }
      }
    }
    this.stats.score = this.score;
  }

  private updateFx(dt: number): void {
    const fl = this.floaters.items;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      if (!f.active) continue;
      f.t += dt;
      if (f.t >= f.life) f.active = false;
    }
    const bl = this.bolts.items;
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      if (!b.active) continue;
      b.t += dt;
      if (b.t > 0.32) b.active = false;
    }
    const sh = this.shocks.items;
    for (let i = 0; i < sh.length; i++) {
      const s = sh[i];
      if (!s.active) continue;
      s.t += dt;
      if (s.t >= s.dur) s.active = false;
    }
  }

  /** angle (rad) from the spark to a world point, relative to its travel direction */
  angleAhead(x: number, y: number): number {
    return angleDiff(Math.atan2(y - this.cy, x - this.cx), this.ang);
  }
}
