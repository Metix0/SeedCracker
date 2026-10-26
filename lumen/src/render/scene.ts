import { CFG } from '../config';
import { TAU, clamp, easeOutBack, hash1, lerp } from '../core/math';
import {
  BOOSTER_COUNT, K_BLADE, K_COMET, K_FALL, K_HALF, K_HOLE, K_LASER, K_MINE, K_RING, K_SEEKER, K_SHARD, K_VOID,
} from '../game/entities';
import type { ThemeMix } from '../game/themes';
import { MODE_DEAD, MODE_PLAY, type World } from '../game/world';
import type { Look } from '../meta/cosmetics';
import type { Particles } from './particles';
import type { Renderer } from './renderer';
import { SH } from './shaders';
import { ICON, TextBuf } from './text';

const SP = CFG.spark;
const CO = CFG.core;
const OB = CFG.obstacle;

export const BOOSTER_COLORS: [number, number, number][] = [
  [2.4, 2.2, 2.6],   // prism
  [2.8, 1.1, 0.35],  // rocket
  [1.2, 1.9, 3.0],   // bolt
  [2.8, 0.7, 1.3],   // magnet
  [0.9, 2.6, 1.4],   // shield
  [1.5, 1.2, 2.9],   // slow
  [3.0, 2.3, 1.0],   // nova
  [0.9, 2.3, 2.8],   // tether
  [1.6, 2.8, 0.6],   // spring
  [3.0, 2.4, 0.6],   // double points
  [2.0, 1.9, 2.8],   // ghost
  [0.8, 2.0, 3.0],   // levitation
  [2.8, 2.6, 1.8],   // light shower
  [1.0, 2.6, 3.0],   // freeze
  [2.8, 1.2, 2.2],   // twin
];
const BOOSTER_ICONS = [
  ICON.prism, ICON.rocket, ICON.bolt, ICON.magnet, ICON.shield, ICON.slow, ICON.nova, ICON.tether,
  ICON.spring, ICON.double, ICON.ghost, ICON.levit, ICON.shower, ICON.freeze, ICON.twin,
];

/** Presentation state from the Game (screen-space info, banners, settings). */
export interface DrawCtx {
  time: number;
  beat: number;
  look: Look;
  theme: ThemeMix;
  camX: number;
  camY: number;
  safeTop: number;    // world units
  safeBottom: number;
  hudScore: number;
  hudPulse: number;
  hudVisible: number;  // 0..1
  bannerT: number;     // seconds since banner start (-1 none)
  bannerKind: number;  // 0 multiplier, 1 phase, 2 info
  bannerMain: TextBuf;
  bannerSub: TextBuf;
  beamT: number;       // multiplier beam age (-1 none)
  countdown: number;   // 3,2,1 or 0
  countdownT: number;
  reduced: boolean;
  highContrast: boolean;
  shieldFlash: number;
}

// starfield (normalized positions)
const STARS = 260, DUST = 90, BOKEH = 20;
const starX = new Float32Array(STARS), starY = new Float32Array(STARS), starS = new Float32Array(STARS), starP = new Float32Array(STARS);
const dustX = new Float32Array(DUST), dustY = new Float32Array(DUST), dustS = new Float32Array(DUST), dustV = new Float32Array(DUST);
const bokX = new Float32Array(BOKEH), bokY = new Float32Array(BOKEH), bokS = new Float32Array(BOKEH), bokP = new Float32Array(BOKEH);
for (let i = 0; i < STARS; i++) { starX[i] = Math.random(); starY[i] = Math.random(); starS[i] = 1.2 + Math.pow(Math.random(), 3) * 3.5; starP[i] = Math.random() * TAU; }
for (let i = 0; i < DUST; i++) { dustX[i] = Math.random(); dustY[i] = Math.random(); dustS[i] = 2 + Math.random() * 5; dustV[i] = 0.3 + Math.random(); }
for (let i = 0; i < BOKEH; i++) { bokX[i] = Math.random(); bokY[i] = Math.random(); bokS[i] = 60 + Math.random() * 150; bokP[i] = Math.random() * TAU; }

const rgb = new Float32Array(3);
function hue(h: number, k: number): Float32Array {
  rgb[0] = (0.5 + 0.5 * Math.cos(TAU * (h + 0.0))) * k;
  rgb[1] = (0.5 + 0.5 * Math.cos(TAU * (h + 0.33))) * k;
  rgb[2] = (0.5 + 0.5 * Math.cos(TAU * (h + 0.67))) * k;
  return rgb;
}

const wrap = (v: number, size: number): number => ((v % size) + size) % size - size / 2;

export class SceneDrawer {
  private tb = new TextBuf();
  private multBuf = new TextBuf();

  draw(rd: Renderer, w: World, alpha: number, p: Particles, c: DrawCtx, ghostX: number, ghostY: number, ghostOn: boolean): void {
    const th = c.theme;
    const cx = lerp(w.cpx, w.cx, alpha), cy = lerp(w.cpy, w.cy, alpha);
    const sx = lerp(w.spx, w.sx, alpha), sy = lerp(w.spy, w.sy, alpha);
    const halfW = rd.halfW, halfH = rd.halfH;

    this.background(rd, c, cx, cy, halfW, halfH);
    this.warnings(rd, w, c, halfW, halfH);
    this.heat(rd, w, c, cx, cy);
    this.orbs(rd, w, alpha, c);
    this.obstacles(rd, w, alpha, c);
    this.core(rd, w, c, cx, cy);
    this.tether(rd, w, c, cx, cy, sx, sy);
    if (ghostOn) this.ghost(rd, ghostX, ghostY, c);
    if (w.mode !== MODE_DEAD) {
      this.trail(rd, w, c);
      if (w.twinT > 0) this.twin(rd, w, c, alpha, cx, cy);
      this.spark(rd, w, c, sx, sy);
    }
    if (w.mode === MODE_PLAY) this.edgeArrows(rd, w, c, halfW, halfH);
    this.bubbles(rd, w, alpha, c);
    p.draw(rd, th.light[0], th.light[1], th.light[2], th.dark[0], th.dark[1], th.dark[2]);
    this.bolts(rd, w);
    this.shocks(rd, w);
    if (c.beamT >= 0) this.beam(rd, c, cx, cy, halfH);
    this.floaters(rd, w, c);
    this.banner(rd, c, cx, cy, halfH);
    if (w.mode === MODE_PLAY) this.hud(rd, w, c, halfW, halfH);
    if (c.countdown > 0) this.countdown(rd, c);
  }

