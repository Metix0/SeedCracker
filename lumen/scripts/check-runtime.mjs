// Runtime checks in headless Chromium:
//  1) a crowded session runs without console errors
//  2) the game works offline once the service worker has cached it
// (Allocation-freedom of the game loop is checked by scripts/check-alloc.mjs.)
//   npm run build && npx vite preview --port 4173 &  node scripts/check-runtime.mjs
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://localhost:4173/';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 384, height: 832 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
let ok = true;

// ---- 1) a short session must run without console errors
await page.goto(base + '?debug=1');
await page.waitForFunction(() => !!window.__lumen);
await page.evaluate(() => { const l = window.__lumen; l.god(true); l.start(false); l.hold(true); l.phase(6); l.advance(20); });
await page.waitForTimeout(3000);
const st = await page.evaluate(() => window.__lumen.state());
console.log('session:', JSON.stringify(st));
if (st.state !== 'playing' || st.obstacles === 0) { console.error('FAIL: game not running'); ok = false; }

// ---- 2) offline check
await page.goto(base);
await page.waitForFunction(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return !!(r && r.active);
}, null, { timeout: 30000 });
await page.reload();
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => document.documentElement.classList.contains('ready'), null, { timeout: 20000 });
const offline = await page.evaluate(() => ({
  menu: !!document.querySelector('.menu .logo'),
  font: document.fonts.check('700 40px Fredoka'),
  controlled: !!navigator.serviceWorker.controller,
}));
console.log('offline reload:', JSON.stringify(offline));
if (!offline.menu || !offline.controlled) { console.error('FAIL: offline start'); ok = false; }
await ctx.setOffline(false);

if (errors.length) { console.error('console errors:', errors); ok = false; }
await browser.close();
if (!ok) process.exit(1);
console.log('runtime checks: OK');
