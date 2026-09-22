/**
 * `pnpm logsy …` — builds the CLI without printing anything, then runs it. Build
 * output appears only when the build fails, so the report is the first thing seen.
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const build = spawnSync(
  'pnpm',
  ['exec', 'turbo', 'run', 'build', '--filter=@logsy/cli...', '--output-logs=errors-only'],
  { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' },
);
if (build.status !== 0) {
  process.stderr.write(`${build.stdout ?? ''}${build.stderr ?? ''}`);
  process.exit(build.status ?? 1);
}

const cli = spawn(
  process.execPath,
  ['--env-file-if-exists=.env', 'apps/cli/dist/main.js', ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit' },
);
cli.on('exit', (code) => {
  process.exit(code ?? 0);
});
