/**
 * "Zero allocations in the game loop": runs the real simulation + scene drawing (everything
 * except the final WebGL calls) on a crowded late-phase board and measures, with V8's sampling
 * heap profiler, how many bytes the steady-state frame allocates.
 *
 * Built with the same bundler/target as the game (see scripts/check-alloc.mjs), because the
 * dev/test transforms change how V8 optimises module code.
 */
import { Session } from 'node:inspector/promises';
import { CFG } from '../../src/config';
import { resolveLook, DEFAULT_EQUIP } from '../../src/meta/cosmetics';
import { Particles, P_GLOW, P_SHARD } from '../../src/render/particles';
import { Renderer } from '../../src/render/renderer';
import { SceneDrawer, type DrawCtx } from '../../src/render/scene';
import { TextBuf, type GlyphAtlas } from '../../src/render/text';
import { ThemeMix } from '../../src/game/themes';
import { MODE_PLAY, World, type WorldEvents } from '../../src/game/world';

const noop = (): void => undefined;

function setup() {
  const particles = new Particles(9000);
  const glyph = { u0: 0, v0: 0, u1: 0.1, v1: 0.1, adv: 0.6 };
  const atlas = { get: () => glyph, space: { ...glyph, adv: 0.3 } } as unknown as GlyphAtlas;
  const rd = new Renderer({} as HTMLCanvasElement, atlas);
  rd.halfW = 420; rd.halfH = 910; rd.scale = 384 / 840;
  // world events emit particles like the real game does (allocation-free paths)
  const ev: WorldEvents = {
    collect: (x, y) => particles.burst(P_GLOW, x, y, 7, 60, 200, 0.45, 9, 2, 2, 2, 0.9),
    smash: (x, y, r) => {
      for (let k = 0; k < 12; k++) particles.emit(P_SHARD, x, y, Math.cos(k) * 300, Math.sin(k) * 300, 0.6, 4 + r * 0.05, 1.5, 1.5, 1.5, 1, 3, 160, k & 1);
    },
    chain: (_n, _b, x, y) => { const f = w.floater(1, x, y, 40, 1.2, 2, 2, 1); if (f) f.buf.str('DOUBLE SMASH!'); },
    multUp: noop, multDown: noop, phase: noop,
    nearMiss: (x, y, p) => { const f = w.floater(2, x, y, 28, 0.9, 1, 2, 2); if (f) f.buf.str('NEAR MISS +').int(p); },
    thread: noop, booster: noop, boosterEnding: noop, shieldBreak: noop, death: noop, warn: noop, mineBoom: noop,
    heatWarn: noop, heatBurst: noop, convert: noop,
  };
  const w = new World(ev);
  w.god = true;
  w.reset(MODE_PLAY, 99, false);
  const theme = new ThemeMix();
  const ctx: DrawCtx = {
    time: 0, beat: 0, look: resolveLook(DEFAULT_EQUIP), theme, camX: 0, camY: 0, safeTop: 10, safeBottom: 0,
    hudScore: 0, hudPulse: 0, hudVisible: 1, bannerT: 0.3, bannerKind: 0, bannerMain: new TextBuf().str('×5'),
    bannerSub: new TextBuf().str('MULTIPLIER'), beamT: 0.2, countdown: 0, countdownT: 0, reduced: false,
    highContrast: false, shieldFlash: 0,
  };
  const scene = new SceneDrawer();
  const DT = 1 / CFG.sim.hz;
  const frame = (i: number): void => {
    w.held = (i % 300) < 220;
    w.step(DT);
    particles.update(DT);
    theme.update(DT);
    ctx.time += DT;
    ctx.hudScore = w.score;
    rd.begin();
    scene.draw(rd, w, 0.5, particles, ctx, w.sx, w.sy, true);
  };
  // jump to a crowded late phase with active boosters
  for (let p = 2; p <= 7; p++) { w.phase = p; }
  w.mult = 8;
  w.activate(0); // prism
  w.activate(2); // lightning
  w.activate(4); // shield
  return { w, rd, frame };
}

export async function measure(): Promise<{ perFrame: number; instances: number; obstacles: number; top: string[] }> {
  const { w, rd, frame } = setup();
  // warm-up: pools fill, JIT optimises everything
  let i = 0;
  const warm = Number(process.env.WARM ?? 30000);
  for (; i < warm; i++) frame(i);
  const ses = new Session();
  ses.connect();
  await ses.post('HeapProfiler.enable');
  await ses.post('HeapProfiler.startSampling', { samplingInterval: 64 });
  const N = 20000;
  for (let k = 0; k < N; k++, i++) {
    frame(i);
    if (k % 4000 === 0) w.activate(k % 8 === 0 ? 0 : 2);
  }
  const { profile } = await ses.post('HeapProfiler.stopSampling');
  const agg = new Map<string, number>();
  let total = 0;
  const walk = (n: { callFrame: { functionName: string; lineNumber: number }; selfSize: number; children: unknown[] }): void => {
    const k = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`;
    if (n.selfSize) { agg.set(k, (agg.get(k) ?? 0) + n.selfSize); total += n.selfSize; }
    (n.children as typeof n[]).forEach(walk);
  };
  walk(profile.head as never);
  const top = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${(v / N).toFixed(1).padStart(7)} B/frame  ${k}`);
  return { perFrame: total / N, instances: rd.count, obstacles: w.obs.countActive(), top };
}
