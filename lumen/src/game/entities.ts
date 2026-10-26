import { CFG } from '../config';
import { TextBuf } from '../render/text';

export const K_HALF = 1;
export const K_FALL = 2;
export const K_SHARD = 3;
export const K_RING = 4;
export const K_MINE = 5;
export const K_VOID = 6;
export const K_COMET = 7;

export const BOOSTERS = ['prism', 'rocket', 'bolt', 'magnet', 'shield', 'slow', 'nova', 'tether'] as const;
export type BoosterId = (typeof BOOSTERS)[number];
export const B_PRISM = 0, B_ROCKET = 1, B_BOLT = 2, B_MAGNET = 3, B_SHIELD = 4, B_SLOW = 5, B_NOVA = 6, B_TETHER = 7;

export class Obstacle {
  active = false;
  kind = 0;
  x = 0; y = 0; px = 0; py = 0;
  vx = 0; vy = 0;
  rot = 0; prot = 0; spin = 0;
  r = 0;
  t = 0;
  fade = 0;
  flash = 0;
  /** mine: fuse remaining; ring: engaged flag */
  fuse = 0;
  state = 0;
  waveR = 0;
  waveT = 0;
  /** near-miss bookkeeping */
  nearIn = false;
  nearDone = false;
  /** sub-step stash */
  sx = 0; sy = 0;
  reset(): void {
    this.active = true;
    this.t = 0; this.fade = 0; this.flash = 0; this.fuse = 0; this.state = 0;
    this.waveR = 0; this.waveT = 0; this.nearIn = false; this.nearDone = false;
    this.spin = 0;
  }
}

export class Orb {
  active = false;
  x = 0; y = 0; px = 0; py = 0;
  vx = 0; vy = 0;
  anchored = false;
  ox = 0; oy = 0; // offset from core when anchored
  t = 0;
  delay = 0;
  life = 0;
  homing = 0;
  big = false;
  dying = 0;
}

export class Bubble {
  active = false;
  type = 0;
  x = 0; y = 0; px = 0; py = 0;
  ox = 0; oy = 0;
  t = 0;
  life = 0;
}

export class Warning {
  active = false;
  kind = 0; // K_FALL or K_COMET
  x = 0; y = 0; dx = 0; dy = 0;
  t = 0;
  dur = 0;
  r = 0;
  speed = 0;
  rot = 0;
  spin = 0;
}

export class Floater {
  active = false;
  buf = new TextBuf();
  x = 0; y = 0;
  t = 0;
  life = 1;
  size = 30;
  /** 0 = score (+N), 1 = chain text, 2 = near miss, 3 = info */
  style = 0;
  r = 1; g = 1; b = 1;
}

export class Bolt {
  active = false;
  ax = 0; ay = 0; bx = 0; by = 0;
  t = 0;
  seed = 0;
}

export class Shock {
  active = false;
  x = 0; y = 0;
  t = 0;
  dur = 0.6;
  maxR = 300;
  r = 1; g = 1; b = 1; a = 1;
  band = 20;
}

/** Fixed-size pool; `get()` returns an inactive item (or recycles index 0 when full). */
export class Pool<T extends { active: boolean }> {
  readonly items: T[];
  private cursor = 0;
  constructor(n: number, make: () => T) {
    this.items = new Array<T>(n);
    for (let i = 0; i < n; i++) this.items[i] = make();
  }
  get(): T | null {
    const n = this.items.length;
    for (let k = 0; k < n; k++) {
      const i = (this.cursor + k) % n;
      const it = this.items[i];
      if (!it.active) {
        this.cursor = (i + 1) % n;
        it.active = true;
        return it;
      }
    }
    return null;
  }
  clear(): void {
    for (let i = 0; i < this.items.length; i++) this.items[i].active = false;
  }
  countActive(): number {
    let c = 0;
    for (let i = 0; i < this.items.length; i++) if (this.items[i].active) c++;
    return c;
  }
}

export interface RunStats {
  score: number;
  orbs: number;
  smashes: number;
  shards: number;
  maxChain: number;
  peakMult: number;
  nearMisses: number;
  time: number;
  threads: number;
  prismSmashes: number;
  voidSmashes: number;
  holdOrbsMax: number;
  phase: number;
  boosters: number[];
  crumbs: number;
  daily: boolean;
}

export function newRunStats(): RunStats {
  return {
    score: 0, orbs: 0, smashes: 0, shards: 0, maxChain: 0, peakMult: 1, nearMisses: 0, time: 0,
    threads: 0, prismSmashes: 0, voidSmashes: 0, holdOrbsMax: 0, phase: 1,
    boosters: [0, 0, 0, 0, 0, 0, 0, 0], crumbs: 0, daily: false,
  };
}

export const SPARK_R = CFG.spark.radius;
