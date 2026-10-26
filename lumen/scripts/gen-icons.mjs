// Generates PWA icons + iPad launch screens into public/ (run: node scripts/gen-icons.mjs).
// Drawn procedurally with Canvas 2D inside headless Chromium, so no binary design files are needed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// CommonJS require honours NODE_PATH (handy when Playwright is installed globally)
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
mkdirSync(join(pub, 'icons'), { recursive: true });
mkdirSync(join(pub, 'splash'), { recursive: true });

const IPAD = [[744, 1133], [810, 1080], [820, 1180], [834, 1194], [834, 1210], [1024, 1366], [1032, 1376]];

const jobs = [
  { file: 'icons/icon-192.png', w: 192, h: 192, kind: 'icon', pad: 0.0 },
  { file: 'icons/icon-512.png', w: 512, h: 512, kind: 'icon', pad: 0.0 },
  { file: 'icons/maskable-192.png', w: 192, h: 192, kind: 'icon', pad: 0.12 },
  { file: 'icons/maskable-512.png', w: 512, h: 512, kind: 'icon', pad: 0.12 },
  { file: 'icons/apple-touch-icon.png', w: 180, h: 180, kind: 'icon', pad: 0.04 },
  { file: 'icons/favicon-64.png', w: 64, h: 64, kind: 'icon', pad: 0.0 },
];
for (const [w, h] of IPAD) {
  jobs.push({ file: `splash/splash-${w * 2}x${h * 2}.png`, w: w * 2, h: h * 2, kind: 'splash' });
  jobs.push({ file: `splash/splash-${h * 2}x${w * 2}.png`, w: h * 2, h: w * 2, kind: 'splash' });
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body style="margin:0;background:#000"></body></html>');

for (const job of jobs) {
  const data = await page.evaluate(({ w, h, kind, pad }) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const S = Math.min(w, h);
    const cx = w / 2, cy = h / 2;
    // background
    const k = kind === 'icon' ? S * (1 - (pad || 0) * 2) : S * 0.42;
    if (kind === 'icon') {
      const bg = g.createRadialGradient(cx, cy * 0.95, 0, cx, cy, Math.max(w, h) * 0.75);
      bg.addColorStop(0, '#3d0a26');
      bg.addColorStop(0.45, '#17040f');
      bg.addColorStop(1, '#07020c');
      g.fillStyle = bg;
    } else {
      // launch screens: flat background keeps the PNGs small
      g.fillStyle = '#07020c';
    }
    g.fillRect(0, 0, w, h);
    // nebula wisps
    for (let i = 0; i < (kind === 'icon' ? 5 : 0); i++) {
      const a = i * 1.7 + 0.4;
      const x = cx + Math.cos(a) * k * 0.35, y = cy + Math.sin(a) * k * 0.3;
      const r = k * (0.35 + (i % 3) * 0.12);
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, i % 2 ? 'rgba(255,60,130,0.20)' : 'rgba(150,40,200,0.16)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
    }
    // orbit ring
    const orbit = k * 0.33;
    g.strokeStyle = 'rgba(255,200,225,0.18)';
    g.lineWidth = Math.max(1, k * 0.008);
    g.beginPath();
    g.arc(cx, cy, orbit, 0, Math.PI * 2);
    g.stroke();
    // trail arc
    const sa = -Math.PI * 0.25;
    for (let i = 0; i < 40; i++) {
      const t = i / 40;
      const a = sa - t * 1.6;
      g.fillStyle = `rgba(255,${200 - t * 60},${225 - t * 60},${(1 - t) * 0.55})`;
      g.beginPath();
      g.arc(cx + Math.cos(a) * orbit, cy + Math.sin(a) * orbit, k * 0.045 * (1 - t * 0.85), 0, Math.PI * 2);
      g.fill();
    }
    // core: dark spiky star with glowing rim
    const R = k * 0.17, L = k * 0.055, n = 14;
    g.save();
    g.shadowColor = 'rgba(255,61,122,0.95)';
    g.shadowBlur = k * 0.12;
    g.beginPath();
    for (let i = 0; i <= n * 8; i++) {
      const a = (i / (n * 8)) * Math.PI * 2;
      const tri = 1 - Math.abs(((a * n) / (Math.PI * 2)) % 1 * 2 - 1);
      const r = R + L * Math.pow(tri, 2.6);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    const cf = g.createRadialGradient(cx, cy, 0, cx, cy, R + L);
    cf.addColorStop(0, '#05010a');
    cf.addColorStop(0.75, '#14030c');
    cf.addColorStop(1, '#5a0c2c');
    g.fillStyle = cf;
    g.fill();
    g.lineWidth = Math.max(1, k * 0.012);
    g.strokeStyle = '#ff6a9a';
    g.stroke();
    g.restore();
    // spark
    const sx = cx + Math.cos(sa) * orbit, sy = cy + Math.sin(sa) * orbit;
    const sg = g.createRadialGradient(sx, sy, 0, sx, sy, k * 0.2);
    sg.addColorStop(0, 'rgba(255,255,255,1)');
    sg.addColorStop(0.18, 'rgba(255,220,235,0.95)');
    sg.addColorStop(0.45, 'rgba(255,90,150,0.35)');
    sg.addColorStop(1, 'rgba(255,60,120,0)');
    g.fillStyle = sg;
    g.beginPath();
    g.arc(sx, sy, k * 0.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(sx, sy, k * 0.045, 0, Math.PI * 2);
    g.fill();
    if (kind === 'splash') {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `700 ${Math.round(S * 0.11)}px system-ui, sans-serif`;
      g.fillStyle = '#fff';
      g.shadowColor = 'rgba(255,80,140,0.9)';
      g.shadowBlur = S * 0.04;
      g.fillText('LUMEN', cx, cy + k * 0.62);
    }
    return c.toDataURL('image/png');
  }, job);
  writeFileSync(join(pub, job.file), Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', job.file);
}
await browser.close();
