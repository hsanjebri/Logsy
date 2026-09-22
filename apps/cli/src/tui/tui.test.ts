import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseCliArgs } from '../args.js';
import { stripAnsi } from '../text.js';
import { createTheme } from '../theme.js';
import { runInteractive } from './app.js';
import { listExamples } from './examples.js';
import { parseKey } from './keys.js';
import { moveIndex, renderMenu, windowFor } from './menu.js';
import { askMenu, askText } from './prompts.js';
import type { Terminal } from './terminal.js';

const theme = createTheme({ level: 'none', interactive: false, width: 80 });

/** A terminal that replays keystrokes and remembers what was drawn. */
function scripted(keys: readonly string[]) {
  const written: string[] = [];
  let next = 0;
  const terminal: Terminal = {
    columns: 80,
    write: (text) => written.push(text),
    eraseLines: () => undefined,
    // Out of keys means the person pressed Ctrl+C: every prompt must end.
    readKey: () => Promise.resolve(parseKey(keys[next++] ?? '\u0003')),
  };
  return { terminal, text: () => stripAnsi(written.join('')) };
}

const DOWN = '\u001b[B';
const UP = '\u001b[A';
const ENTER = '\r';

describe('parseKey', () => {
  it.each([
    [DOWN, 'down', false],
    [UP, 'up', false],
    ['\u001bOB', 'down', false],
    [ENTER, 'enter', false],
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

describe('menu geometry', () => {
  it('wraps around at both ends', () => {
    expect(moveIndex(0, 3, -1)).toBe(2);
    expect(moveIndex(2, 3, 1)).toBe(0);
    expect(moveIndex(0, 0, 1)).toBe(0);
  });

  it('scrolls a long list around the selection', () => {
    expect(windowFor(0, 20, 5)).toEqual({ start: 0, end: 5 });
    expect(windowFor(10, 20, 5)).toEqual({ start: 8, end: 13 });
    expect(windowFor(19, 20, 5)).toEqual({ start: 15, end: 20 });
    expect(windowFor(1, 3, 5)).toEqual({ start: 0, end: 3 });
  });

  it('marks the selection and counts what is off screen', () => {
    const lines = renderMenu(
      {
        title: 'Example failures',
        items: Array.from({ length: 8 }, (_unused, index) => ({ label: `log ${String(index)}` })),
        index: 7,
        rows: 3,
      },
      theme,
    ).map(stripAnsi);

    expect(lines[0]).toBe('Example failures');
    expect(lines).toContain('   ↑ 5 more');
    expect(lines.some((line) => line.startsWith('❯ log 7'))).toBe(true);
    expect(lines.at(-1)).toBe('↑↓ move   ↵ select   q quit');
  });
});

describe('prompts', () => {
  it('returns the row the arrows landed on', async () => {
    const { terminal } = scripted([DOWN, DOWN, UP, ENTER]);
    const answer = await askMenu(terminal, theme, {
      title: 'Pick',
      items: [{ label: 'one' }, { label: 'two' }, { label: 'three' }],
    });
    expect(answer).toEqual({ kind: 'selected', index: 1 });
  });

  it('never lands on a disabled row', async () => {
    const { terminal } = scripted([DOWN, ENTER]);
    const answer = await askMenu(terminal, theme, {
      title: 'Pick',
      items: [{ label: 'one' }, { label: 'unavailable', disabled: true }, { label: 'three' }],
    });
    expect(answer).toEqual({ kind: 'selected', index: 2 });
  });

  it('cancels on q, escape and Ctrl+C', async () => {
    for (const key of ['q', '\u001b', '\u0003']) {
      const { terminal } = scripted([key]);
      await expect(
        askMenu(terminal, theme, { title: 'Pick', items: [{ label: 'one' }] }),
      ).resolves.toEqual({ kind: 'cancelled' });
    }
  });

  it('collects typed text, with backspace', async () => {
    const { terminal } = scripted(['c', 'i', 'x', '\u007f', '.', 'l', 'o', 'g', ENTER]);
    await expect(askText(terminal, theme, { title: 'Path' })).resolves.toBe('ci.log');
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

  it('walks from the menu to a report and out again', async () => {
    // Examples → the first one → Quit at "What next?".
    const { terminal, text } = scripted([ENTER, ENTER, DOWN, DOWN, ENTER]);
    await runInteractive({
      terminal,
      theme,
      examplesDir: dir,
      llm: undefined,
      llmNote: 'no model configured',
    });

    const output = text();
    expect(output).toContain('What do you want to analyze?');
    expect(output).toContain('acme/api');
    expect(output).toContain('Analysis');
    expect(output).toContain('Dependency error');
    expect(output).toContain('What next?');
  });

  it('quits from the first menu without analyzing anything', async () => {
    const { terminal, text } = scripted(['q']);
    await runInteractive({
      terminal,
      theme,
      examplesDir: dir,
      llm: undefined,
      llmNote: 'no model configured',
    });
    expect(text()).not.toContain('Analysis');
  });
});

describe('command line', () => {
  it('opens the menus only when a terminal is attached', () => {
    expect(parseCliArgs([], true)).toEqual({ kind: 'interactive' });
    expect(parseCliArgs([], false)).toEqual({ kind: 'help' });
    expect(parseCliArgs(['interactive'], false)).toEqual({ kind: 'interactive' });
    expect(parseCliArgs(['--json'], true)).toEqual({ kind: 'help' });
  });
});
