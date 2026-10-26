/** Platform glue: device detection, haptics, safe areas, install prompt, back gesture, wake lock, orientation. */

const ua = navigator.userAgent;
export const IS_IOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const IS_ANDROID = /Android/i.test(ua);
export const IS_SAMSUNG = /SamsungBrowser/i.test(ua);

export function isStandalone(): boolean {
  try {
    return (
      matchMedia('(display-mode: fullscreen)').matches ||
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

export const CAN_VIBRATE = typeof navigator.vibrate === 'function' && !IS_IOS;

export class Haptics {
  enabled = true;
  private last = 0;
  play(pattern: number | number[], minGapMs = 0): void {
    if (!this.enabled || !CAN_VIBRATE) return;
    const now = performance.now();
    if (now - this.last < minGapMs) return;
    this.last = now;
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
  // prebuilt patterns (no allocation at call time)
  tick(): void { this.play(8, 35); }
  smash(): void { this.play(18, 25); }
  chain(): void { this.play(CHAIN); }
  death(): void { this.play(DEATH); }
  booster(): void { this.play(BOOST); }
  multiplier(): void { this.play(MULT); }
  warn(): void { this.play(WARN, 200); }
}
const CHAIN = [15, 30, 15, 30, 28];
const DEATH = [120, 60, 220];
const BOOST = [30, 40, 30];
const MULT = [20, 30, 40];
const WARN = [10, 60, 10];

/** Reads env(safe-area-inset-*) through a probe element (css px). */
export class SafeArea {
  top = 0; right = 0; bottom = 0; left = 0;
  private probe: HTMLDivElement;
  constructor() {
    const p = document.createElement('div');
    p.style.cssText =
      'position:fixed;inset:0;pointer-events:none;visibility:hidden;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    document.body.appendChild(p);
    this.probe = p;
    this.read();
  }
  read(): void {
    const cs = getComputedStyle(this.probe);
    this.top = parseFloat(cs.paddingTop) || 0;
    this.right = parseFloat(cs.paddingRight) || 0;
    this.bottom = parseFloat(cs.paddingBottom) || 0;
    this.left = parseFloat(cs.paddingLeft) || 0;
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

/** Chrome / Samsung Internet "Install game" button support. */
export class Installer {
  private ev: BeforeInstallPromptEvent | null = null;
  onChange: (() => void) | null = null;
  installed = isStandalone();
  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.ev = e as BeforeInstallPromptEvent;
      this.onChange?.();
    });
    window.addEventListener('appinstalled', () => {
      this.installed = true;
      this.ev = null;
      this.onChange?.();
    });
  }
  get available(): boolean {
    return !!this.ev && !this.installed;
  }
  async prompt(): Promise<void> {
    if (!this.ev) return;
    try {
      await this.ev.prompt();
      const c = await this.ev.userChoice;
      if (c.outcome === 'accepted') this.installed = true;
    } catch { /* ignore */ }
    this.ev = null;
    this.onChange?.();
  }
}

/**
 * Android system back gesture: while playing we keep one extra history entry, so "back"
 * pops it and we pause instead of leaving the app.
 */
export class BackGuard {
  private armed = false;
  onBack: (() => void) | null = null;
  constructor() {
    window.addEventListener('popstate', () => {
      if (!this.armed) return;
      this.armed = false;
      this.onBack?.();
    });
  }
  arm(): void {
    if (this.armed) return;
    try {
      history.pushState({ lumen: 1 }, '');
      this.armed = true;
    } catch { /* ignore */ }
  }
  disarm(): void {
    if (!this.armed) return;
    this.armed = false;
    try { history.back(); } catch { /* ignore */ }
  }
}

export class WakeLock {
  private lock: { release(): Promise<void> } | null = null;
  async on(): Promise<void> {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl && !this.lock) this.lock = await wl.request('screen');
    } catch { this.lock = null; }
  }
  off(): void {
    try { void this.lock?.release(); } catch { /* ignore */ }
    this.lock = null;
  }
}

/** Lock portrait on Android (installed PWA / fullscreen). iPad keeps both orientations. */
export function lockPortrait(): void {
  if (IS_IOS) return;
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (o && o.lock) o.lock('portrait').catch(() => undefined);
  } catch { /* ignore */ }
}

export function prefersReducedMotion(): boolean {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
