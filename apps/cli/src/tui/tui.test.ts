import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseCliArgs } from '../args.js';
import { listExamples } from './examples.js';
import { parseKey } from './keys.js';

describe('parseKey', () => {
  it.each([
    ['\u001b[B', 'down', false],
    ['\u001b[A', 'up', false],
    ['\u001bOB', 'down', false],
    ['\r', 'enter', false],
    ['\u001b', 'escape', false],
    ['\u007f', 'backspace', false],
    [' ', 'space', false],
    ['\u0003', 'c', true],
    ['\u0004', 'd', true],
    ['j', 'j', false],
  ])('reads %j as %s', (data, name, ctrl) => {
    expect(parseKey(data)).toEqual({ name, ctrl });
  });
});

describe('examples', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'logsy-tui-'));
    await writeFile(
      join(dir, 'acme-api-11111111-22222222.log'),
      [
        '##[group]Run npm ci',
        'npm ERR! code ERESOLVE',
        'npm ERR! ERESOLVE unable to resolve dependency tree',
        '##[error]Process completed with exit code 1.',
      ].join('\n'),
    );
    await writeFile(
      join(dir, 'acme-api-11111111-22222222.json'),
      JSON.stringify({ source: 'acme/api', jobName: 'build (20)' }),
    );
  });

  it('lists a log with the repository it came from', async () => {
    await expect(listExamples(dir)).resolves.toEqual([
      {
        file: join(dir, 'acme-api-11111111-22222222.log'),
        label: 'acme/api',
        detail: 'build (20)',
      },
    ]);
  });

  it('is empty rather than failing when the directory is missing', async () => {
    await expect(listExamples(join(dir, 'nope'))).resolves.toEqual([]);
  });
});

describe('command line', () => {
  it('opens the app only when a terminal is attached', () => {
    expect(parseCliArgs([], true)).toEqual({ kind: 'interactive' });
    expect(parseCliArgs([], false)).toEqual({ kind: 'help', noTerminal: true });
    expect(parseCliArgs(['interactive'], false)).toEqual({ kind: 'interactive' });
    // --json is for scripts, so a missing terminal is expected, not worth a warning.
    expect(parseCliArgs(['--json'], true)).toEqual({ kind: 'help', noTerminal: false });
  });
});
