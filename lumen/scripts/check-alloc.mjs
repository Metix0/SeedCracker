// Builds scripts/alloc/harness.ts with the production bundler settings and checks that a
// steady-state game frame (simulation + scene emission) allocates (almost) nothing.
//   node scripts/check-alloc.mjs
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(join(tmpdir(), 'lumen-alloc-'));
execSync(`npx vite build --ssr scripts/alloc/harness.ts --outDir ${out} --emptyOutDir --logLevel error`, { stdio: 'inherit' });
const { measure } = await import(pathToFileURL(join(out, 'harness.js')).href);
const r = await measure();
console.log(`sprites/frame ${r.instances}, obstacles ${r.obstacles}, allocated ${r.perFrame.toFixed(1)} B/frame`);
console.log(r.top.join('\n'));
const LIMIT = 64; // bytes per frame (V8 bookkeeping noise); a real per-entity allocation is KBs
if (r.perFrame > LIMIT) {
  console.error(`FAIL: game loop allocates ${r.perFrame.toFixed(0)} B/frame (limit ${LIMIT})`);
  process.exit(1);
}
console.log('alloc check: OK');
