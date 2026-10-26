import type { RunStats } from '../game/entities';
import type { LifeStats, MissionState, SaveData } from './save';

type Metric = keyof Pick<RunStats, 'peakMult' | 'maxChain' | 'shards' | 'holdOrbsMax' | 'orbs' | 'time' | 'nearMisses' | 'threads' | 'prismSmashes' | 'score' | 'phase' | 'voidSmashes' | 'smashes'>;

interface MissionDef {
  id: string;
  metric: Metric;
  /** 'run' = reach in a single run, 'total' = accumulate over runs */
  mode: 'run' | 'total';
  tiers: number[];
  reward: number;
  pl: string; // {n} = target
  en: string;
}

export const MISSIONS: MissionDef[] = [
  { id: 'mult', metric: 'peakMult', mode: 'run', tiers: [3, 5, 7, 10], reward: 60, pl: 'Osiągnij ×{n}', en: 'Reach ×{n}' },
  { id: 'mega', metric: 'maxChain', mode: 'run', tiers: [3, 4, 5, 6], reward: 80, pl: 'Łańcuch {n} rozbić (MEGA SMASH = 4)', en: 'Chain {n} smashes (MEGA SMASH = 4)' },
  { id: 'shards', metric: 'shards', mode: 'run', tiers: [10, 20, 30, 45], reward: 70, pl: 'Rozbij {n} odłamków w jednej rundzie', en: 'Smash {n} shards in one run' },
  { id: 'hold', metric: 'holdOrbsMax', mode: 'run', tiers: [20, 35, 50, 80], reward: 70, pl: 'Zbierz {n} kulek bez puszczania palca', en: 'Collect {n} orbs without letting go' },
  { id: 'orbsT', metric: 'orbs', mode: 'total', tiers: [150, 400, 1000, 2500], reward: 50, pl: 'Zbierz łącznie {n} kulek', en: 'Collect {n} orbs in total' },
  { id: 'survive', metric: 'time', mode: 'run', tiers: [45, 90, 150, 240], reward: 60, pl: 'Przetrwaj {n} s', en: 'Survive {n} s' },
  { id: 'near', metric: 'nearMisses', mode: 'run', tiers: [3, 6, 10, 15], reward: 70, pl: '{n} near missów w jednej rundzie', en: '{n} near misses in one run' },
  { id: 'thread', metric: 'threads', mode: 'run', tiers: [2, 4, 6, 9], reward: 70, pl: 'Przeleć przez środek {n} pierścieni', en: 'Thread {n} rings' },
  { id: 'prism', metric: 'prismSmashes', mode: 'run', tiers: [6, 10, 16, 24], reward: 80, pl: 'Rozbij {n} obiektów Pryzmatem', en: 'Smash {n} objects with Prism' },
  { id: 'score', metric: 'score', mode: 'run', tiers: [2500, 6000, 15000, 40000], reward: 60, pl: 'Zdobądź {n} punktów', en: 'Score {n} points' },
  { id: 'phase', metric: 'phase', mode: 'run', tiers: [3, 4, 5, 7], reward: 80, pl: 'Dotrzyj do fazy {n}', en: 'Reach phase {n}' },
  { id: 'smashT', metric: 'smashes', mode: 'total', tiers: [60, 200, 500, 1200], reward: 50, pl: 'Rozbij łącznie {n} przeszkód', en: 'Smash {n} obstacles in total' },
  { id: 'void', metric: 'voidSmashes', mode: 'run', tiers: [1, 3, 5, 8], reward: 90, pl: 'Rozbij {n} kul pustki (Pryzmat)', en: 'Smash {n} void orbs (Prism)' },
];

