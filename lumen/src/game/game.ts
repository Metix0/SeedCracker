import { CFG } from '../config';
import { Loop } from '../core/loop';
import { TAU, clamp, damp } from '../core/math';
import { dayKey, daySeed } from '../core/rng';
import { AudioEngine } from '../audio/audio';
import { Input } from '../input/input';
import { resolveLook, type Look } from '../meta/cosmetics';
import { BOOSTER_KEYS, THEME_KEYS, setLang, t } from '../meta/i18n';
import { applyRun, checkAchievements, checkMissions, commitMissions, refillMissions } from '../meta/progress';
import { Store, decodeGhost, encodeGhost } from '../meta/save';
import { shareRun } from '../meta/share';
import {
  BackGuard, CAN_VIBRATE, Haptics, IS_IOS, Installer, SafeArea, WakeLock, isStandalone, lockPortrait,
} from '../platform/platform';
import { P_GLOW, P_RINGLET, P_SHARD, P_STREAK, Particles } from '../render/particles';
import { Renderer, type FrameParams } from '../render/renderer';
import { BOOSTER_COLORS, SceneDrawer, type DrawCtx } from '../render/scene';
import { GlyphAtlas, TextBuf } from '../render/text';
import { UI } from '../ui/ui';
import { B_NOVA, B_PRISM, B_SHIELD, B_SLOW, K_COMET, K_FALL, K_MINE, K_SHARD, K_VOID, type Floater, type RunStats } from './entities';
import { ThemeMix, THEMES } from './themes';
import { MODE_ATTRACT, MODE_DEAD, MODE_PLAY, World, type WorldEvents } from './world';

type State = 'menu' | 'playing' | 'paused' | 'countdown' | 'dying' | 'over';

const CHAIN_WORDS = ['', '', 'DOUBLE SMASH!', 'TRIPLE SMASH!', 'MEGA SMASH!', 'ULTRA SMASH!', 'HYPER SMASH!', 'LUMEN SMASH!'];

/**
 * The Game wires everything together: fixed-step loop → World simulation → events → juice
 * (particles, shake, flash, hit-stop, audio, haptics) → renderer, plus UI/meta state.
 */
export class Game implements WorldEvents {
  readonly store = new Store();
  readonly canvas: HTMLCanvasElement;
  readonly rd: Renderer;
  readonly world: World;
  readonly audio = new AudioEngine();
  readonly input: Input;
  readonly loop: Loop;
  readonly particles = new Particles(9000);
  readonly theme = new ThemeMix();
  readonly scene = new SceneDrawer();
  readonly haptics = new Haptics();
  readonly safe = new SafeArea();
  readonly installer = new Installer();
  readonly back = new BackGuard();
  readonly wake = new WakeLock();
  readonly ui: UI;
  state: State = 'menu';
  look: Look;

