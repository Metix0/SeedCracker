import { SH } from './shaders';
import type { Renderer } from './renderer';

/** Particle kinds */
export const P_GLOW = 0;   // soft additive spark
export const P_SHARD = 1;  // physical debris triangle (light or dark)
export const P_STREAK = 2; // velocity-stretched line
export const P_RINGLET = 3; // tiny expanding ring

/**
 * Structure-of-arrays particle system with a fixed capacity: emitting never allocates,
 * and the oldest particle is overwritten when full.
 */
export class Particles {
  readonly cap: number;
  private x: Float32Array; private y: Float32Array;
  private vx: Float32Array; private vy: Float32Array;
  private life: Float32Array; private max: Float32Array;
  private size: Float32Array; private drag: Float32Array; private grav: Float32Array;
  private rot: Float32Array; private spin: Float32Array;
  private r: Float32Array; private g: Float32Array; private b: Float32Array; private a: Float32Array;
  private kind: Uint8Array;
  private dark: Uint8Array;
  private next = 0;
  /** global multiplier on emitted counts (battery saver lowers it) */
  density = 1;

  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap); this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.size = new Float32Array(cap); this.drag = new Float32Array(cap); this.grav = new Float32Array(cap);
    this.rot = new Float32Array(cap); this.spin = new Float32Array(cap);
    this.r = new Float32Array(cap); this.g = new Float32Array(cap); this.b = new Float32Array(cap); this.a = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.dark = new Uint8Array(cap);
  }

  clear(): void {
    this.life.fill(0);
  }

  emit(
    kind: number, x: number, y: number, vx: number, vy: number, life: number, size: number,
    r: number, g: number, b: number, a: number, drag = 2, grav = 0, dark = 0,
  ): void {
    const i = this.next;
    this.next = (i + 1) % this.cap;
    this.kind[i] = kind;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.max[i] = life; this.size[i] = size;
    this.drag[i] = drag; this.grav[i] = grav;
    this.rot[i] = Math.random() * 6.283; this.spin[i] = (Math.random() - 0.5) * 14;
    this.r[i] = r; this.g[i] = g; this.b[i] = b; this.a[i] = a;
    this.dark[i] = dark;
  }

  /** Radial burst helper. */
  burst(
    kind: number, x: number, y: number, n: number, speedMin: number, speedMax: number,
    life: number, size: number, r: number, g: number, b: number, a: number, drag = 2.5,
  ): void {
    const cnt = Math.max(1, Math.round(n * this.density));
    for (let k = 0; k < cnt; k++) {
      const ang = Math.random() * 6.2831853;
      const sp = speedMin + Math.random() * (speedMax - speedMin);
      this.emit(kind, x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, life * (0.6 + Math.random() * 0.6),
        size * (0.6 + Math.random() * 0.8), r, g, b, a, drag);
    }
  }

  update(dt: number): void {
    const n = this.cap;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= k;
      this.vy[i] = this.vy[i] * k + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.spin[i] * dt * (this.kind[i] === P_SHARD ? 1 : 0);
    }
  }

  draw(rd: Renderer, lr: number, lg: number, lb: number, dr: number, dg: number, db: number): void {
    const n = this.cap;
    for (let i = 0; i < n; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const t = l / this.max[i];
      const a = this.a[i] * (t < 0.3 ? t / 0.3 : 1);
      const s = this.size[i];
      const x = this.x[i], y = this.y[i];
      switch (this.kind[i]) {
        case P_GLOW: {
          const sz = s * (0.5 + 0.5 * t);
          rd.push(SH.GLOW, x, y, 0, sz, sz, this.r[i], this.g[i], this.b[i], a, 0, 0, 0, 0, 0, 0, 0, 0);
          break;
        }
        case P_SHARD: {
          const sz = s * (0.7 + 0.3 * t);
          if (this.dark[i]) {
            rd.push(SH.TRI, x, y, this.rot[i], sz * 1.5, sz * 1.5, dr, dg, db, a, lr * 0.4, lg * 0.4, lb * 0.4, 0.5, sz, 0, 1, 1);
          } else {
            rd.push(SH.TRI, x, y, this.rot[i], sz * 1.6, sz * 1.6, this.r[i], this.g[i], this.b[i], a, this.r[i], this.g[i], this.b[i], 0.6 * a, sz, 0, 1, 1);
          }
          break;
        }
        case P_STREAK: {
          const vx = this.vx[i], vy = this.vy[i];
          const sp = Math.sqrt(vx * vx + vy * vy);
          const len = Math.min(60, sp * 0.035 + 1);
          const r = s * 0.5;
          rd.push(SH.SEG, x, y, Math.atan2(vy, vx), len + r * 4, r * 4, this.r[i] * 1.5, this.g[i] * 1.5, this.b[i] * 1.5, a,
            this.r[i], this.g[i], this.b[i], a * 0.7, len, r, r * 1.2, 0);
          break;
        }
        case P_RINGLET: {
          const R = s * (1.6 - t);
          rd.push(SH.WAVE, x, y, 0, R * 1.5 + 4, R * 1.5 + 4, this.r[i], this.g[i], this.b[i], a * t, 0, 0, 0, 0, R, 3, 1, 0);
          break;
        }
      }
    }
  }
}
