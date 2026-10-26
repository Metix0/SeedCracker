/**
 * One-button input: "is anything pressing right now?"
 * Pointer Events cover finger, S Pen / Apple Pencil (contact only, hover ignored) and mouse.
 * Multi-touch is safe: we count active pointers, any of them holds the orbit.
 * Space bar works too.
 */
export class Input {
  private pointers = new Set<number>();
  private key = false;
  enabled = true;
  /** fires on every new press (first pointer down / space) — used for audio unlock & "tap to start" */
  onPress: (() => void) | null = null;

  constructor(private surface: HTMLElement) {
    const opts: AddEventListenerOptions = { passive: false };
    surface.addEventListener('pointerdown', this.down, opts);
    window.addEventListener('pointerup', this.up, opts);
    window.addEventListener('pointercancel', this.up, opts);
    surface.addEventListener('lostpointercapture', this.up, opts);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', () => this.releaseAll());
    // never let the browser interpret gestures on the play surface
    surface.addEventListener('touchstart', (e) => e.preventDefault(), opts);
    surface.addEventListener('touchmove', (e) => e.preventDefault(), opts);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(): boolean {
    return this.enabled && (this.pointers.size > 0 || this.key);
  }

  releaseAll(): void {
    this.pointers.clear();
    this.key = false;
  }

  private down = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const first = this.pointers.size === 0 && !this.key;
    this.pointers.add(e.pointerId);
    try { this.surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (first && this.onPress) this.onPress();
  };

  private up = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };

  private keyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
    e.preventDefault();
    if (e.repeat) return;
    const first = this.pointers.size === 0 && !this.key;
    this.key = true;
    if (first && this.onPress) this.onPress();
  };

  private keyUp = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    this.key = false;
  };
}