  // juice
  private time = -0;
  private hitStop = -0;
  private trauma = -0;
  private flash = -0;
  private flashCol = new Float32Array([1, 1, 1]);
  private ca = -0;
  private zoom = -0;
  private zoomKick = -0;
  private camX = -0;
  private camY = -0;
  private deathT = -0;
  private hudScore = -0;
  private hudPulse = -0;
  private hudVisible = -0;
  private bannerT = -0;
  private bannerKind = 0;
  private bannerMain = new TextBuf();
  private bannerSub = new TextBuf();
  private beamT = -0;
  private countdown = 0;
  private countdownT = -0;
  private prismAudio = false;
  private slowAudio = false;
  private missionTimer = -0;
  private shieldFlash = -0;
  private visualMul = -0; // stronger visuals where vibration is unavailable (iPad)
  private dailyRun = false;
  private ghostData: Float32Array | null = null;
  private lastRun: RunStats | null = null;
  private frame: FrameParams;
  private dctx: DrawCtx;
  private reducedMul = -0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, fontFamily: string) {
    this.canvas = canvas;
    setLang(this.store.data.settings.lang);
    this.rd = new Renderer(canvas, new GlyphAtlas(fontFamily));
    this.world = new World(this);
    this.look = resolveLook(this.store.data.equip);
    this.visualMul = CAN_VIBRATE ? 1 : 1.3;
    this.reducedMul = 1;
    this.zoom = 1;
    this.bannerT = -1;
    this.beamT = -1;
    refillMissions(this.store.data);
    this.store.save();

    this.frame = {
      time: 0, camX: 0, camY: 0, zoom: 1,
      bg0: this.theme.bg0, bg1: this.theme.bg1, bg2: this.theme.bg2, bg3: this.theme.bg3,
      darkRim: this.theme.darkRim, prism: 0, beat: 0, parX: 0, parY: 0, flash: 0, flashCol: this.flashCol,
      ca: 0, breath: 0, desat: 0, vignette: 0.85, grain: 0.022, bloom: 0.72, highContrast: 0,
    };
    this.dctx = {
      time: 0, beat: 0, look: this.look, theme: this.theme, camX: 0, camY: 0, safeTop: 0, safeBottom: 0,
      hudScore: 0, hudPulse: 0, hudVisible: 0, bannerT: -1, bannerKind: 0, bannerMain: this.bannerMain, bannerSub: this.bannerSub,
      beamT: -1, countdown: 0, countdownT: 0, reduced: false, highContrast: false, shieldFlash: 0,
    };

    this.ui = new UI(uiRoot, this.store, {
      play: (daily) => this.startRun(daily),
      resume: () => this.resume(),
      restart: () => this.startRun(this.dailyRun),
      menu: () => this.toMenu(),
      share: () => this.share(),
      install: () => void this.installer.prompt(),
      settingsChanged: () => this.applySettings(),
      equipChanged: () => { this.look = resolveLook(this.store.data.equip); this.dctx.look = this.look; },
      uiSound: () => this.audio.ui(),
      dailyBest: () => this.store.data.dailyBest[dayKey()] ?? 0,
    });
    this.ui.pauseHandler = () => this.pause();
    this.installer.onChange = () => this.ui.setInstallVisible(this.installer.available);
    this.back.onBack = () => {
      if (this.state === 'playing' || this.state === 'countdown') this.pause();
    };

    this.input = new Input(canvas);
    this.input.onPress = () => this.onPress();
    // audio unlock on any gesture anywhere (Safari requires it inside the gesture)
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('touchend', unlock, true);
    window.addEventListener('keydown', unlock, true);

    this.loop = new Loop({
      step: (dt) => this.step(dt),
      render: (a, fdt) => this.render(a, fdt),
      timeScale: () => this.timeScale(),
    });

    if (!this.rd.init()) throw new Error('WebGL2 unavailable');
    this.setupLifecycle();
    this.applySettings();
    this.resize();
    this.world.reset(MODE_ATTRACT, 7, false);
    this.ui.showMenu();
    this.loop.start();

    if (IS_IOS && !isStandalone() && !this.store.data.seen.iosHint) {
      setTimeout(() => this.ui.showIosHint(() => { this.store.data.seen.iosHint = true; this.store.save(); }), 1600);
    }
  }

  // ---------------------------------------------------------------- lifecycle

  private setupLifecycle(): void {
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      let pw: number | undefined, ph: number | undefined;
      const dpcb = (e as ResizeObserverEntry & { devicePixelContentBoxSize?: ReadonlyArray<ResizeObserverSize> }).devicePixelContentBoxSize;
      if (dpcb && dpcb[0] && !this.store.data.settings.battery) { pw = dpcb[0].inlineSize; ph = dpcb[0].blockSize; }
      this.resize(e.contentRect.width, e.contentRect.height, pw, ph);
    });
    try { ro.observe(this.canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(this.canvas); }
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));

    const autoPause = (): void => {
      if (this.state === 'playing' || this.state === 'countdown') this.pause();
      this.input.releaseAll();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        autoPause();
        this.audio.suspend();
        this.wake.off();
      } else {
        this.audio.resume();
        if (this.state === 'paused' || this.state === 'playing') void this.wake.on();
      }
    });
    window.addEventListener('blur', autoPause);
    window.addEventListener('pagehide', autoPause);

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.rd.lost = true;
      autoPause();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      try {
        this.rd.init();
        this.applySettings();
        this.resize();
      } catch (err) {
        console.warn('GL restore failed', err);
      }
    });
  }

  resize(cssW?: number, cssH?: number, pw?: number, ph?: number): void {
    const r = this.canvas.getBoundingClientRect();
    const w = cssW ?? r.width, h = cssH ?? r.height;
    if (w < 2 || h < 2) return;
    let dpr = window.devicePixelRatio || 1;
    const battery = this.store.data.settings.battery;
    if (battery) { dpr = Math.min(dpr, 2); pw = undefined; ph = undefined; }
    this.rd.resize(w, h, dpr, pw, ph);
    this.world.viewHalfW = this.rd.halfW;
    this.world.viewHalfH = this.rd.halfH;
    this.safe.read();
  }

  applySettings(): void {
    const s = this.store.data.settings;
    setLang(s.lang);
    this.audio.setVolumes(s.music, s.sfx);
    this.haptics.enabled = s.vibration;
    this.loop.setFrameCap(s.battery ? 60 : 0);
    this.rd.setBloomLevels(s.battery ? 4 : 6);
    this.particles.density = s.battery ? 0.5 : 1;
    this.reducedMul = s.reduced ? 0.25 : 1;
    this.frame.grain = s.battery ? 0 : 0.022;
    this.frame.highContrast = s.highContrast ? 1 : 0;
    this.dctx.highContrast = s.highContrast;
    this.dctx.reduced = s.reduced;
    this.ui.setFps(s.showFps ? 0 : null);
    this.resize();
  }

  // ---------------------------------------------------------------- state transitions

  private onPress(): void {
    this.audio.unlock();
    if (this.state === 'menu' && this.ui.menuVisible) this.startRun(false);
  }

  startRun(daily: boolean): void {
    this.dailyRun = daily;
    const seed = daily ? daySeed() : (Math.random() * 0xffffffff) >>> 0;
    this.world.reset(MODE_PLAY, seed, daily);
    this.world.held = this.input.isDown();
    this.ghostData = null;
    if (daily) {
      const g = this.store.data.dailyGhost;
      if (g && g.key === dayKey()) this.ghostData = decodeGhost(g.data);
    }
    this.particles.clear();
    this.theme.go(0, 0.8);
    this.audio.setPhase(1);
    this.audio.setIntensity(1);
    this.audio.restoreMusic();
    this.audio.setPrism(false);
    this.audio.setSlow(false);
    this.prismAudio = this.slowAudio = false;
    this.hudScore = 0;
    this.deathT = 0;
    this.zoom = 1;
    this.bannerT = -1;
    this.beamT = -1;
    this.countdown = 0;
    this.state = 'playing';
    this.ui.showGame();
    this.back.arm();
    void this.wake.on();
    lockPortrait();
    if (daily) this.banner(2, t('dailyWord'), dayKey());
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.state = 'paused';
    this.countdown = 0;
    this.input.releaseAll();
    this.ui.showPause();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.ui.hidePause();
    this.state = 'countdown';
    this.countdown = 3;
    this.countdownT = 0;
    this.audio.resume();
    this.audio.countdown(false);
    this.back.arm();
    void this.wake.on();
  }

  toMenu(): void {
    this.state = 'menu';
    this.back.disarm();
    this.wake.off();
    this.world.reset(MODE_ATTRACT, 7, false);
    this.theme.go(0, 1.2);
    this.audio.setPhase(1);
    this.audio.setIntensity(0);
    this.audio.restoreMusic();
    this.audio.setPrism(false);
    this.audio.setSlow(false);
    this.ui.showMenu();
  }

  private finishRun(): void {
    const d = this.store.data;
    const run = this.world.stats;
    run.score = this.world.score;
    const M = CFG.meta;
    run.crumbs = Math.floor(run.orbs * M.crumbsPerOrb + run.smashes * M.crumbsPerSmash + run.score * M.crumbsPerScore);
    const prevBest = d.best;
    const key = dayKey();
    const prevDaily = d.dailyBest[key] ?? 0;
    checkMissions(d, run);
    commitMissions(d, run);
    applyRun(d, run);
    let newBest = run.score > prevBest && run.score > 0;
    if (run.daily) {
      newBest = run.score > prevDaily && run.score > 0;
      if (newBest) {
        d.dailyBest[key] = run.score;
        d.dailyGhost = { key, data: encodeGhost(this.world.ghostRec, this.world.ghostLen) };
      }
      // keep only the last 14 days
      const keys = Object.keys(d.dailyBest).sort();
      while (keys.length > 14) delete d.dailyBest[keys.shift()!];
    }
    const ach = checkAchievements(d, run);
    refillMissions(d);
    this.store.save();
    this.lastRun = run;
    this.ui.showOver(run, d.best, newBest, d.dailyBest[key] ?? 0, ach.map((a) => (d.settings.lang === 'pl' ? a.pl[0] : a.en[0])));
    this.back.disarm();
    this.wake.off();
  }

  private async share(): Promise<void> {
    if (!this.lastRun) return;
    await shareRun(this.lastRun, this.store.data.best, this.theme.index());
  }

  // ---------------------------------------------------------------- loop hooks

  private timeScale(): number {
    if (this.hitStop > 0) return 0;
    switch (this.state) {
      case 'paused': case 'countdown': return 0;
      case 'dying': return clamp(1 - this.deathT * 1.8, CFG.juice.deathSlowmo, 1);
      case 'over': return 0.06;
      case 'playing': return this.world.slowT > 0 ? CFG.booster.slowmoScale : 1;
      default: return 1;
    }
  }

  private step(dt: number): void {
    const w = this.world;
    if (this.state === 'playing') w.held = this.input.isDown();
    else if (w.mode === MODE_PLAY) w.held = false;
    w.step(dt);
    if (this.state === 'playing') {
      this.missionTimer += dt;
      if (this.missionTimer > 0.5) {
        this.missionTimer = 0;
        const done = checkMissions(this.store.data, w.stats);
        if (done) {
          for (const m of done) this.ui.toast(`✓ ${t('missionDone')} +${m.reward}`);
          this.store.save();
        }
      }
    }
  }

  private render(alpha: number, fdt: number): void {
    const w = this.world;
    this.time += fdt;
    const reduced = this.reducedMul;

    // hit-stop counts in real time
    if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - fdt);

    // state timers
    if (this.state === 'countdown') {
      this.countdownT += fdt;
      if (this.countdownT >= 0.8) {
        this.countdownT = 0;
        this.countdown--;
        if (this.countdown <= 0) {
          this.state = 'playing';
          this.audio.countdown(true);
        } else this.audio.countdown(false);
      }
    }
    if (this.state === 'dying') {
      this.deathT += fdt;
      if (this.deathT >= CFG.juice.gameOverDelay) {
        this.state = 'over';
        this.finishRun();
      }
    }

    // booster audio states
    const prismOn = w.prismT > 0;
    if (prismOn !== this.prismAudio) { this.prismAudio = prismOn; this.audio.setPrism(prismOn); }
    const slowOn = w.slowT > 0;
    if (slowOn !== this.slowAudio) { this.slowAudio = slowOn; this.audio.setSlow(slowOn); }

    // visuals update (scaled by sim speed so slow-mo looks slow)
    const vs = this.state === 'paused' || this.state === 'countdown' ? 0 : this.hitStop > 0 ? 0.05 : this.timeScale();
    const vdt = fdt * vs;
    this.particles.update(vdt);
    this.theme.update(fdt);
    this.ambient(vdt);

    // juice decay
    this.trauma = Math.max(0, this.trauma - fdt * 1.6);
    this.flash *= Math.exp(-fdt * 7);
    this.ca *= Math.exp(-fdt * 6);
    this.zoomKick *= Math.exp(-fdt * 5);
    this.hudPulse *= Math.exp(-fdt * 8);
    this.shieldFlash *= Math.exp(-fdt * 4);
    if (this.bannerT >= 0) this.bannerT += fdt;
    if (this.beamT >= 0) { this.beamT += fdt; if (this.beamT > 1.2) this.beamT = -1; }
    const targetZoom = this.state === 'dying' || this.state === 'over' ? 1.07 : 1;
    this.zoom += (targetZoom - this.zoom) * damp(2.5, fdt);

    const sh = this.trauma * this.trauma * CFG.juice.shakeMax * reduced * this.visualMul;
    this.camX = (Math.sin(this.time * 71.3) + Math.sin(this.time * 43.7) * 0.5) * sh;
    this.camY = (Math.cos(this.time * 63.1) + Math.sin(this.time * 37.9) * 0.5) * sh;
    if (this.state === 'dying' || this.state === 'over') {
      this.camX += (w.deathX * 0.06 - this.camX) * 0.5;
      this.camY += (w.deathY * 0.06 - this.camY) * 0.5;
    }

    // HUD score count-up
    if (w.mode === MODE_PLAY || w.mode === MODE_DEAD) {
      const target = w.score;
      if (this.hudScore < target) {
        this.hudScore += Math.max(1, (target - this.hudScore) * damp(12, fdt));
        if (this.hudScore > target) this.hudScore = target;
      } else this.hudScore = target;
    }
    const hudTarget = this.state === 'playing' || this.state === 'countdown' || this.state === 'paused' ? 1 : 0;
    this.hudVisible += (hudTarget - this.hudVisible) * damp(6, fdt);

    // audio intensity follows the multiplier
    if (w.mode === MODE_PLAY) this.audio.setIntensity(w.mult);
    // falling towards the core: a heartbeat that speeds up as it gets closer
    if (this.state === 'playing' && w.vr < 0) {
      const danger = clamp((CFG.spark.dangerRadius - w.orbitR) / (CFG.spark.dangerRadius - CFG.spark.deathRadius), 0, 1);
      this.heartT -= fdt;
      if (danger > 0.05 && this.heartT <= 0) {
        this.audio.heartbeat(danger);
        if (danger > 0.5) this.haptics.tick();
        this.heartT = 0.62 - danger * 0.32;
      }
    }
    const beat = this.audio.beat();

    if (this.rd.lost) return;
    const rd = this.rd;
    rd.begin();
    const c = this.dctx;
    c.time = this.time;
    c.beat = beat;
    c.camX = this.camX;
    c.camY = this.camY;
    c.safeTop = (this.safe.top + 10) / rd.scale;
    c.safeBottom = this.safe.bottom / rd.scale;
    c.hudScore = Math.floor(this.hudScore);
    c.hudPulse = this.hudPulse;
    c.hudVisible = this.hudVisible;
    c.bannerT = this.bannerT;
    c.bannerKind = this.bannerKind;
    c.beamT = this.beamT;
    c.countdown = this.state === 'countdown' ? this.countdown : 0;
    c.countdownT = this.countdownT;
    c.shieldFlash = this.shieldFlash;

    let gx = 0, gy = 0, gOn = false;
    if (this.ghostData && w.mode === MODE_PLAY && w.daily) {
      const i = Math.floor(w.runT * 30) * 2;
      if (i + 1 < this.ghostData.length) { gx = this.ghostData[i]; gy = this.ghostData[i + 1]; gOn = true; }
    }
    this.scene.draw(rd, w, alpha, this.particles, c, gx, gy, gOn);

    const f = this.frame;
    f.time = this.time;
    f.camX = this.camX;
    f.camY = this.camY;
    f.zoom = this.zoom * (1 + this.zoomKick * 0.03 * reduced);
    f.prism = clamp(w.prismT * 2, 0, 1) * (this.store.data.settings.reduced ? 0.4 : 1);
    f.beat = beat;
    f.parX = w.cx / 1000;
    f.parY = w.cy / 1000;
    f.flash = Math.min(0.6, this.flash * (this.store.data.settings.reduced ? 0.3 : 1));
    f.ca = this.store.data.settings.reduced ? 0 : this.ca;
    f.breath = w.slowT > 0 ? 0.5 + 0.5 * Math.sin(this.time * 4.2) : 0;
    f.desat = this.state === 'over' ? 0.35 : this.state === 'dying' ? clamp(this.deathT, 0, 0.35) : 0;
    rd.end(f);

    if (this.store.data.settings.showFps) {
      this.fpsT += fdt;
      if (this.fpsT > 0.5) { this.fpsT = 0; this.ui.setFps(this.loop.fps); }
    }
  }
  private fpsT = -0;
  private heartT = -0;
  private chainF: Floater | null = null;
  private chainF2: Floater | null = null;

  /** Ambient particles: comet tails, spark sparkle, prism shards. Rates are per real second. */
  private ambient(dt: number): void {
    if (dt <= 0) return;
    const w = this.world, p = this.particles, th = this.theme;
    const items = w.obs.items;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      if (!o.active) continue;
      if (o.kind === K_COMET && Math.random() < dt * 90) {
        p.emit(P_GLOW, o.x + (Math.random() - 0.5) * 16, o.y + (Math.random() - 0.5) * 16, -o.vx * 0.08, -o.vy * 0.08, 0.6, 14, th.light[0], th.light[1], th.light[2], 0.6, 1.5);
      } else if (o.kind === K_FALL && Math.random() < dt * 20) {
        const a = Math.random() * TAU;
        p.emit(P_GLOW, o.x + Math.cos(a) * o.r, o.y + Math.sin(a) * o.r, 0, -40, 0.8, 10, th.light[0], th.light[1], th.light[2], 0.35, 1);
      } else if (o.kind === K_VOID && Math.random() < dt * 12) {
        const a = Math.random() * TAU;
        p.emit(P_GLOW, o.x + Math.cos(a) * o.r * 2.2, o.y + Math.sin(a) * o.r * 2.2, -Math.cos(a) * 50, -Math.sin(a) * 50, 0.5, 6, th.darkRim[0], th.darkRim[1], th.darkRim[2], 0.6, 0);
      }
    }
    if (w.mode !== MODE_DEAD) {
      const speed = w.omega / CFG.spark.maxOmega;
      if (Math.random() < dt * (6 + speed * 30)) {
        const vx = (Math.random() - 0.5) * 40, vy = (Math.random() - 0.5) * 40;
        p.emit(P_GLOW, w.sx, w.sy, vx, vy, 0.5, 7, th.spark[0], th.spark[1], th.spark[2], 0.6, 2);
      }
      if (w.prismT > 0 && Math.random() < dt * 40) {
        const a = Math.random() * TAU, sp = 80 + Math.random() * 120;
        const r = 0.5 + 0.5 * Math.cos(this.time * 3), g = 0.5 + 0.5 * Math.cos(this.time * 3 + 2), b = 0.5 + 0.5 * Math.cos(this.time * 3 + 4);
        p.emit(P_SHARD, w.sx, w.sy, Math.cos(a) * sp, Math.sin(a) * sp, 0.5, 4, r * 2.4, g * 2.4, b * 2.4, 0.9, 3);
      }
      if (w.rocketT > 0 && Math.random() < dt * 120) {
        p.emit(P_STREAK, w.sx, w.sy, (w.spx - w.sx) * 60 + (Math.random() - 0.5) * 60, (w.spy - w.sy) * 60 + (Math.random() - 0.5) * 60, 0.35, 5, 2.6, 1.2, 0.4, 0.9, 3);
      }
    }
  }

  // ---------------------------------------------------------------- juice helpers

  private shake(v: number): void {
    this.trauma = Math.min(1, this.trauma + v);
  }

  private doFlash(v: number, r: number, g: number, b: number): void {
    const k = v * this.visualMul;
    if (k > this.flash) {
      this.flash = k;
      this.flashCol[0] = r; this.flashCol[1] = g; this.flashCol[2] = b;
    }
  }

  private banner(kind: number, main: string, sub: string): void {
    this.bannerKind = kind;
    this.bannerT = 0;
    this.bannerMain.clear().str(main);
    this.bannerSub.clear().str(sub);
  }

  // ---------------------------------------------------------------- world events

  collect(x: number, y: number, note: number, points: number): void {
    const th = this.theme, p = this.particles;
    p.burst(P_GLOW, x, y, 7, 60, 200, 0.45, 9, th.orb[0], th.orb[1], th.orb[2], 0.9);
    p.emit(P_RINGLET, x, y, 0, 0, 0.35, 22, th.orb[0], th.orb[1], th.orb[2], 0.9, 0);
    // bounce kick: a short spray towards the core, opposite to where the spark is thrown
    const w = this.world;
    const dx = w.cx - x, dy = w.cy - y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    for (let k = 0; k < 3; k++) {
      const j = (k - 1) * 0.35;
      const ux = dx / d, uy = dy / d;
      const sp = 380 + k * 60;
      p.emit(P_STREAK, x, y, (ux - uy * j) * sp, (uy + ux * j) * sp, 0.22, 4, th.orb[0], th.orb[1], th.orb[2], 0.8, 4);
    }
    this.audio.collect(note);
    this.haptics.tick();
    if (points > 0) {
      const f = this.world.floater(0, x, y - 18, 24, 0.7, 1.7, 1.7, 1.75);
      if (f) f.buf.ch(43).int(points);
      this.hudPulse = Math.min(1, this.hudPulse + 0.25);
    }
  }

  smash(x: number, y: number, r: number, kind: number, chain: number, points: number, rot: number): void {
    const th = this.theme, p = this.particles;
    const n = Math.round(Math.min(22, 5 + r * 0.17) * (kind === K_SHARD ? 0.6 : 1));
    const nx = Math.cos(rot), ny = Math.sin(rot);
    const dens = p.density;
    for (let k = 0; k < Math.round(n * dens); k++) {
      const a = Math.random() * TAU;
      const sp = 140 + Math.random() * (260 + r * 3);
      const ox = Math.cos(a) * r * Math.random(), oy = Math.sin(a) * r * Math.random();
      const dark = ox * nx + oy * ny < 0 && kind !== K_MINE ? 1 : 0;
      p.emit(P_SHARD, x + ox, y + oy, Math.cos(a) * sp, Math.sin(a) * sp, 0.4 + Math.random() * 0.45, 2.5 + Math.random() * (r * 0.06 + 3),
        th.light[0], th.light[1], th.light[2], 0.9, 3.2, 160, dark);
    }
    p.burst(P_STREAK, x, y, 10 + chain * 3, 300, 900, 0.35, 5, th.orb[0], th.orb[1], th.orb[2], 1, 3.5);
    p.burst(P_GLOW, x, y, 8, 40, 260, 0.5, 16 + r * 0.2, th.light[0], th.light[1], th.light[2], 0.4, 3);
    this.world.shock(x, y, r * 2.4 + 60, 0.45, th.light[0], th.light[1], th.light[2], 0.9, 14 + r * 0.1);
    const big = r > 90 || chain >= 3;
    this.shake(0.12 + r * 0.0018 + chain * 0.04);
    this.ca = Math.min(1.0, this.ca + 0.18 + chain * 0.08);
    this.doFlash(0.05 + chain * 0.025 + (big ? 0.05 : 0), th.light[0] * 0.6, th.light[1] * 0.6, th.light[2] * 0.6);
    if (big) this.hitStop = Math.max(this.hitStop, CFG.juice.hitStopBig);
    this.audio.smash(r, chain);
    this.haptics.smash();
    if (points > 0) {
      const f = this.world.floater(0, x, y, 30 + Math.min(20, r * 0.15), 0.9, 1.9, 1.85, 1.6);
      if (f) f.buf.ch(43).int(points);
      this.hudPulse = 1;
    }
  }

  chain(n: number, bonus: number, x: number, y: number): void {
    const word = CHAIN_WORDS[Math.min(n, CHAIN_WORDS.length - 1)];
    const th = this.theme;
    const size = 40 + Math.min(5, n - 2) * 8;
    // a new chain word replaces the previous one instead of stacking on top of it
    if (this.chainF && this.chainF.active) this.chainF.active = false;
    if (this.chainF2 && this.chainF2.active) this.chainF2.active = false;
    const f = (this.chainF = this.world.floater(1, x, y - 60, size, 1.3, 2.4, 2.0, 0.9));
    if (f) f.buf.str(word);
    const f2 = (this.chainF2 = this.world.floater(0, x, y - 60 + size * 1.05, size * 0.6, 1.3, 2.2, 2.0, 1.2));
    if (f2) f2.buf.ch(43).int(bonus);
    this.doFlash(0.1 + n * 0.035, th.bg3[0], th.bg3[1], th.bg3[2]);
    this.ca = Math.min(1.2, this.ca + 0.2 + n * 0.06);
    this.zoomKick = Math.min(1.5, this.zoomKick + 0.3 * n);
    if (n >= 4) { this.shake(0.25); this.hitStop = Math.max(this.hitStop, CFG.juice.hitStopBig); }
    this.haptics.chain();
  }

  multUp(level: number): void {
    const th = this.theme, w = this.world;
    this.banner(0, '×' + level, t('multiplierWord'));
    this.beamT = 0;
    this.doFlash(0.28, th.orb[0] * 0.6, th.orb[1] * 0.6, th.orb[2] * 0.6);
    w.shock(w.cx, w.cy, 900, 0.9, th.orb[0], th.orb[1], th.orb[2], 1, 30);
    w.shock(w.cx, w.cy, 520, 0.6, th.bg3[0] * 1.5, th.bg3[1] * 1.5, th.bg3[2] * 1.5, 1, 18);
    this.particles.burst(P_STREAK, w.cx, w.cy, 40, 500, 1400, 0.6, 6, th.orb[0], th.orb[1], th.orb[2], 1, 2.5);
    this.shake(0.3);
    this.zoomKick = 1.4;
    this.ca = Math.min(2, this.ca + 0.6);
    this.audio.multUp(level);
    this.audio.setIntensity(level);
    this.haptics.multiplier();
  }

  multDown(level: number): void {
    const w = this.world;
    const f = w.floater(3, w.cx, w.cy - CFG.core.radius - 46, 30, 0.9, 2.2, 0.6, 0.6);
    if (f) f.buf.ch(0xd7).int(level);
    this.audio.multDown();
    this.audio.setIntensity(level);
  }

  phase(n: number): void {
    const th = this.theme, w = this.world;
    const idx = (n - 1) % THEMES.length;
    this.theme.go(idx, CFG.phases.transition);
    this.banner(1, `${t('phaseWord')} ${n}`, t(THEME_KEYS[idx]));
    this.audio.setPhase(n);
    this.audio.phase();
    w.shock(w.cx, w.cy, 1800, 1.6, th.bg3[0] * 2, th.bg3[1] * 2, th.bg3[2] * 2, 1, 60);
    this.doFlash(0.35, 1, 1, 1);
    this.shake(0.35);
  }

  nearMiss(x: number, y: number, points: number): void {
    const f = this.world.floater(2, x, y - 40, 28, 0.9, 0.8, 2.2, 2.6);
    if (f) f.buf.str(t('nearMissWord')).str(' +').int(points);
    this.doFlash(0.1, 0.7, 1.2, 1.6);
    this.particles.burst(P_STREAK, x, y, 8, 300, 600, 0.3, 4, 0.8, 2, 2.6, 1);
    this.audio.nearMiss();
    this.haptics.tick();
  }

  thread(x: number, y: number, points: number): void {
    const th = this.theme;
    const f = this.world.floater(1, x, y - 50, 40, 1.1, 2.4, 2.3, 1.2);
    if (f) f.buf.str(t('bullseyeWord'));
    const f2 = this.world.floater(0, x, y - 14, 28, 1.1, 2.2, 2.1, 1.4);
    if (f2) f2.buf.ch(43).int(points);
    for (let k = 0; k < 3; k++) this.particles.emit(P_RINGLET, x, y, 0, 0, 0.5 + k * 0.15, 60 + k * 30, th.orb[0], th.orb[1], th.orb[2], 1, 0);
    this.audio.thread();
  }

  booster(type: number): void {
    const w = this.world;
    const col = BOOSTER_COLORS[type];
    this.banner(2, t(BOOSTER_KEYS[type]), '');
    this.doFlash(0.22, col[0] * 0.4, col[1] * 0.4, col[2] * 0.4);
    w.shock(w.sx, w.sy, type === B_NOVA ? 2600 : 380, type === B_NOVA ? CFG.booster.supernovaTime : 0.5, col[0], col[1], col[2], 1, type === B_NOVA ? 80 : 20);
    this.particles.burst(P_GLOW, w.sx, w.sy, 24, 100, 500, 0.6, 14, col[0], col[1], col[2], 0.9);
    if (type === B_PRISM) this.ca = 1.4;
    if (type === B_NOVA) { this.shake(0.5); this.doFlash(0.45, 1.2, 1.1, 0.9); }
    if (type === B_SLOW) this.zoomKick = 1;
    if (type === B_SHIELD) this.shieldFlash = 1;
    this.audio.booster(type);
    this.haptics.booster();
  }

  boosterEnding(): void {
    /* armour blinking is drawn by the scene; nothing else needed */
  }

  shieldBreak(x: number, y: number): void {
    const f = this.world.floater(1, x, y - 50, 40, 1.0, 1.0, 2.6, 1.4);
    if (f) f.buf.str(t('shieldWord'));
    this.particles.burst(P_SHARD, x, y, 30, 200, 600, 0.9, 7, 1.0, 2.6, 1.4, 1, 2);
    this.world.shock(x, y, 300, 0.5, 1.0, 2.6, 1.4, 1, 20);
    this.doFlash(0.35, 0.4, 1.2, 0.6);
    this.shake(0.4);
    this.hitStop = Math.max(this.hitStop, CFG.juice.hitStopBig);
    this.audio.shieldBreak();
    this.haptics.smash();
  }

  death(x: number, y: number): void {
    const th = this.theme, p = this.particles;
    this.state = 'dying';
    this.deathT = 0;
    this.hitStop = CFG.juice.hitStopDeath;
    p.burst(P_SHARD, x, y, 40, 150, 700, 1.4, 7, th.spark[0], th.spark[1], th.spark[2], 1, 1.5);
    p.burst(P_STREAK, x, y, 36, 400, 1300, 0.7, 6, th.spark[0], th.spark[1], th.spark[2], 1, 2);
    p.burst(P_GLOW, x, y, 20, 50, 300, 1.2, 40, th.darkRim[0], th.darkRim[1], th.darkRim[2], 0.6, 2);
    this.world.shock(x, y, 700, 1.0, th.darkRim[0] * 1.6, th.darkRim[1] * 1.6, th.darkRim[2] * 1.6, 1, 40);
    this.shake(1);
    this.ca = 2.5;
    this.doFlash(0.55, th.darkRim[0] * 0.5, th.darkRim[1] * 0.3, th.darkRim[2] * 0.4);
    this.audio.death();
    this.haptics.death();
    this.input.releaseAll();
  }

  warn(kind: number): void {
    this.audio.warn();
    this.haptics.warn();
    void kind;
  }

  mineBoom(x: number, y: number): void {
    this.particles.burst(P_STREAK, x, y, 24, 400, 900, 0.5, 6, 2.4, 0.3, 0.3, 1, 2);
    this.shake(0.3);
    this.audio.mineBoom();
    this.haptics.smash();
  }

  heatWarn(): void {
    this.audio.heatWarn();
    this.haptics.warn();
  }

  heatBurst(): void {
    this.shake(0.35);
    this.doFlash(0.15, 1.4, 0.2, 0.1);
    this.audio.heatBurst();
  }

  convert(x: number, y: number): void {
    const th = this.theme;
    this.particles.burst(P_GLOW, x, y, 10, 80, 300, 0.6, 14, th.orb[0], th.orb[1], th.orb[2], 0.9);
    this.particles.emit(P_RINGLET, x, y, 0, 0, 0.4, 50, th.orb[0], th.orb[1], th.orb[2], 1, 0);
  }

  // ---------------------------------------------------------------- debug hooks (tests / screenshots)

  debugApi(): Record<string, unknown> {
    return {
      start: (daily = false) => this.startRun(daily),
      god: (on = true) => { this.world.god = on; },
      hold: (on: boolean) => { (this.input as unknown as { key: boolean }).key = on; },
      phase: (n: number) => {
        const w = this.world;
        while (w.phase < n) { w.phase++; w.stats.phase = w.phase; this.phase(w.phase); }
        w.tempo = Math.min(CFG.phases.tempoMax, 1 + CFG.phases.tempoPerPhase * (w.phase - 1));
        this.theme.snap((n - 1) % THEMES.length);
        this.bannerT = -1;
      },
      mult: (m: number) => { this.world.mult = m; this.world.stats.peakMult = Math.max(this.world.stats.peakMult, m); },
      booster: (type: number) => this.world.activate(type),
      kill: () => { this.world.god = false; this.world.die(this.world.sx, this.world.sy); },
      advance: (sec: number) => { const n = Math.round(sec * CFG.sim.hz); for (let i = 0; i < n; i++) this.step(1 / CFG.sim.hz); },
      state: () => ({ state: this.state, score: this.world.score, mult: this.world.mult, phase: this.world.phase, obstacles: this.world.obs.countActive(), orbs: this.world.orbs.countActive(), fps: this.loop.fps, hdr: this.rd.hdr }),
      clearBanner: () => { this.bannerT = -1; },
    };
  }
}
