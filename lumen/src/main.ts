import './styles.css';
import { Game } from './game/game';
import { registerSW } from './platform/sw-register';

async function boot(): Promise<void> {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  // the glyph atlas needs the bundled font to be ready
  let family = 'Fredoka';
  try {
    await Promise.race([
      Promise.all([document.fonts.load('700 120px Fredoka'), document.fonts.load('600 40px Fredoka')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    if (!document.fonts.check('700 120px Fredoka')) family = 'Fredoka, system-ui, sans-serif';
  } catch {
    family = 'Fredoka, system-ui, sans-serif';
  }
  let game: Game;
  try {
    game = new Game(canvas, ui, family);
  } catch (e) {
    console.error(e);
    ui.innerHTML = '<div class="fatal">LUMEN needs WebGL2.<br>Please update your browser.</div>';
    return;
  }
  document.documentElement.classList.add('ready');
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 700);
  }
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { __lumen: unknown }).__lumen = game.debugApi();
  }
  registerSW(game.ui);
}

void boot();