  // ---------------------------------------------------------------- background layers

  private background(rd: Renderer, c: DrawCtx, cx: number, cy: number, halfW: number, halfH: number): void {
    const th = c.theme;
    const TW = halfW * 2 + 300, TH = halfH * 2 + 300;
    const t = c.time;
    // stars (far)
    for (let i = 0; i < STARS; i++) {
      const x = wrap(starX[i] * TW - cx * 0.04 + t * 3, TW);
      const y = wrap(starY[i] * TH - cy * 0.04 + t * 1.5, TH);
      const tw = 0.55 + 0.45 * Math.sin(t * (1.2 + (i % 7) * 0.4) + starP[i]);
      const s = starS[i];
      rd.glow(x, y, s * 3.2, th.star[0], th.star[1], th.star[2], 0.55 * tw * (s > 3 ? 1.4 : 1));
    }
    // dust (mid)
    for (let i = 0; i < DUST; i++) {
      const x = wrap(dustX[i] * TW - cx * 0.18 + t * 9 * dustV[i], TW);
      const y = wrap(dustY[i] * TH - cy * 0.18 - t * 14 * dustV[i], TH);
      rd.glow(x, y, dustS[i] * 3, th.bg3[0], th.bg3[1], th.bg3[2], 0.12);
    }
    // bokeh (near)
    for (let i = 0; i < BOKEH; i++) {
      const x = wrap(bokX[i] * TW - cx * 0.45 + Math.sin(t * 0.1 + bokP[i]) * 40, TW);
      const y = wrap(bokY[i] * TH - cy * 0.45 + Math.cos(t * 0.08 + bokP[i]) * 40, TH);
      const k = 0.022 + 0.016 * Math.sin(t * 0.3 + bokP[i]);
      const s = bokS[i];
      rd.push(SH.DISC, x, y, 0, s * 1.35, s * 1.35, 0, 0, 0, 0,
        th.bg3[0], th.bg3[1], th.bg3[2], k, s * 0.82, s * 0.16, 0, 0);
    }
  }

  // ---------------------------------------------------------------- warnings

  private warnings(rd: Renderer, w: World, c: DrawCtx, halfW: number, halfH: number): void {
    const items = w.warns.items;
    const top = c.camY - halfH + c.safeTop;
    for (let i = 0; i < items.length; i++) {
      const wn = items[i];
      if (!wn.active) continue;
      const f = wn.t / wn.dur;
      const blink = 0.55 + 0.45 * Math.sin(wn.t * 22);
      const a = Math.min(1, wn.t * 6) * (0.6 + 0.4 * blink);
      if (wn.kind === K_FALL) {
        // dashed vertical lane + marker at the top edge
        rd.seg(wn.x, top, wn.x, c.camY + halfH, 2.2, 1.6, 0.35, 0.3, a * 0.75, 1.4, 0.15, 0.1, a * 0.5, 6, 34);
        rd.push(SH.SEG, wn.x, top + 6, 0, wn.r + 10, 14, 1.8, 0.4, 0.3, a * 0.6, 1.2, 0.2, 0.1, a * 0.4, wn.r, 3, 4, 0);
        rd.push(SH.TRI, wn.x, top + 34 + Math.sin(wn.t * 10) * 4, Math.PI, 30, 30, 2.4, 0.55, 0.4, a, 1.6, 0.3, 0.2, a, 14, 0, 1, 1);
        // shrinking circle telegraph of the size
        rd.push(SH.RING, wn.x, top + 34, 0, wn.r * 0.5 + 10, wn.r * 0.5 + 10, 1.6, 0.4, 0.3, 1, 0, 0, 0, 0, wn.r * 0.4 * (1 - f) + 14, 3, 0, a * 0.7);
      } else {
        const L = 3200;
        rd.seg(wn.x, wn.y, wn.x + wn.dx * L, wn.y + wn.dy * L, 2.4, 1.8, 0.5, 0.35, a * 0.8, 1.5, 0.25, 0.1, a * 0.5, 7, 40);
        // marker where the comet enters the view
        const ex = clamp(wn.x + wn.dx * 1500 - wn.dx * Math.min(halfW, halfH) * 0.9, c.camX - halfW + 40, c.camX + halfW - 40);
        const ey = clamp(wn.y + wn.dy * 1500 - wn.dy * Math.min(halfW, halfH) * 0.9, top + 40, c.camY + halfH - 40 - c.safeBottom);
        rd.push(SH.TRI, ex, ey, Math.atan2(wn.dy, wn.dx) - Math.PI / 2, 30, 30, 2.6, 0.7, 0.4, a, 1.6, 0.3, 0.2, a, 14, 0, 1, 1);
      }
    }
  }

