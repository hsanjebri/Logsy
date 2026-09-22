import { parseCommentMarkdown } from '@logsy/core';
import { analyzeLog } from '@logsy/llm';
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './args.js';
import { banner, gauge, panel, row } from './box.js';
import { renderMarkdown } from './markdown.js';
import { renderSummary } from './render.js';
import { startSpinner } from './spinner.js';
import { displayWidth, stripAnsi, truncate, wrap } from './text.js';
import { colorLevel, createTheme, type Theme } from './theme.js';

const plain: Theme = createTheme({ level: 'none', interactive: false, width: 80 });
const colored: Theme = createTheme({ level: 'truecolor', interactive: true, width: 80 });

describe('parseCliArgs', () => {
  it('shows help with no command, noting the menus needed a terminal', () => {
    expect(parseCliArgs([])).toEqual({ kind: 'help', noTerminal: true });
    expect(parseCliArgs(['analyze', '--help'])).toEqual({ kind: 'help' });
  });

  it('reads a file and defaults to using the LLM', () => {
    expect(parseCliArgs(['analyze', 'ci.log'])).toEqual({
      kind: 'analyze',
      file: 'ci.log',
      llm: true,
      llmOnly: false,
      json: false,
      jobName: 'build',
    });
  });

  it('understands the flags', () => {
    expect(parseCliArgs(['analyze', '-', '--no-llm', '--json', '--job', 'test'])).toMatchObject({
      file: '-',
      llm: false,
      json: true,
      jobName: 'test',
    });
    expect(parseCliArgs(['analyze', '--llm-only'])).toMatchObject({
      file: undefined,
      llmOnly: true,
    });
  });

  it('rejects what makes no sense', () => {
    expect(() => parseCliArgs(['explain'])).toThrow('unknown command');
    expect(() => parseCliArgs(['analyze', 'a.log', 'b.log'])).toThrow('single log file');
    expect(() => parseCliArgs(['analyze', '--no-llm', '--llm-only'])).toThrow('cannot be combined');
  });
});

describe('colorLevel', () => {
  it.each([
    ['NO_COLOR wins over everything', { NO_COLOR: '1', COLORTERM: 'truecolor' }, true, 'none'],
    ['a pipe gets no colour', { COLORTERM: 'truecolor' }, false, 'none'],
    ['FORCE_COLOR=3 works even in a pipe', { FORCE_COLOR: '3' }, false, 'truecolor'],
    ['modern terminals get 24-bit', { COLORTERM: 'truecolor', TERM: 'xterm' }, true, 'truecolor'],
    ['Windows Terminal gets 24-bit', { WT_SESSION: 'x' }, true, 'truecolor'],
    ['an old xterm gets 256', { TERM: 'xterm-256color' }, true, 'ansi256'],
    ['a dumb terminal gets none', { TERM: 'dumb' }, true, 'none'],
  ])('%s', (_label, env, tty, expected) => {
    expect(colorLevel(env, tty)).toBe(expected);
  });
});

describe('text measuring', () => {
  it('ignores colour codes and hyperlinks when measuring', () => {
    const link = colored.link('view run', 'https://example.com/runs/1');
    expect(stripAnsi(link)).toBe('view run');
    expect(displayWidth(link)).toBe(8);
    expect(displayWidth(colored.bold('abc'))).toBe(3);
  });

  it('counts an emoji as two columns', () => {
    expect(displayWidth('🧪 Test failure')).toBe(15);
    expect(displayWidth('ok')).toBe(2);
  });

  it('wraps on spaces and keeps existing line breaks', () => {
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(wrap('a\n\nb', 10)).toEqual(['a', '', 'b']);
  });

  it('breaks a word that cannot fit on its own line', () => {
    expect(wrap('/very/long/path/to/a/file.ts', 10)).toEqual([
      '/very/long',
      '/path/to/a',
      '/file.ts',
    ]);
  });

  it('truncates with an ellipsis', () => {
    expect(truncate('abcdefgh', 5)).toBe('abcd…');
    expect(truncate('abc', 5)).toBe('abc');
  });
});