export function missionDef(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export function missionText(m: MissionState, lang: 'pl' | 'en'): string {
  const d = missionDef(m.id);
  if (!d) return m.id;
  return (lang === 'pl' ? d.pl : d.en).replace('{n}', String(m.target));
}

/** Fill up to 3 active missions, tiers scale with total completions. */
export function refillMissions(save: SaveData): void {
  save.missions = save.missions.filter((m) => !m.done && missionDef(m.id));
  const tier = Math.min(3, Math.floor(save.missionsDone / 4));
  let guard = 0;
  while (save.missions.length < 3 && guard++ < 50) {
    const d = MISSIONS[Math.floor(Math.random() * MISSIONS.length)];
    if (save.missions.some((m) => m.id === d.id)) continue;
    // skip missions that need content the player can't reach yet
    if (d.id === 'void' && save.stats.bestPhase < 4) continue;
    if (d.id === 'thread' && save.stats.bestPhase < 3) continue;
    const t = d.tiers[Math.min(d.tiers.length - 1, tier + (Math.random() < 0.3 ? 1 : 0))];
    save.missions.push({ id: d.id, target: t, progress: 0, reward: d.reward + tier * 25, done: false });
  }
}

/** Live check during a run. Returns missions newly completed (allocation only on completion). */
export function checkMissions(save: SaveData, run: RunStats): MissionState[] | null {
  let out: MissionState[] | null = null;
  for (let i = 0; i < save.missions.length; i++) {
    const m = save.missions[i];
    if (m.done) continue;
    const d = missionDef(m.id);
    if (!d) continue;
    const v = run[d.metric] as number;
    const value = d.mode === 'run' ? v : m.progress + v;
    if (value >= m.target) {
      m.done = true;
      m.progress = m.target;
      save.crumbs += m.reward;
      save.missionsDone++;
      (out ??= []).push(m);
    }
  }
  return out;
}

/** End of run: persist progress of unfinished missions. */
export function commitMissions(save: SaveData, run: RunStats): void {
  for (const m of save.missions) {
    if (m.done) continue;
    const d = missionDef(m.id);
    if (!d) continue;
    const v = run[d.metric] as number;
    m.progress = d.mode === 'run' ? Math.max(m.progress, v) : m.progress + v;
  }
}

// ---------------------------------------------------------------- achievements

interface AchDef {
  id: string;
  pl: [string, string];
  en: [string, string];
  test(s: LifeStats, save: SaveData, run: RunStats | null): boolean;
}

export const ACHIEVEMENTS: AchDef[] = [
  { id: 'first', pl: ['Pierwszy błysk', 'Rozbij pierwszą przeszkodę'], en: ['First flash', 'Smash your first obstacle'], test: (s) => s.smashes >= 1 },
  { id: 'x5', pl: ['Rozpędzony', 'Osiągnij ×5'], en: ['Warming up', 'Reach ×5'], test: (s) => s.bestMult >= 5 },
  { id: 'x10', pl: ['Supernowa', 'Osiągnij ×10'], en: ['Supernova', 'Reach ×10'], test: (s) => s.bestMult >= 10 },
  { id: 'mega', pl: ['MEGA', 'Zrób MEGA SMASH'], en: ['MEGA', 'Land a MEGA SMASH'], test: (s) => s.bestChain >= 4 },
  { id: 'hyper', pl: ['Reakcja łańcuchowa', 'Łańcuch 6 rozbić'], en: ['Chain reaction', 'Chain 6 smashes'], test: (s) => s.bestChain >= 6 },
  { id: 'phase3', pl: ['Głębia', 'Dotrzyj do fazy 3'], en: ['The deep', 'Reach phase 3'], test: (s) => s.bestPhase >= 3 },
  { id: 'phase5', pl: ['Kosmos', 'Dotrzyj do fazy 5'], en: ['Cosmos', 'Reach phase 5'], test: (s) => s.bestPhase >= 5 },
  { id: 'phase7', pl: ['Żar', 'Dotrzyj do fazy 7'], en: ['Inferno', 'Reach phase 7'], test: (s) => s.bestPhase >= 7 },
  { id: 's10k', pl: ['10 000', 'Zdobądź 10 000 pkt'], en: ['10,000', 'Score 10,000'], test: (_s, sv) => sv.best >= 10000 },
  { id: 's50k', pl: ['50 000', 'Zdobądź 50 000 pkt'], en: ['50,000', 'Score 50,000'], test: (_s, sv) => sv.best >= 50000 },
  { id: 's150k', pl: ['Legenda światła', 'Zdobądź 150 000 pkt'], en: ['Legend of light', 'Score 150,000'], test: (_s, sv) => sv.best >= 150000 },
  { id: 'orbs1k', pl: ['Kolekcjoner', 'Zbierz 1000 kulek'], en: ['Collector', 'Collect 1,000 orbs'], test: (s) => s.orbs >= 1000 },
  { id: 'near50', pl: ['O włos', '50 near missów'], en: ['By a hair', '50 near misses'], test: (s) => s.nearMisses >= 50 },
  { id: 'void', pl: ['Pogromca pustki', 'Rozbij kulę pustki'], en: ['Void breaker', 'Smash a void orb'], test: (s) => s.voidSmashes >= 1 },
  { id: 'allboost', pl: ['Arsenał', 'Użyj każdego boostera'], en: ['Arsenal', 'Use every booster'], test: (s) => s.boosters.every((b) => b > 0) },
  { id: 'hour', pl: ['Ćma', 'Graj łącznie godzinę'], en: ['Moth', 'Play for an hour in total'], test: (s) => s.time >= 3600 },
  { id: 'daily7', pl: ['Rytuał', '7 wyzwań dnia'], en: ['Ritual', '7 daily challenges'], test: (s) => s.dailyPlays >= 7 },
  { id: 'shop', pl: ['Styl', 'Kup coś w sklepie'], en: ['Style', 'Buy something in the shop'], test: (_s, sv) => sv.owned.length > 5 },
  { id: 'thread10', pl: ['Igła', 'Przeleć przez 10 pierścieni'], en: ['Needle', 'Thread 10 rings'], test: (s) => s.threads >= 10 },
];

export function checkAchievements(save: SaveData, run: RunStats | null): AchDef[] {
  const out: AchDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (save.achievements.includes(a.id)) continue;
    if (a.test(save.stats, save, run)) {
      save.achievements.push(a.id);
      out.push(a);
    }
  }
  return out;
}

/** Fold a finished run into lifetime stats. */
export function applyRun(save: SaveData, run: RunStats): void {
  const s = save.stats;
  s.games++;
  s.time += run.time;
  s.orbs += run.orbs;
  s.smashes += run.smashes;
  s.shards += run.shards;
  s.bestMult = Math.max(s.bestMult, run.peakMult);
  s.bestChain = Math.max(s.bestChain, run.maxChain);
  s.nearMisses += run.nearMisses;
  s.threads += run.threads;
  s.voidSmashes += run.voidSmashes;
  s.prismSmashes += run.prismSmashes;
  s.bestPhase = Math.max(s.bestPhase, run.phase);
  for (let i = 0; i < 8; i++) s.boosters[i] += run.boosters[i];
  if (run.daily) s.dailyPlays++;
  s.crumbsEarned += run.crumbs;
  save.crumbs += run.crumbs;
  if (run.score > save.best) save.best = run.score;
}