  private heat(rd: Renderer, w: World, c: DrawCtx, cx: number, cy: number): void {
    if (w.heatState === 0 && w.heatExt <= 0.001) return;
    for (let i = 0; i < w.spikeCount; i++) {
      const a = w.spikeAng[i];
      const dx = Math.cos(a), dy = Math.sin(a);
      if (w.heatState === 1) {
        const k = Math.min(1, w.heatT / 0.3) * (0.6 + 0.4 * Math.sin(c.time * 26));
        const L = CO.radius + CO.heatSpikeLen;
        rd.seg(cx + dx * CO.radius, cy + dy * CO.radius, cx + dx * L, cy + dy * L, 2, 2.2, 0.35, 0.2, k * 0.8, 1.6, 0.2, 0.1, k * 0.5, 8, 22);
      }
      if (w.heatExt > 0.001) {
        const L = CO.radius + CO.heatSpikeLen * w.heatExt;
        // dark spike with glowing hot rim
        rd.seg(cx, cy, cx + dx * L, cy + dy * L, CO.heatSpikeWidth * 0.5 * (1.1 - 0.3 * w.heatExt), 0.05, 0.01, 0.01, 1, 2.6, 0.35, 0.12, 0.9, 7, 0);
      }
    }
  }

  // ---------------------------------------------------------------- orbs & obstacles

