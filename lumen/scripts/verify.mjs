// Visual + runtime verification in headless Chromium (Playwright).
//   npm run build && npx vite preview --port 4173 &
//   node scripts/verify.mjs [outDir] [baseUrl]
// Takes screenshots of menu / gameplay / late phase / Prism / game over for every target
// viewport, and fails on any console error.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || 'screenshots';
const base = process.argv[3] || 'http://localhost:4173/';
mkdirSync(out, { recursive: true });

export const VIEWPORTS = [
  { name: 's24-ultra', width: 384, height: 832, dpr: 2.8125, mobile: true },
  { name: 'ipad-portrait', width: 820, height: 1180, dpr: 2, mobile: true },
  { name: 'ipad-landscape', width: 1180, height: 820, dpr: 2, mobile: true },
  { name: 'ipad-pro-13', width: 1032, height: 1376, dpr: 2, mobile: true },
  { name: 'ipad-split', width: 375, height: 1180, dpr: 2, mobile: true },
];

const only = process.env.ONLY;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;

for (const vp of VIEWPORTS) {
  if (only && !vp.name.includes(only)) continue;
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(base + '?debug=1');
  await page.waitForFunction(() => !!window.__lumen, null, { timeout: 30000 });
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const shot = (n) => page.screenshot({ path: join(out, `${vp.name}-${n}.png`) });
  await shot('1-menu');

  // early gameplay
  await page.evaluate(() => { const l = window.__lumen; l.god(true); l.start(false); l.hold(true); l.advance(9.5); });
  await page.waitForTimeout(700);
  await shot('2-play');

  // late phase, busy screen
  await page.evaluate(() => {
    const l = window.__lumen;
    l.phase(6); l.mult(8); l.advance(14); l.clearBanner();
  });
  await page.waitForTimeout(700);
  await shot('3-late');

  // prism
  await page.evaluate(() => { const l = window.__lumen; l.booster(0); l.advance(0.6); l.clearBanner(); });
  await page.waitForTimeout(600);
  await shot('4-prism');

  // game over
  await page.evaluate(() => { const l = window.__lumen; l.hold(false); l.kill(); });
  await page.waitForTimeout(2600);
  await shot('5-over');
  const st = await page.evaluate(() => window.__lumen.state());
  console.log(vp.name, JSON.stringify(st));
  if (st.state !== 'over') { console.error(vp.name, 'expected game over state'); failures++; }
  if (errors.length) { console.error(vp.name, 'console errors:\n  ' + errors.join('\n  ')); failures++; }
  await ctx.close();
}
await browser.close();
if (failures) { console.error(`FAILED (${failures})`); process.exit(1); }
console.log('verify: OK');
