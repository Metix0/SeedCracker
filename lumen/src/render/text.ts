/**
 * Glyph atlas: the game font (Fredoka, bundled locally) and the booster icons are
 * rasterised once into a canvas. R channel = crisp glyph, G channel = blurred glow.
 * In-game text is then just instanced quads — no DOM, no per-frame string allocations.
 */

export const ATLAS_W = 2048;
export const ATLAS_H = 1024;
const FONT_PX = 120;
const CELL_W = 136;
const CELL_H = 164;
export const GLYPH_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZĄĆĘŁŃÓŚŹŻ0123456789+-×!?.:,/%\'()';

export const ICON = {
  prism: 0xe000,
  rocket: 0xe001,
  bolt: 0xe002,
  magnet: 0xe003,
  shield: 0xe004,
  slow: 0xe005,
  nova: 0xe006,
  tether: 0xe007,
  crumb: 0xe008,
} as const;
const ICON_COUNT = 9;

export interface Glyph {
  u0: number; v0: number; u1: number; v1: number;
  /** advance in em */
  adv: number;
}

/** cell size in em (quad covers the whole cell including glow padding) */
export const CELL_EM_W = CELL_W / FONT_PX;
export const CELL_EM_H = CELL_H / FONT_PX;

export class GlyphAtlas {
  readonly canvas: HTMLCanvasElement;
  private map = new Map<number, Glyph>();
  readonly space: Glyph;

