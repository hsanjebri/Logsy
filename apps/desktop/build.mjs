/** Bundles the Electron main process, the preload bridge and the window. */
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
};

// The main process keeps its dependencies external: they are installed beside it.
await build({
  ...shared,
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist/main/main.mjs',
  format: 'esm',
  packages: 'external',
});

// Development-only entry that drives the app for the smoke check.
await build({
  ...shared,
  entryPoints: ['src/main/smoke.ts'],
  outfile: 'dist/main/smoke.mjs',
  format: 'esm',
  packages: 'external',
});

// A sandboxed preload must be CommonJS and cannot import anything at runtime.
await build({
  ...shared,
  entryPoints: ['src/main/preload.ts'],
  outfile: 'dist/main/preload.cjs',
  format: 'cjs',
  external: ['electron'],
});

// The window is a browser: React and the shared components are bundled in.
await build({
  bundle: true,
  entryPoints: ['src/renderer/main.tsx'],
  outfile: 'dist/renderer/app.js',
  format: 'esm',
  platform: 'browser',
  target: 'chrome130',
  jsx: 'automatic',
  minify: true,
  sourcemap: true,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
});

await mkdir('dist/renderer', { recursive: true });
await cp('src/renderer/index.html', 'dist/renderer/index.html');
await promisify(execFile)(
  process.execPath,
  [
    './node_modules/@tailwindcss/cli/dist/index.mjs',
    '-i',
    'src/renderer/styles.css',
    '-o',
    'dist/renderer/styles.css',
    '--minify',
  ],
  { cwd: process.cwd() },
);
process.stdout.write(`desktop build complete\n`);