  private orbs(rd: Renderer, w: World, alpha: number, c: DrawCtx): void {
    const th = c.theme;
    const items = w.orbs.items;
    const R = CFG.orb.radius;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      if (!o.active || o.t < o.delay) continue;
      const age = o.t - o.delay;
      let s = age < 0.3 ? easeOutBack(age / 0.3) : 1;
      if (o.dying > 0) s *= o.dying / 0.35;
      const remain = o.life - age;
      const blink = remain < 1.5 ? 0.6 + 0.4 * Math.sin(age * 20) : 1;
      const x = lerp(o.px, o.x, alpha), y = lerp(o.py, o.y, alpha);
      const pulse = 1 + 0.08 * Math.sin(c.time * 6 + i);
      const r = R * s * pulse;
      rd.glow(x, y, r * 3.4, th.orb[0], th.orb[1], th.orb[2], 0.16 * blink);
      rd.push(SH.DISC, x, y, 0, r * 2.2, r * 2.2, th.orb[0], th.orb[1], th.orb[2], blink,
        th.orb[0], th.orb[1], th.orb[2], 0.7 * blink, r, r * 0.45, 0.6, 0);
    }
  }

  private obstacles(rd: Renderer, w: World, alpha: number, c: DrawCtx): void {
    const th = c.theme;
    const L = th.light, D = th.dark;
    const hc = c.highContrast;
    const lr = hc ? 1.9 : L[0], lg = hc ? 1.9 : L[1], lb = hc ? 1.9 : L[2];
    const items = w.obs.items;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      if (!o.active) continue;
      const x = lerp(o.px, o.x, alpha), y = lerp(o.py, o.y, alpha);
      const rot = lerp(o.prot, o.rot, alpha);
      const fade = o.fade;
      switch (o.kind) {
        case K_HALF: case K_FALL: {
          const r = o.r;
          if (o.kind === K_FALL) {
            rd.seg(x, y - r * 0.2, x, y - r * 2.6, r * 0.55, 0, 0, 0, 0, L[0] * 0.25, L[1] * 0.25, L[2] * 0.25, 0.35 * fade, r * 0.5, 0);
          }
          rd.push(SH.HALF, x, y, rot, r * 1.7, r * 1.7, lr, lg, lb, 1, D[0], D[1], D[2], 1, r, o.flash, fade, 0);
          break;
        }
        case K_COMET: {
          const r = o.r;
          const vl = Math.sqrt(o.vx * o.vx + o.vy * o.vy) || 1;
          const bx = x - (o.vx / vl) * 260, by = y - (o.vy / vl) * 260;
          rd.seg(x, y, bx, by, r * 0.55, L[0] * 0.9, L[1] * 0.9, L[2] * 0.9, 0.55, L[0], L[1], L[2], 0.5, r * 0.6, 0);
          rd.seg(x, y, x - (o.vx / vl) * 520, y - (o.vy / vl) * 520, r * 0.25, 0, 0, 0, 0, th.bg3[0], th.bg3[1], th.bg3[2], 0.45, r * 0.9, 0);
          rd.push(SH.HALF, x, y, rot, r * 2, r * 2, lr, lg, lb, 1, D[0], D[1], D[2], 1, r, 0, 1, 0);
          break;
        }
        case K_SHARD: {
          const r = o.r;
          rd.push(SH.TRI, x, y, rot, r * 1.8, r * 1.8, lr, lg, lb, 1, D[0], D[1], D[2], 1, r, o.flash, fade, 0);
          break;
        }
        case K_RING: {
          const r = o.r;
          const glowK = o.state === 1 ? 1.4 : 1;
          rd.push(SH.RING, x, y, 0, r + 26, r + 26, L[0] * 1.05 * glowK, L[1] * 1.05 * glowK, L[2] * 1.05 * glowK, 1, 0, 0, 0, 0, r, OB.ringThickness, 0, fade);
          // inner hint sparkle
          rd.glow(x, y, r * 0.8, th.orb[0], th.orb[1], th.orb[2], 0.08 + 0.05 * Math.sin(c.time * 5 + i));
          break;
        }
        case K_MINE: {
          const r = o.r;
          if (o.state === 0) {
            const urgency = clamp(1 - o.fuse / 3.5, 0, 1);
            const pulse = 0.5 + 0.5 * Math.sin(c.time * (5 + urgency * 22));
            rd.push(SH.RING, x, y, 0, r + 34, r + 34, 1.3 + pulse * 0.6, 0.12, 0.16, 1, 0.04, 0.0, 0.02, 1, r, 8, pulse * (0.4 + urgency), fade);
            rd.glow(x, y, r * 2.4, 1.6, 0.1, 0.12, (0.06 + 0.12 * pulse) * (0.5 + urgency));
          } else {
            const f = o.waveT / OB.mineWaveTime;
            rd.push(SH.WAVE, x, y, 0, o.waveR + 60, o.waveR + 60, 2.4, 0.25, 0.25, 1 - f * 0.5, 0, 0, 0, 0, o.waveR, OB.mineWaveBand * 0.7, 0.85, 0);
            rd.push(SH.RING, x, y, 0, o.waveR + 20, o.waveR + 20, 0.05, 0.0, 0.02, 1, 0, 0, 0, 0, o.waveR, OB.mineWaveBand * 0.35, 0, (1 - f) * 0.9);
          }
          break;
        }
        case K_VOID: {
          const r = o.r;
          const wob = 1 + 0.06 * Math.sin(c.time * 7 + i);
          rd.glow(x, y, r * 3.2, th.darkRim[0] * 0.5, th.darkRim[1] * 0.2, th.darkRim[2] * 0.6, 0.25);
          rd.push(SH.DISC, x, y, 0, r * 2.6, r * 2.6, 0.005, 0.0, 0.012, 1, th.darkRim[0], th.darkRim[1], th.darkRim[2], hc ? 1.4 : 0.9, r * wob, r * 0.3, 0, 0);
          rd.push(SH.WAVE, x, y, 0, r * 1.6, r * 1.6, th.darkRim[0], th.darkRim[1], th.darkRim[2], 0.8, 0, 0, 0, 0, r * wob, 3, 1, 0);
          break;
        }
        case K_BLADE: {
          // spinning red-hot rod: dark core with a glowing danger edge, hot hub
          const cr = Math.cos(rot) * o.r, sr = Math.sin(rot) * o.r;
          const hw = OB.bladeWidth * 0.5;
          rd.seg(x - cr, y - sr, x + cr, y + sr, hw, 0.09, 0.01, 0.02, fade, 2.6, 0.28, 0.16, 0.95 * fade, hw * 1.4, 0);
          rd.seg(x - cr * 0.96, y - sr * 0.96, x + cr * 0.96, y + sr * 0.96, hw * 0.28, 2.2, 0.5, 0.3, 0.9 * fade, 0, 0, 0, 0, 1, 0);
          rd.push(SH.DISC, x, y, 0, 30, 30, 0.12, 0.02, 0.03, fade, 2.4, 0.3, 0.2, 0.9 * fade, 11, 6, 0, 0);
          break;
        }
        case K_SEEKER: {
          // hunter: red arrowhead pointing where it flies, with a hungry pulse
          const r = o.r;
          const pulse = 0.6 + 0.4 * Math.sin(c.time * 14 + i);
          const ending = o.fuse < 1.2 ? (Math.sin(c.time * 30) > 0 ? 1 : 0.4) : 1;
          rd.glow(x, y, r * 4, 2.4, 0.2, 0.15, 0.3 * pulse * ending);
          rd.push(SH.TRI, x, y, rot - Math.PI / 2, r * 2, r * 2, 2.6, 0.32, 0.22, fade * ending, 2.4, 0.2, 0.1, 0.8 * fade, r * 1.25, 0, fade, 1);
          rd.push(SH.DISC, x, y, 0, r, r, 0.05, 0, 0, fade, 0, 0, 0, 0, r * 0.32, 2, 0, 0);
          break;
        }
        case K_HOLE: {
          // black hole: dark heart, an accretion ring and rings being sucked in
          const life = Math.min(1, o.t / 0.8, o.fuse / 0.8);
          const r = o.r * (0.4 + 0.6 * life);
          for (let k = 0; k < 3; k++) {
            const f = (c.time * 0.55 + k / 3) % 1;
            const R = OB.holePull * (1 - f) * life + r;
            rd.push(SH.WAVE, x, y, 0, R + 30, R + 30, 0.9, 0.3, 1.6, 0.35 * f * life, 0, 0, 0, 0, R, 6, 1, 0);
          }
          // thin hot accretion ring around a pitch-black heart (the deadly part must read as dark)
          rd.push(SH.WAVE, x, y, 0, r * 2.4, r * 2.4, 1.6, 0.55, 1.9, 0.6 * life, 0, 0, 0, 0, r * 1.45, 4, 1, 0);
          rd.push(SH.DISC, x, y, 0, r * 1.6, r * 1.6, 0.0, 0.0, 0.0, life, 0.9, 0.3, 1.5, 0.35 * life, r * 1.1, r * 0.12, 0, 0);
          break;
        }
        case K_LASER: {
          const L = o.r;
          const cr = Math.cos(o.rot) * L, sr = Math.sin(o.rot) * L;
          if (o.state === 0) {
            // charging: dashed line that flashes faster as it is about to fire
            const k = 1 - o.fuse / OB.laserWarn;
            const blink = 0.5 + 0.5 * Math.sin(c.time * (12 + k * 30));
            rd.seg(x - cr, y - sr, x + cr, y + sr, 1.6 + k * 2, 2.4, 0.35, 0.3, 0.45 + 0.4 * blink, 2.0, 0.2, 0.15, 0.35, 5, 30);
          } else {
            const k = o.fuse / OB.laserActive;
            const hw = OB.laserWidth * 0.5 * (0.7 + 0.3 * k);
            rd.seg(x - cr, y - sr, x + cr, y + sr, hw, 2.8, 2.4, 2.4, 1, 2.6, 0.3, 0.2, 0.95, hw * 1.6, 0);
          }
          break;
        }
      }
      if (w.freezeT > 0 && o.kind !== K_LASER) rd.glow(x, y, o.r * 2.2 + 20, 0.6, 1.6, 2.4, 0.22);
    }
  }

  /** Pulsing arrows on the screen edge for hazards that are about to fly in. */
  private edgeArrows(rd: Renderer, w: World, c: DrawCtx, halfW: number, halfH: number): void {
    const items = w.obs.items;
    const top = c.camY - halfH + c.safeTop + 100, bottom = c.camY + halfH - c.safeBottom - 30;
    const left = c.camX - halfW + 30, right = c.camX + halfW - 30;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      if (!o.active || o.kind === K_LASER || o.kind === K_HOLE || o.kind === K_RING) continue;
      const ox = o.x, oy = o.y;
      const outX = Math.max(0, Math.abs(ox - c.camX) - halfW), outY = Math.max(0, Math.abs(oy - c.camY) - halfH);
      const out = Math.max(outX, outY) - o.r;
      if (out <= 0) continue;
      // only things heading into the view
      if ((c.camX - ox) * o.vx + (c.camY - oy) * o.vy <= 0) continue;
      const sp = Math.sqrt(o.vx * o.vx + o.vy * o.vy) || 1;
      const eta = out / sp;
      if (eta > 1.6) continue;
      const k = 1 - eta / 1.6;
      const ax = clamp(ox, left, right), ay = clamp(oy, top, bottom);
      const blink = 0.6 + 0.4 * Math.sin(c.time * (10 + k * 14));
      const size = 14 + k * 10;
      rd.glow(ax, ay, size * 2.6, 2.4, 0.5, 0.25, 0.25 * k);
      rd.push(SH.TRI, ax, ay, Math.atan2(o.vy, o.vx) - Math.PI / 2, size * 1.6, size * 1.6, 2.6, 0.75, 0.35, (0.4 + 0.6 * k) * blink, 2.0, 0.4, 0.2, 0.8, size, 0, 1, 1);
    }
  }

  /** The twin spark (booster), mirrored through the core. */
  private twin(rd: Renderer, w: World, c: DrawCtx, alpha: number, cx: number, cy: number): void {
    const x = lerp(w.tspx, w.tsx, alpha), y = lerp(w.tspy, w.tsy, alpha);
    const ending = w.twinT < 1.2 ? (Math.sin(c.time * 30) > 0 ? 1 : 0.35) : 1;
    const col = BOOSTER_COLORS[14];
    rd.seg(cx, cy, x, y, 1.2, col[0] * 0.5, col[1] * 0.5, col[2] * 0.5, 0.6 * ending, col[0], col[1], col[2], 0.25 * ending, 4, 0);
    rd.glow(x, y, w.sr * 4, col[0], col[1], col[2], 0.2 * ending);
    rd.push(SH.SPARK, x, y, 0, w.sr * 2.8, w.sr * 2.8, col[0], col[1], col[2], 1, 0, 0, 0, 0, w.sr * 0.85, 0, 0.85 * ending, 0);
  }

  // ---------------------------------------------------------------- core

  private core(rd: Renderer, w: World, c: DrawCtx, cx: number, cy: number): void {
    const th = c.theme;
    const style = c.look.core;
    let heat = w.heatState === 1 ? 0.35 + 0.35 * Math.sin(c.time * 18) + Math.min(1, w.heatT / CO.heatWarn) * 0.3 : w.heatState === 2 ? 1 : 0;
    // the spark is falling dangerously close: the core glows hungry red, pulsing faster
    if (w.mode === MODE_PLAY && w.vr < 0) {
      const danger = clamp((SP.dangerRadius - w.orbitR) / (SP.dangerRadius - SP.deathRadius), 0, 1);
      if (danger > 0) heat = Math.max(heat, danger * (0.55 + 0.45 * Math.sin(c.time * (10 + danger * 16))));
    }
    const R = CO.radius * (1 + c.beat * 0.045 + heat * 0.06);
    const rot = w.crot;
    let spikes: number = CO.spikes, sl = 15;
    if (style === 1) { spikes = 22; sl = 22; }
    if (style === 2) { spikes = 40; sl = 3; }
    if (style === 3) { spikes = 10; sl = 9; }
    if (style === 4) { spikes = 60; sl = 1.5; }
    const rim0 = th.bg3[0] * 1.3, rim1 = th.bg3[1] * 1.3, rim2 = th.bg3[2] * 1.3;
    if (style === 4) {
      // accretion disc
      rd.push(SH.WAVE, cx, cy, 0, R * 2.6, R * 2.6, th.orb[0] * 0.8, th.orb[1] * 0.6, th.orb[2] * 0.5, 0.7, 0, 0, 0, 0, R * 1.45, 10, 1, 0);
    }
    rd.glow(cx, cy, R * 4, rim0, rim1, rim2, 0.18 + 0.1 * c.beat + heat * 0.25);
    rd.push(SH.STAR, cx, cy, rot, (R + sl) * 1.9, (R + sl) * 1.9, rim0, rim1, rim2, 1, th.dark[0] * 0.6, th.dark[1] * 0.6, th.dark[2] * 0.6, 1, R, sl, spikes, heat);
    if (style === 2) {
      rd.push(SH.RING, cx, cy, 0, R * 0.8, R * 0.8, th.bg3[0] * 1.5, th.bg3[1] * 1.5, th.bg3[2] * 1.5, 1, 0, 0, 0, 0, R * 0.55, 3, 0, 0.7);
    }
    if (w.mode !== MODE_PLAY) return;
    // combo bar around the core
    const need = w.barNeed();
    const f = w.mult >= CFG.multiplier.max ? 1 : clamp(w.bar / need, 0, 1);
    const ar = R + sl + 12;
    const urgency = w.comboLive && w.comboT < 0.7 ? 0.5 + 0.5 * Math.sin(c.time * 30) : 1;
    rd.push(SH.ARC, cx, cy, -Math.PI / 2, ar + 16, ar + 16, th.orb[0], th.orb[1], th.orb[2], urgency, 1, 1, 1, 0.1, ar, 5, f, 0);
    // multiplier on the core
    const tb = this.multBuf.clear().ch(0xd7).int(w.mult);
    const size = w.mult >= 10 ? 34 : 42;
    rd.text(tb, cx, cy + 1, size, 0, 1.6, 1.55, 1.6, 1, th.bg3[0], th.bg3[1], th.bg3[2], 0.9, 0.0);
  }

  private tether(rd: Renderer, w: World, c: DrawCtx, cx: number, cy: number, sx: number, sy: number): void {
    if (w.mode === MODE_DEAD) return;
    const th = c.theme;
    const n = SP.tetherSegments;
    const style = c.look.tether;
    const r0 = th.spark[0], r1 = th.spark[1], r2 = th.spark[2];
    // pin interpolated ends
    let ax = cx, ay = cy;
    for (let i = 1; i <= n; i++) {
      const bx = i === n ? sx : w.tx[i], by = i === n ? sy : w.ty[i];
      const k = i / n;
      switch (style) {
        case 1: // pearls
          rd.push(SH.DISC, bx, by, 0, 9, 9, r0 * 0.9, r1 * 0.9, r2 * 0.9, 0.9, r0, r1, r2, 0.4, 2.6 + k * 1.2, 3, 0.5, 0);
          break;
        case 2: { // helix
          const dx = bx - ax, dy = by - ay;
          const l = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / l, ny = dx / l;
          const ph = c.time * 9 + i * 0.9;
          const o1 = Math.sin(ph) * 5, o2 = Math.sin(ph - 0.9) * 5;
          rd.seg(ax + nx * o2, ay + ny * o2, bx + nx * o1, by + ny * o1, 1.1, r0, r1 * 0.6, r2, 0.9, r0, r1, r2, 0.4, 4);
          rd.seg(ax - nx * o2, ay - ny * o2, bx - nx * o1, by - ny * o1, 1.1, r0 * 0.6, r1, r2, 0.9, r0, r1, r2, 0.4, 4);
          break;
        }
        case 3: // chain
          if (i % 2 === 0) rd.seg(ax, ay, bx, by, 2.4, r0 * 0.8, r1 * 0.7, r2 * 0.4, 0.95, r0, r1, r2, 0.3, 3);
          else rd.push(SH.RING, (ax + bx) / 2, (ay + by) / 2, 0, 8, 8, r0, r1 * 0.8, r2 * 0.5, 1, 0, 0, 0, 0, 4, 1.6, 0, 1);
          break;
        case 4: { // electric arc
          const j = (hash1(i * 13.1 + Math.floor(c.time * 30)) - 0.5) * 9;
          rd.seg(ax, ay, bx + j, by - j, 1.2, r0 * 0.7, r1 * 0.9, r2 * 1.4, 1, 0.6, 0.9, 1.8, 0.6, 5);
          break;
        }
        default:
          rd.seg(ax, ay, bx, by, 1.9, r0 * 0.75, r1 * 0.75, r2 * 0.75, 0.9, r0, r1, r2, 0.35, 5);
      }
      ax = bx; ay = by;
    }
  }

  private trail(rd: Renderer, w: World, c: DrawCtx): void {
    const n = w.trailCount;
    if (n < 2) return;
    const L = SP.trailLength;
    const style = c.look.trail;
    const th = c.theme;
    let col0 = th.spark[0], col1 = th.spark[1], col2 = th.spark[2];
    const sc = c.look.sparkColor;
    if (sc) { col0 = sc[0]; col1 = sc[1]; col2 = sc[2]; }
    let px = w.sx, py = w.sy;
    const sr = w.sr;
    // real speed (orbiting and falling/bouncing alike) drives the trail's intensity
    const mvx = w.sx - w.spx, mvy = w.sy - w.spy;
    const speedK = clamp((Math.sqrt(mvx * mvx + mvy * mvy) * CFG.sim.hz) / 700, 0.15, 1.6);
    for (let k = 1; k < n; k++) {
      const idx = (w.trailHead - 1 - k + L * 4) % L;
      const x = w.trail[idx * 2], y = w.trail[idx * 2 + 1];
      const f = 1 - k / n;
      let r = col0, g = col1, b = col2;
      if (style === 4 || c.look.trailRainbow) { const h = hue(c.time * 0.6 + k * 0.03, 2.2); r = h[0]; g = h[1]; b = h[2]; }
      const a = f * f * speedK;
      switch (style) {
        case 1: // comet: wide, soft
          rd.seg(px, py, x, y, sr * (0.15 + 0.75 * f), r * 0.45, g * 0.45, b * 0.45, a * 0.45, r, g, b, a * 0.22, sr * 0.6);
          break;
        case 2: // stardust
          if (k % 3 === 0) {
            const j = Math.sin(k * 12.9 + c.time * 8) * sr * 0.7 * (1 - f);
            rd.glow(x + j, y - j, sr * (0.5 + 0.6 * f), r, g, b, a * 0.9);
          }
          break;
        case 3: // morse
          if (Math.floor(k / 3) % 2 === 0) rd.seg(px, py, x, y, sr * 0.35 * (0.4 + f), r, g, b, a, r, g, b, a * 0.5, sr * 0.4);
          break;
        default:
          rd.seg(px, py, x, y, sr * (0.06 + 0.42 * f), r * 0.8, g * 0.8, b * 0.8, a * 0.9, r, g, b, a * 0.22, sr * 0.35);
      }
      px = x; py = y;
    }
  }

  private ghost(rd: Renderer, x: number, y: number, c: DrawCtx): void {
    const t = c.theme;
    rd.push(SH.SPARK, x, y, 0, SP.radius * 4, SP.radius * 4, t.spark[0] * 0.6, t.spark[1] * 0.6, t.spark[2] * 0.9, 1, 0, 0, 0, 0, SP.radius * 0.9, 0, 0.28, 0);
  }

  private spark(rd: Renderer, w: World, c: DrawCtx, sx: number, sy: number): void {
    const th = c.theme;
    const look = c.look;
    let r = th.spark[0], g = th.spark[1], b = th.spark[2];
    if (look.sparkColor) { r = look.sparkColor[0]; g = look.sparkColor[1]; b = look.sparkColor[2]; }
    if (look.sparkRainbow) { const h = hue(c.time * 0.5, 2.4); r = h[0]; g = h[1]; b = h[2]; }
    const sr = w.sr;
    let vis = 1;
    if (w.invulnT > 0) vis = 0.45 + 0.55 * (Math.sin(c.time * 40) > 0 ? 1 : 0);
    if (w.ghostT > 0) {
      // ghost: translucent, shimmering spark
      vis = 0.38 + 0.12 * Math.sin(c.time * 9);
      if (w.ghostT < 1.2 && Math.sin(c.time * 30) > 0) vis = 0.85;
    }
    // motion blur: faint copies along the direction of travel
    const vx = w.sx - w.spx, vy = w.sy - w.spy;
    for (let k = 3; k >= 1; k--) {
      rd.push(SH.SPARK, sx - vx * k * 0.9, sy - vy * k * 0.9, 0, sr * 2.5, sr * 2.5, r, g, b, 1, 0, 0, 0, 0, sr * (1 - k * 0.12), look.sparkShape, 0.1 * vis, 0);
    }
    rd.glow(sx, sy, sr * 4.5, r, g, b, 0.16 * vis);
    const spin = c.time * 2.5;
    rd.push(SH.SPARK, sx, sy, look.sparkShape > 0 ? spin : 0, sr * 3.2, sr * 3.2, r, g, b, 1, 0, 0, 0, 0, sr, look.sparkShape, vis, 0);

    // prism armour
    if (w.prismT > 0) {
      const ending = w.prismT < 1.5 ? (Math.sin(c.time * 34) > 0 ? 1 : 0.25) : 1;
      let ar = look.armorColor[0], ag = look.armorColor[1], ab = look.armorColor[2];
      if (look.armorRainbow) { const h = hue(c.time * 0.8, 2.2); ar = h[0]; ag = h[1]; ab = h[2]; }
      const pr = hue(c.time * 0.7, 2.0);
      rd.push(SH.STAR, sx, sy, -c.time * 3, sr * 3.4, sr * 3.4, pr[0], pr[1], pr[2], ending, ar, ag, ab, 1, sr * 0.95, sr * 0.95, -8, 0);
    }
    if (w.rocketT > 0) {
      rd.glow(sx, sy, sr * 9, 2.6, 1.0, 0.3, 0.5);
    }
    if (w.shield) {
      const k = 0.55 + 0.15 * Math.sin(c.time * 5);
      rd.push(SH.BUBBLE, sx, sy, 0, sr * 3.2, sr * 3.2, 0.9, 2.4, 1.3, k, 0.02, 0.06, 0.04, 0, sr * 2.1, 0, 0, 0);
    }
  }

  private bubbles(rd: Renderer, w: World, alpha: number, c: DrawCtx): void {
    const items = w.bubbles.items;
    const R = CFG.booster.radius;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (!b.active) continue;
      const x = lerp(b.px, b.x, alpha), y = lerp(b.py, b.y, alpha);
      const pop = b.t < 0.4 ? easeOutBack(b.t / 0.4) : 1;
      const remain = b.life - b.t;
      const blink = remain < 2 ? (Math.sin(b.t * 24) > 0 ? 1 : 0.35) : 1;
      const col = BOOSTER_COLORS[b.type];
      const r = R * pop * (1 + 0.05 * Math.sin(c.time * 4));
      rd.glow(x, y, r * 3.4, col[0], col[1], col[2], 0.22 * blink);
      rd.push(SH.BUBBLE, x, y, 0, r * 2, r * 2, col[0], col[1], col[2], blink, 0.03, 0.02, 0.05, 1, r, 0, 0, 0);
      rd.icon(BOOSTER_ICONS[b.type], x, y + 1, r * 1.05, col[0] * 0.9 + 0.3, col[1] * 0.9 + 0.3, col[2] * 0.9 + 0.3, blink, Math.sin(c.time * 2) * 0.12);
    }
  }

  private bolts(rd: Renderer, w: World): void {
    const items = w.bolts.items;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (!b.active) continue;
      const a = 1 - b.t / 0.32;
      let px = b.ax, py = b.ay;
      const dx = b.bx - b.ax, dy = b.by - b.ay;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / l, ny = dx / l;
      const segs = 7;
      for (let k = 1; k <= segs; k++) {
        const f = k / segs;
        const j = k === segs ? 0 : (hash1(b.seed + k * 7.7 + Math.floor(b.t * 40)) - 0.5) * l * 0.18;
        const x = b.ax + dx * f + nx * j, y = b.ay + dy * f + ny * j;
        rd.seg(px, py, x, y, 2.2, 2.2, 2.6, 3.2, a, 0.7, 1.1, 2.4, a * 0.8, 8);
        px = x; py = y;
      }
    }
  }

  private shocks(rd: Renderer, w: World): void {
    const items = w.shocks.items;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      if (!s.active) continue;
      const f = s.t / s.dur;
      const e = 1 - (1 - f) * (1 - f) * (1 - f);
      const R = s.maxR * e;
      const band = s.band * (1 - f * 0.5);
      rd.push(SH.WAVE, s.x, s.y, 0, R + band * 3, R + band * 3, s.r, s.g, s.b, s.a * (1 - f), 0, 0, 0, 0, R, band, 0.9, 0);
    }
  }

  private beam(rd: Renderer, c: DrawCtx, cx: number, cy: number, halfH: number): void {
    const t = c.beamT;
    const dur = 0.9;
    if (t > dur) return;
    const f = t / dur;
    const a = (f < 0.12 ? f / 0.12 : 1 - (f - 0.12) / 0.88) * (c.reduced ? 0.5 : 1);
    const th = c.theme;
    const wdt = 38 * (1 - f * 0.6) + 6;
    rd.push(SH.BEAM, cx, c.camY, 0, wdt, halfH + 40, th.orb[0] * 0.8, th.orb[1] * 0.8, th.orb[2] * 0.8, a * 0.7, 0, 0, 0, 0, 0, 0, 0, 0);
    rd.push(SH.BEAM, cx, c.camY, 0, wdt * 0.2, halfH + 40, 2.2, 2.2, 2.2, a * 0.7, 0, 0, 0, 0, 0, 0, 0, 0);
    void cy;
  }

  private floaters(rd: Renderer, w: World, c: DrawCtx): void {
    const items = w.floaters.items;
    const th = c.theme;
    const minY = c.camY - rd.halfH + c.safeTop + 120;
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      if (!f.active) continue;
      const k = f.t / f.life;
      const pop = f.t < 0.18 ? easeOutBack(f.t / 0.18) : 1;
      const a = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
      const rise = f.style === 1 ? 26 : 60;
      const y = Math.max(minY, f.y - easeOutCubic(k) * rise);
      const size = f.size * pop;
      rd.text(f.buf, f.x, y, size, 0, f.r, f.g, f.b, a, th.bg3[0] * 0.9, th.bg3[1] * 0.9, th.bg3[2] * 0.9, a * 0.75, 0.02);
    }
  }

  private banner(rd: Renderer, c: DrawCtx, cx: number, cy: number, halfH: number): void {
    if (c.bannerT < 0) return;
    const t = c.bannerT;
    const dur = c.bannerKind === 1 ? 2.4 : 1.7;
    if (t > dur) return;
    const th = c.theme;
    const inK = t < 0.35 ? easeOutBack(t / 0.35) : 1;
    const out = t > dur - 0.4 ? (dur - t) / 0.4 : 1;
    const main = c.bannerKind === 1 ? 96 : 84;
    const hudBottom = c.camY - halfH + c.safeTop + 170;
    const y = Math.max(hudBottom + main * 0.5, c.bannerKind === 1 ? c.camY - halfH * 0.42 : cy - CFG.spark.orbitRadius - 110);
    const spread = (1 - out) * 0.25;
    const bx = c.bannerKind === 1 ? c.camX : cx;
    rd.text(c.bannerMain, bx, y, main * inK, 0,
      2.2, 2.1, 2.2, out, th.bg3[0] * 1.5, th.bg3[1] * 1.5, th.bg3[2] * 1.5, out, 0.04 + spread);
    if (c.bannerSub.len > 0) {
      rd.text(c.bannerSub, bx, y + main * 0.9, 34 * inK, 0,
        th.orb[0] * 0.7, th.orb[1] * 0.7, th.orb[2] * 0.7, out * 0.95, th.bg3[0], th.bg3[1], th.bg3[2], out * 0.6, 0.22 + spread);
    }
  }

  private hud(rd: Renderer, w: World, c: DrawCtx, halfW: number, halfH: number): void {
    const th = c.theme;
    const top = c.camY - halfH + c.safeTop;
    const a = 0.62 * c.hudVisible;
    if (a <= 0.01) return;
    const pulse = 1 + c.hudPulse * 0.12;
    const tb = this.tb.clear().int(c.hudScore);
    rd.text(tb, c.camX, top + 58, 58 * pulse, 0, 1.5, 1.5, 1.55, a, th.bg3[0], th.bg3[1], th.bg3[2], a * 0.5, 0.03);
    // active booster timers
    let n = 0;
    const timers = TIMER_VALUES;
    timers[0] = w.prismT / CFG.booster.prism;
    timers[1] = w.rocketT / CFG.booster.rocket;
    timers[2] = w.boltT / CFG.booster.lightning;
    timers[3] = w.magnetT / CFG.booster.magnet;
    timers[4] = w.shield ? 1 : 0;
    timers[5] = w.slowT / (CFG.booster.slowmo * CFG.booster.slowmoScale);
    timers[6] = 0;
    timers[7] = w.tetherT / CFG.booster.longTether;
    timers[8] = w.springT / CFG.booster.spring;
    timers[9] = w.doubleT / CFG.booster.double;
    timers[10] = w.ghostT / CFG.booster.ghost;
    timers[11] = w.levT / CFG.booster.levit;
    timers[12] = 0;
    timers[13] = w.freezeT / CFG.booster.freeze;
    timers[14] = w.twinT / CFG.booster.twin;
    for (let i = 0; i < BOOSTER_COUNT; i++) if (timers[i] > 0) n++;
    if (n === 0) return;
    const gap = 74;
    let x = c.camX - ((n - 1) * gap) / 2;
    const y = top + 128;
    for (let i = 0; i < BOOSTER_COUNT; i++) {
      const f = timers[i];
      if (f <= 0) continue;
      const col = BOOSTER_COLORS[i];
      const blink = f < 0.22 && i !== 4 ? (Math.sin(c.time * 26) > 0 ? 1 : 0.35) : 1;
      rd.push(SH.BUBBLE, x, y, 0, 52, 52, col[0], col[1], col[2], 0.9 * blink, 0.03, 0.02, 0.05, 1, 26, 0, 0, 0);
      rd.push(SH.ARC, x, y, -Math.PI / 2, 40, 40, col[0], col[1], col[2], blink, 1, 1, 1, 0.12, 32, 4, f, 0);
      rd.icon(BOOSTER_ICONS[i], x, y + 1, 28, col[0] * 0.8 + 0.3, col[1] * 0.8 + 0.3, col[2] * 0.8 + 0.3, blink);
      x += gap;
    }
    void halfW;
  }

  private countdown(rd: Renderer, c: DrawCtx): void {
    const th = c.theme;
    const t = c.countdownT;
    const s = easeOutBack(Math.min(1, t / 0.3));
    const a = 1 - Math.max(0, (t - 0.6) / 0.4);
    const tb = this.tb.clear().int(c.countdown);
    rd.text(tb, c.camX, c.camY - 230, 150 * s, 0, 2.2, 2.2, 2.2, a, th.bg3[0] * 1.6, th.bg3[1] * 1.6, th.bg3[2] * 1.6, a, 0);
  }
}

const TIMER_VALUES = new Float32Array(BOOSTER_COUNT);
const easeOutCubic = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