  constructor(fontFamily: string) {
    const c = document.createElement('canvas');
    c.width = ATLAS_W;
    c.height = ATLAS_H;
    this.canvas = c;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${FONT_PX}px ${fontFamily}`;
    const cols = Math.floor(ATLAS_W / CELL_W);
    let idx = 0;
    const cell = (code: number, draw: (cx: number, cy: number, glow: boolean) => void, adv: number): void => {
      const col = idx % cols, row = Math.floor(idx / cols);
      idx++;
      const x = col * CELL_W, y = row * CELL_H;
      const cx = x + CELL_W / 2, cy = y + CELL_H / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, CELL_W, CELL_H);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      // glow (green): drawn far away, only its shadow lands in the cell
      ctx.shadowColor = 'rgb(0,255,0)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetX = -10000;
      ctx.fillStyle = 'rgb(0,255,0)';
      ctx.strokeStyle = 'rgb(0,255,0)';
      ctx.translate(10000, 0);
      draw(cx, cy, true);
      ctx.translate(-10000, 0);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      // crisp (red)
      ctx.fillStyle = 'rgb(255,0,0)';
      ctx.strokeStyle = 'rgb(255,0,0)';
      draw(cx, cy, false);
      ctx.restore();
      const inset = 0.5;
      this.map.set(code, {
        u0: (x + inset) / ATLAS_W, v0: (y + inset) / ATLAS_H,
        u1: (x + CELL_W - inset) / ATLAS_W, v1: (y + CELL_H - inset) / ATLAS_H,
        adv,
      });
    };

    for (const ch of GLYPH_CHARS) {
      const code = ch.charCodeAt(0);
      const w = ctx.measureText(ch).width / FONT_PX;
      cell(code, (cx, cy) => ctx.fillText(ch, cx, cy + 6), w);
    }
    for (let i = 0; i < ICON_COUNT; i++) {
      cell(0xe000 + i, (cx, cy) => drawIcon(ctx, i, cx, cy, 52), 1.0);
    }
    this.space = { u0: 0, v0: 0, u1: 0, v1: 0, adv: 0.3 };
  }

  get(code: number): Glyph | undefined {
    return this.map.get(code);
  }
}

function drawIcon(ctx: CanvasRenderingContext2D, i: number, cx: number, cy: number, r: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = r * 0.22;
  ctx.beginPath();
  switch (i) {
    case 0: { // prism: 4-point sparkle star
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
        const rr = k % 2 === 0 ? r : r * 0.3;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 1: { // rocket
      ctx.moveTo(cx, cy - r);
      ctx.quadraticCurveTo(cx + r * 0.55, cy - r * 0.3, cx + r * 0.32, cy + r * 0.5);
      ctx.lineTo(cx - r * 0.32, cy + r * 0.5);
      ctx.quadraticCurveTo(cx - r * 0.55, cy - r * 0.3, cx, cy - r);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.32, cy + r * 0.1); ctx.lineTo(cx - r * 0.65, cy + r * 0.7); ctx.lineTo(cx - r * 0.25, cy + r * 0.5);
      ctx.moveTo(cx + r * 0.32, cy + r * 0.1); ctx.lineTo(cx + r * 0.65, cy + r * 0.7); ctx.lineTo(cx + r * 0.25, cy + r * 0.5);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.18, cy + r * 0.62); ctx.lineTo(cx, cy + r * 1.05); ctx.lineTo(cx + r * 0.18, cy + r * 0.62);
      ctx.fill();
      break;
    }
    case 2: { // bolt
      ctx.moveTo(cx + r * 0.25, cy - r);
      ctx.lineTo(cx - r * 0.55, cy + r * 0.12);
      ctx.lineTo(cx - r * 0.02, cy + r * 0.12);
      ctx.lineTo(cx - r * 0.25, cy + r);
      ctx.lineTo(cx + r * 0.55, cy - r * 0.15);
      ctx.lineTo(cx + r * 0.02, cy - r * 0.15);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 3: { // magnet (U)
      ctx.lineWidth = r * 0.42;
      ctx.lineCap = 'butt';
      ctx.arc(cx, cy, r * 0.55, Math.PI * 0.0, Math.PI * 1.0, false);
      ctx.moveTo(cx - r * 0.55, cy); ctx.lineTo(cx - r * 0.55, cy - r * 0.75);
      ctx.moveTo(cx + r * 0.55, cy); ctx.lineTo(cx + r * 0.55, cy - r * 0.75);
      ctx.stroke();
      break;
    }
    case 4: { // shield (+)
      ctx.lineWidth = r * 0.42;
      ctx.moveTo(cx, cy - r * 0.8); ctx.lineTo(cx, cy + r * 0.8);
      ctx.moveTo(cx - r * 0.8, cy); ctx.lineTo(cx + r * 0.8, cy);
      ctx.stroke();
      break;
    }
    case 5: { // slow: hourglass
      ctx.moveTo(cx - r * 0.6, cy - r * 0.85); ctx.lineTo(cx + r * 0.6, cy - r * 0.85);
      ctx.lineTo(cx, cy); ctx.lineTo(cx + r * 0.6, cy + r * 0.85);
      ctx.lineTo(cx - r * 0.6, cy + r * 0.85); ctx.lineTo(cx, cy); ctx.closePath();
      ctx.fill();
      break;
    }
    case 6: { // supernova burst
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const rr = k % 2 === 0 ? r : r * 0.45;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 7: { // long tether: dot + orbit + double arrow
      ctx.lineWidth = r * 0.16;
      ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.lineWidth = r * 0.18;
      ctx.moveTo(cx + r * 0.3, cy); ctx.lineTo(cx + r * 0.62, cy);
      ctx.moveTo(cx + r * 0.48, cy - r * 0.16); ctx.lineTo(cx + r * 0.66, cy); ctx.lineTo(cx + r * 0.48, cy + r * 0.16);
      ctx.stroke();
      break;
    }
    case 8: { // crumb: small diamond
      ctx.moveTo(cx, cy - r * 0.8); ctx.lineTo(cx + r * 0.55, cy); ctx.lineTo(cx, cy + r * 0.8); ctx.lineTo(cx - r * 0.55, cy);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

/** Fixed-capacity character buffer that can be filled without allocating. */
export class TextBuf {
  readonly codes = new Uint16Array(48);
  len = 0;
  clear(): this {
    this.len = 0;
    return this;
  }
  str(s: string): this {
    for (let i = 0; i < s.length && this.len < this.codes.length; i++) this.codes[this.len++] = s.charCodeAt(i);
    return this;
  }
  ch(code: number): this {
    if (this.len < this.codes.length) this.codes[this.len++] = code;
    return this;
  }
  int(n: number): this {
    n = Math.floor(Math.abs(n));
    let div = 1, digits = 1;
    while (div * 10 <= n) { div *= 10; digits++; }
    while (digits > 0) {
      this.ch(48 + (Math.floor(n / div) % 10));
      digits--;
      if (digits > 0 && digits % 3 === 0) this.ch(32); // grouping: "12 450"
      div /= 10;
    }
    return this;
  }
  copy(o: TextBuf): this {
    this.len = o.len;
    this.codes.set(o.codes);
    return this;
  }
}
