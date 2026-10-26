import { BOOSTER_COUNT } from '../game/entities';
import { DEFAULT_EQUIP, type Category } from './cosmetics';

export interface Settings {
  music: number;
  sfx: number;
  vibration: boolean;
  battery: boolean;
  reduced: boolean;
  highContrast: boolean;
  lang: 'pl' | 'en';
  showFps: boolean;
}

export interface LifeStats {
  games: number;
  time: number;
  orbs: number;
  smashes: number;
  shards: number;
  bestMult: number;
  bestChain: number;
  nearMisses: number;
  threads: number;
  voidSmashes: number;
  prismSmashes: number;
  boosters: number[];
  dailyPlays: number;
  bestPhase: number;
  crumbsEarned: number;
}

export interface MissionState {
  id: string;
  target: number;
  progress: number;
  reward: number;
  done: boolean;
}

export interface SaveData {
  v: 1;
  crumbs: number;
  best: number;
  owned: string[];
  equip: Record<Category, string>;
  stats: LifeStats;
  missions: MissionState[];
  missionsDone: number;
  achievements: string[];
  dailyBest: Record<string, number>;
  dailyGhost: { key: string; data: string } | null;
  settings: Settings;
  seen: { iosHint: boolean; firstRun: boolean };
}

const KEY = 'lumen.save.v1';

export function defaultSettings(): Settings {
  let reduced = false;
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  const lang = (navigator.language || 'pl').toLowerCase().startsWith('pl') ? 'pl' : 'en';
  return { music: 0.7, sfx: 0.9, vibration: true, battery: false, reduced, highContrast: false, lang, showFps: false };
}

export function defaultSave(): SaveData {
  return {
    v: 1,
    crumbs: 0,
    best: 0,
    owned: Object.values(DEFAULT_EQUIP),
    equip: { ...DEFAULT_EQUIP },
    stats: {
      games: 0, time: 0, orbs: 0, smashes: 0, shards: 0, bestMult: 1, bestChain: 0, nearMisses: 0,
      threads: 0, voidSmashes: 0, prismSmashes: 0, boosters: new Array<number>(BOOSTER_COUNT).fill(0), dailyPlays: 0, bestPhase: 1, crumbsEarned: 0,
    },
    missions: [],
    missionsDone: 0,
    achievements: [],
    dailyBest: {},
    dailyGhost: null,
    settings: defaultSettings(),
    seen: { iosHint: false, firstRun: true },
  };
}

/** Deep-merge a (possibly older / partial) save onto defaults so new fields always exist. */
function merge<T>(base: T, over: unknown): T {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return (over as T) ?? base;
  const out = { ...(base as object) } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge(b, v);
    else if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export function sanitize(raw: unknown): SaveData {
  const d = merge(defaultSave(), raw);
  if (!Array.isArray(d.owned)) d.owned = Object.values(DEFAULT_EQUIP);
  for (const id of Object.values(DEFAULT_EQUIP)) if (!d.owned.includes(id)) d.owned.push(id);
  if (!Array.isArray(d.missions)) d.missions = [];
  if (!Array.isArray(d.achievements)) d.achievements = [];
  // older saves know fewer boosters: keep their counts, pad the new ones with zeros
  if (!Array.isArray(d.stats.boosters)) d.stats.boosters = [];
  d.stats.boosters = Array.from({ length: BOOSTER_COUNT }, (_, i) => Math.max(0, Number(d.stats.boosters[i]) || 0));
  d.crumbs = Math.max(0, Math.floor(Number(d.crumbs) || 0));
  d.best = Math.max(0, Math.floor(Number(d.best) || 0));
  if (d.settings.lang !== 'pl' && d.settings.lang !== 'en') d.settings.lang = 'pl';
  return d;
}

/** localStorage wrapper — every access guarded; the game works (in memory) without storage. */
export class Store {
  data: SaveData;
  private writable = true;

  constructor() {
    let raw: unknown = null;
    try {
      const s = localStorage.getItem(KEY);
      if (s) raw = JSON.parse(s);
    } catch {
      this.writable = false;
    }
    this.data = sanitize(raw);
  }

  save(): void {
    if (!this.writable) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* quota / private mode: keep playing in memory */
    }
  }

  // ---- export / import (move progress between phone and iPad)

  exportCode(): string {
    const json = JSON.stringify(this.data);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return 'LUMEN1:' + b64 + ':' + checksum(b64);
  }

  importCode(code: string): boolean {
    try {
      const s = code.trim();
      let json: string;
      if (s.startsWith('{')) {
        json = s;
      } else {
        const parts = s.split(':');
        if (parts.length !== 3 || parts[0] !== 'LUMEN1') return false;
        if (checksum(parts[1]) !== parts[2]) return false;
        json = decodeURIComponent(escape(atob(parts[1])));
      }
      const parsed = JSON.parse(json);
      if (!parsed || parsed.v !== 1) return false;
      this.data = sanitize(parsed);
      this.save();
      return true;
    } catch {
      return false;
    }
  }
}

function checksum(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// ---- ghost codec: Float32 world coords → Int16 → base64

export function encodeGhost(src: Float32Array, len: number): string {
  const n = Math.min(len, src.length);
  const q = new Int16Array(n);
  for (let i = 0; i < n; i++) q[i] = Math.max(-32767, Math.min(32767, Math.round(src[i] * 8)));
  const bytes = new Uint8Array(q.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
}

export function decodeGhost(s: string): Float32Array | null {
  try {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const q = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    const out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) out[i] = q[i] / 8;
    return out;
  } catch {
    return null;
  }
}
