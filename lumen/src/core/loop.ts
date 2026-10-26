import { CFG } from '../config';

export interface LoopHooks {
  /** One fixed simulation step of `dt` seconds (sim time). */
  step(dt: number): void;
  /** Render with interpolation factor alpha in [0,1). frameDt = real seconds since last frame. */
  render(alpha: number, frameDt: number): void;
  /** Real-time scale applied to the simulation clock (slow-mo, hit-stop). */
  timeScale(): number;
}

/**
 * Fixed-timestep loop with render interpolation.
 * Never capped by us: requestAnimationFrame runs at the display's native rate (120 Hz on S24 Ultra / ProMotion).
 * An optional frame cap (battery saver) simply skips presenting frames.
 */
export class Loop {
  readonly dt = 1 / CFG.sim.hz;
  private acc = -0;
  private last = -1;
  private running = false;
  private raf = -0;
  private capInterval = -0;
  private lastPresent = -0;
  fps = -0;
  private fpsAcc = -0;
  private fpsFrames = -0;

  constructor(private hooks: LoopHooks) {}

  setFrameCap(fps: number): void {
    this.capInterval = fps > 0 ? 1000 / fps - 1.5 : 0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.capInterval > 0 && now - this.lastPresent < this.capInterval) return;
    this.lastPresent = now;
    if (this.last < 0) this.last = now;
    let frameDt = (now - this.last) / 1000;
    this.last = now;
    if (frameDt > 0.25) frameDt = 0.25;
    if (frameDt < 0) frameDt = 0;

    this.fpsAcc += frameDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    try {
      this.acc += frameDt * this.hooks.timeScale();
      let steps = 0;
      while (this.acc >= this.dt && steps < CFG.sim.maxSteps) {
        this.hooks.step(this.dt);
        this.acc -= this.dt;
        steps++;
      }
      if (steps >= CFG.sim.maxSteps) this.acc = 0;
      this.hooks.render(this.acc / this.dt, frameDt);
    } catch (e) {
      // never let one bad frame kill the loop; report each distinct error once
      const msg = String(e);
      if (msg !== this.lastError) {
        this.lastError = msg;
        console.error(e);
      }
    }
  };
  private lastError = '';
}