describe('panels', () => {
  it('draws every line to the same width, colour or not', () => {
    const lines = panel(['short', '🧪 with an emoji', colored.bold('bold')], colored, {
      title: 'Analysis',
      note: 'ci.log',
    });
    expect(new Set(lines.map((line) => displayWidth(line)))).toEqual(new Set([80]));
  });

  it('wraps a line that is too long rather than breaking the frame', () => {
    const lines = panel(['x'.repeat(200)], plain);
    expect(new Set(lines.map((line) => displayWidth(line)))).toEqual(new Set([80]));
  });

  it('shows the gauge as filled blocks and a percentage', () => {
    expect(stripAnsi(gauge(0.9, plain))).toBe('▰▰▰▰▰▰▰▰▰▱ 90%');
    expect(stripAnsi(gauge(0, plain))).toBe('▱▱▱▱▱▱▱▱▱▱ 0%');
  });

  it('aligns row labels and shortens long values', () => {
    expect(row('Log', '12 chars', plain)).toBe('Log            12 chars');
    expect(displayWidth(row('Decided by', 'x'.repeat(200), plain))).toBe(76);
  });

  it('falls back to one line in a narrow terminal', () => {
    const narrow = createTheme({ level: 'none', interactive: false, width: 40 });
    expect(banner(narrow, 'tagline')).toEqual(['Logsy · tagline', '']);
    expect(banner(plain, 'tagline')).toHaveLength(4);
  });
});

describe('markdown for the terminal', () => {
  const comment = [
    '### Dependency conflict',
    '',
    'npm could not resolve the tree.',
    '',
    '<details>',
    '<summary>Evidence from the log</summary>',
    '',
    '```',
    'npm ERR! ERESOLVE',
    '```',
    '</details>',
    '',
    '**Likely files**',
    '',
    '- `package.json` — the conflicting range',
    '',
    '> Seen 3 times in this repository',
    '',
    '---',
    '',
    '<sub>[Logsy](https://github.com/hsanjebri/Logsy)</sub>',
  ].join('\n');

  it('renders each block in a readable shape', () => {
    const lines = renderMarkdown(parseCommentMarkdown(comment), plain, 60).map(stripAnsi);

    expect(lines).toContain('Dependency conflict');
    expect(lines).toContain('npm could not resolve the tree.');
    expect(lines).toContain('▾ Evidence from the log');
    expect(lines).toContain('  ▏ npm ERR! ERESOLVE');
    expect(lines).toContain('• package.json — the conflicting range');
    expect(lines).toContain('▏ Seen 3 times in this repository');
    expect(lines).toContain('─'.repeat(60));
    // Without colour a link cannot be clicked, so the address is spelled out.
    expect(lines.at(-1)).toBe('Logsy (https://github.com/hsanjebri/Logsy)');
  });

  it('never exceeds the width it is given', () => {
    const lines = renderMarkdown(parseCommentMarkdown(comment), colored, 40);
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(40);
  });
});

describe('the report', () => {
  const log = [
    '##[group]Run npm ci',
    'npm ci',
    'npm ERR! code ERESOLVE',
    'npm ERR! ERESOLVE unable to resolve dependency tree',
    '##[error]Process completed with exit code 1.',
  ].join('\n');

  it('summarizes what was found and how it was decided', async () => {
    const result = await analyzeLog(log);
    const text = renderSummary('ci.log', result, plain).map(stripAnsi).join('\n');

    expect(text).toContain('Analysis');
    expect(text).toContain('Dependency error');
    expect(text).toContain('90%');
    expect(text).toMatch(/Decided by +npm-eresolve · matched a rule, no model call/);
    expect(text).toContain('no secrets found');
  });

  it('says plainly when nothing could explain the failure', async () => {
    const result = await analyzeLog(
      '##[group]Run ./x\nodd\n##[error]Process completed with exit code 3.',
    );
    const text = renderSummary('x.log', result, plain).map(stripAnsi).join('\n');

    expect(text).toContain('Not sure enough to explain it');
    expect(text).toContain('no rule matched and no model is configured');
  });
});

describe('spinner', () => {
  it('prints one line and never animates when the output is not a terminal', () => {
    const written: string[] = [];
    const stream = {
      write: (text: string) => written.push(text),
    } as unknown as NodeJS.WritableStream;
    startSpinner('Analyzing', plain, stream).stop();
    expect(written).toEqual(['Analyzing\n']);
  });
});
