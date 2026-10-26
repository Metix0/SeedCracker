import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };

/**
 * BASE_PATH is set by the GitHub Pages workflow ("/<repo>/"). Locally and for the
 * Capacitor (APK) build we use a relative base, which also works from any sub-folder.
 */
const base = process.env.BASE_PATH || './';

/** iPad launch screens (css w × h @2x), portrait + landscape. */
export const IPAD_SCREENS: [number, number][] = [
  [744, 1133], [810, 1080], [820, 1180], [834, 1194], [834, 1210], [1024, 1366], [1032, 1376],
];

function startupImages(): Plugin {
  return {
    name: 'lumen-startup-images',
    transformIndexHtml(html) {
      const tags = IPAD_SCREENS.flatMap(([w, h]) => [
        `<link rel="apple-touch-startup-image" media="screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" href="splash/splash-${w * 2}x${h * 2}.png" />`,
        `<link rel="apple-touch-startup-image" media="screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)" href="splash/splash-${h * 2}x${w * 2}.png" />`,
      ]);
      return html.replace('<!--STARTUP_IMAGES-->', tags.join('\n    '));
    },
  };
}

/** Generates dist/sw.js with a precache list of every emitted file and a content-hash version. */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'lumen-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    async closeBundle() {
      const { writeFileSync, readFileSync } = await import('node:fs');
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const f of readdirSync(dir)) {
          const p = join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      // launch screens are only fetched by iOS at install time — keep them out of the offline cache
      const list = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('splash/'));
      const hash = createHash('sha256');
      for (const f of list.sort()) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const src = readFileSync(join(process.cwd(), 'src/sw-template.js'), 'utf8')
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify(['./', ...list.map((f) => './' + f)], null, 0));
      writeFileSync(join(outDir, 'sw.js'), src);
      console.log(`\n[lumen-sw] precache ${list.length} files, version ${version}`);
    },
  };
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: ['es2022', 'safari15', 'chrome100'],
    assetsInlineLimit: 0,
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
  },
  server: { host: true },
  plugins: [startupImages(), serviceWorker()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
