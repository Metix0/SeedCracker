/** Shop catalogue. Everything is unlocked with in-game "okruchy światła" — no real money, no ads. */

export type Category = 'spark' | 'trail' | 'tether' | 'core' | 'armor';

export interface Item {
  id: string;
  cat: Category;
  price: number;
  /** i18n key suffix */
  name: { pl: string; en: string };
  /** display color for the shop swatch (css) */
  swatch: string;
  /** render parameters */
  color?: [number, number, number];
  rainbow?: boolean;
  shape?: number;
  style?: number;
}

export const ITEMS: Item[] = [
  // sparks
  { id: 'spark.lumen', cat: 'spark', price: 0, name: { pl: 'Lumen', en: 'Lumen' }, swatch: '#fff4fa', shape: 0 },
  { id: 'spark.ruby', cat: 'spark', price: 150, name: { pl: 'Rubin', en: 'Ruby' }, swatch: '#ff3d7a', color: [2.6, 0.5, 1.0], shape: 0 },
  { id: 'spark.sun', cat: 'spark', price: 300, name: { pl: 'Słońce', en: 'Sun' }, swatch: '#ffc542', color: [2.7, 1.7, 0.45], shape: 1 },
  { id: 'spark.ice', cat: 'spark', price: 450, name: { pl: 'Lód', en: 'Ice' }, swatch: '#8fe8ff', color: [0.8, 1.9, 2.8], shape: 2 },
  { id: 'spark.emerald', cat: 'spark', price: 600, name: { pl: 'Szmaragd', en: 'Emerald' }, swatch: '#3dff9a', color: [0.5, 2.5, 1.2], shape: 1 },
  { id: 'spark.rainbow', cat: 'spark', price: 1200, name: { pl: 'Tęcza', en: 'Rainbow' }, swatch: 'linear-gradient(90deg,#ff4d6d,#ffd54d,#4dffa6,#4dc3ff,#c44dff)', rainbow: true, shape: 0 },
  // trails
  { id: 'trail.ribbon', cat: 'trail', price: 0, name: { pl: 'Wstęga', en: 'Ribbon' }, swatch: '#ffe3ef', style: 0 },
  { id: 'trail.comet', cat: 'trail', price: 200, name: { pl: 'Kometa', en: 'Comet' }, swatch: '#ffb36b', style: 1 },
  { id: 'trail.sparkle', cat: 'trail', price: 350, name: { pl: 'Gwiezdny pył', en: 'Stardust' }, swatch: '#fff6a8', style: 2 },
  { id: 'trail.dash', cat: 'trail', price: 500, name: { pl: 'Morse', en: 'Morse' }, swatch: '#9ef0ff', style: 3 },
  { id: 'trail.rainbow', cat: 'trail', price: 900, name: { pl: 'Tęczowa', en: 'Rainbow' }, swatch: 'linear-gradient(90deg,#ff4d6d,#ffd54d,#4dffa6,#4dc3ff,#c44dff)', style: 4, rainbow: true },
  // tethers
  { id: 'tether.beam', cat: 'tether', price: 0, name: { pl: 'Promień', en: 'Beam' }, swatch: '#ffd9e6', style: 0 },
  { id: 'tether.beads', cat: 'tether', price: 150, name: { pl: 'Perły', en: 'Pearls' }, swatch: '#f6e7ff', style: 1 },
  { id: 'tether.helix', cat: 'tether', price: 400, name: { pl: 'Helisa', en: 'Helix' }, swatch: '#7dffd4', style: 2 },
  { id: 'tether.chain', cat: 'tether', price: 550, name: { pl: 'Łańcuch', en: 'Chain' }, swatch: '#ffd68a', style: 3 },
  { id: 'tether.bolt', cat: 'tether', price: 800, name: { pl: 'Wyładowanie', en: 'Arc' }, swatch: '#9fc8ff', style: 4 },
  // cores
  { id: 'core.classic', cat: 'core', price: 0, name: { pl: 'Klasyczny', en: 'Classic' }, swatch: '#2a0d1a', style: 0 },
  { id: 'core.crown', cat: 'core', price: 250, name: { pl: 'Korona', en: 'Crown' }, swatch: '#3a1a05', style: 1 },
  { id: 'core.eye', cat: 'core', price: 450, name: { pl: 'Oko', en: 'Eye' }, swatch: '#05202a', style: 2 },
  { id: 'core.gear', cat: 'core', price: 650, name: { pl: 'Tryb', en: 'Gear' }, swatch: '#1c1c24', style: 3 },
  { id: 'core.hole', cat: 'core', price: 1000, name: { pl: 'Czarna dziura', en: 'Black hole' }, swatch: '#000000', style: 4 },
  // prism armour
  { id: 'armor.crystal', cat: 'armor', price: 0, name: { pl: 'Kryształ', en: 'Crystal' }, swatch: '#dff6ff', color: [1.6, 1.9, 2.4], style: 0 },
  { id: 'armor.fire', cat: 'armor', price: 300, name: { pl: 'Ogień', en: 'Fire' }, swatch: '#ff7a1a', color: [2.6, 1.0, 0.25], style: 1 },
  { id: 'armor.frost', cat: 'armor', price: 500, name: { pl: 'Szron', en: 'Frost' }, swatch: '#a8f0ff', color: [1.1, 2.2, 2.8], style: 2 },
  { id: 'armor.rainbow', cat: 'armor', price: 1000, name: { pl: 'Tęcza', en: 'Rainbow' }, swatch: 'linear-gradient(90deg,#ff4d6d,#ffd54d,#4dffa6,#4dc3ff,#c44dff)', rainbow: true, style: 3 },
];

export const CATEGORIES: Category[] = ['spark', 'trail', 'tether', 'core', 'armor'];

export function item(id: string): Item | undefined {
  return ITEMS.find((i) => i.id === id);
}

export const DEFAULT_EQUIP: Record<Category, string> = {
  spark: 'spark.lumen',
  trail: 'trail.ribbon',
  tether: 'tether.beam',
  core: 'core.classic',
  armor: 'armor.crystal',
};

/** Resolved render look (numbers only, read every frame). */
export interface Look {
  sparkColor: [number, number, number] | null;
  sparkRainbow: boolean;
  sparkShape: number;
  trail: number;
  trailRainbow: boolean;
  tether: number;
  core: number;
  armorColor: [number, number, number];
  armorRainbow: boolean;
}

export function resolveLook(equip: Record<Category, string>): Look {
  const s = item(equip.spark) ?? item(DEFAULT_EQUIP.spark)!;
  const t = item(equip.trail) ?? item(DEFAULT_EQUIP.trail)!;
  const te = item(equip.tether) ?? item(DEFAULT_EQUIP.tether)!;
  const c = item(equip.core) ?? item(DEFAULT_EQUIP.core)!;
  const a = item(equip.armor) ?? item(DEFAULT_EQUIP.armor)!;
  return {
    sparkColor: s.color ?? null,
    sparkRainbow: !!s.rainbow,
    sparkShape: s.shape ?? 0,
    trail: t.style ?? 0,
    trailRainbow: !!t.rainbow,
    tether: te.style ?? 0,
    core: c.style ?? 0,
    armorColor: a.color ?? [1.6, 1.9, 2.4],
    armorRainbow: !!a.rainbow,
  };
}
