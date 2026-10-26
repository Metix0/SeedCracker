/**
 * Phase color themes. Values are display-space RGB (P3 canvas where available); values > 1
 * are HDR and feed the bloom.
 */
export interface Theme {
  name: string;
  bg0: number[]; // deep
  bg1: number[]; // nebula curtain
  bg2: number[]; // nebula veil
  bg3: number[]; // accent glow
  light: number[]; // light side
  dark: number[]; // dark side fill
  darkRim: number[]; // dark outline glow
  orb: number[];
  spark: number[];
  star: number[]; // parallax star tint
}

const hex = (h: string, k = 1): number[] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255 * k, ((n >> 8) & 255) / 255 * k, (n & 255) / 255 * k];
};

export const THEMES: Theme[] = [
  {
    name: 'ruby',
    bg0: hex('#0d0108'), bg1: hex('#6e0a2c'), bg2: hex('#3a0b4a'), bg3: hex('#ff3d7a'),
    light: hex('#fff1f5', 1.45), dark: hex('#14040c'), darkRim: hex('#ff2a5f', 1.1),
    orb: hex('#ffd2e2', 2.4), spark: hex('#ffd9e6', 2.2), star: hex('#ffc2d6'),
  },
  {
    name: 'sunset',
    bg0: hex('#120500'), bg1: hex('#a33a05'), bg2: hex('#5c1030'), bg3: hex('#ffb12e'),
    light: hex('#fff6e2', 1.45), dark: hex('#160801'), darkRim: hex('#ff5a14', 1.1),
    orb: hex('#ffe3a3', 2.4), spark: hex('#ffe9c2', 2.2), star: hex('#ffd9a6'),
  },
  {
    name: 'ocean',
    bg0: hex('#00060f'), bg1: hex('#00597a'), bg2: hex('#0a2a7a'), bg3: hex('#22e6ff'),
    light: hex('#ecfdff', 1.45), dark: hex('#010a14'), darkRim: hex('#2a7bff', 1.15),
    orb: hex('#b8f6ff', 2.4), spark: hex('#d0fbff', 2.2), star: hex('#a6e8ff'),
  },
  {
    name: 'aurora',
    bg0: hex('#010a0c'), bg1: hex('#0b7a5a'), bg2: hex('#155a8a'), bg3: hex('#5affc8'),
    light: hex('#f0fff9', 1.45), dark: hex('#02100e'), darkRim: hex('#00d0ff', 1.1),
    orb: hex('#c4ffe9', 2.4), spark: hex('#dafff4', 2.2), star: hex('#c2fff0'),
  },
  {
    name: 'cosmos',
    bg0: hex('#05010f'), bg1: hex('#4a12a8'), bg2: hex('#8a0f78'), bg3: hex('#c46bff'),
    light: hex('#f8f0ff', 1.45), dark: hex('#0a0418'), darkRim: hex('#ff3df0', 1.1),
    orb: hex('#e8cfff', 2.4), spark: hex('#efe0ff', 2.2), star: hex('#dcc6ff'),
  },
  {
    name: 'emerald',
    bg0: hex('#010a03'), bg1: hex('#1f6e0f'), bg2: hex('#0b4a3a'), bg3: hex('#c8ff3d'),
    light: hex('#f6ffe8', 1.45), dark: hex('#041004'), darkRim: hex('#ffd000', 1.05),
    orb: hex('#eaffb8', 2.4), spark: hex('#f2ffd6', 2.2), star: hex('#e4ffbf'),
  },
  {
    name: 'inferno',
    bg0: hex('#0f0100'), bg1: hex('#8a1200'), bg2: hex('#4a0a2a'), bg3: hex('#ff6a00'),
    light: hex('#fff8ee', 1.5), dark: hex('#150200'), darkRim: hex('#ff2000', 1.2),
    orb: hex('#ffe0b8', 2.4), spark: hex('#fff0d8', 2.2), star: hex('#ffcfaa'),
  },
];

function mix(out: Float32Array, x: number[], y: number[], t: number): void {
  out[0] = x[0] + (y[0] - x[0]) * t;
  out[1] = x[1] + (y[1] - x[1]) * t;
  out[2] = x[2] + (y[2] - x[2]) * t;
}

/** Live, smoothly blended theme (preallocated). */
export class ThemeMix {
  bg0 = new Float32Array(3); bg1 = new Float32Array(3); bg2 = new Float32Array(3); bg3 = new Float32Array(3);
  light = new Float32Array(3); dark = new Float32Array(3); darkRim = new Float32Array(3);
  orb = new Float32Array(3); spark = new Float32Array(3); star = new Float32Array(3);
  private from = 0;
  private to = 0;
  private t = 1;
  private dur = 2.5;

  constructor() {
    this.apply(THEMES[0], THEMES[0], 1);
  }

  index(): number { return this.to; }

  snap(i: number): void {
    this.from = this.to = i % THEMES.length;
    this.t = 1;
    this.apply(THEMES[this.to], THEMES[this.to], 1);
  }

  go(i: number, dur: number): void {
    i = i % THEMES.length;
    if (i === this.to) return;
    this.from = this.to;
    this.to = i;
    this.t = 0;
    this.dur = dur;
  }

  update(dt: number): void {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.dur);
    const e = this.t * this.t * (3 - 2 * this.t);
    this.apply(THEMES[this.from], THEMES[this.to], e);
  }

  private apply(a: Theme, b: Theme, t: number): void {
    mix(this.bg0, a.bg0, b.bg0, t); mix(this.bg1, a.bg1, b.bg1, t); mix(this.bg2, a.bg2, b.bg2, t); mix(this.bg3, a.bg3, b.bg3, t);
    mix(this.light, a.light, b.light, t); mix(this.dark, a.dark, b.dark, t); mix(this.darkRim, a.darkRim, b.darkRim, t);
    mix(this.orb, a.orb, b.orb, t); mix(this.spark, a.spark, b.spark, t); mix(this.star, a.star, b.star, t);
  }
}
