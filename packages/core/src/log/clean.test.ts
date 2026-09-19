import { describe, expect, it } from 'vitest';
import { cleanLog, normalizeNewlines, stripAnsi, stripTimestamps } from './clean.js';

const ESC = '';

describe('stripAnsi', () => {
  it('removes colour codes but keeps the text', () => {
    expect(stripAnsi(`${ESC}[36;1mnpm test${ESC}[0m`)).toBe('npm test');
    expect(stripAnsi(`${ESC}[32m.${ESC}[0m${ESC}[31mF${ESC}[0m`)).toBe('.F');
  });

  it('removes cursor movement and hyperlinks', () => {
    expect(stripAnsi(`${ESC}[2K${ESC}[1Gprogress`)).toBe('progress');
    expect(stripAnsi(`${ESC}]8;;https://example.comlink${ESC}]8;;`)).toBe('link');
  });

  it('leaves plain text untouched', () => {
    expect(stripAnsi('##[error]Process completed with exit code 1.')).toBe(
      '##[error]Process completed with exit code 1.',
    );
  });
});

describe('stripTimestamps', () => {
  it('removes the ISO prefix GitHub adds to every line', () => {
    const log = ['2026-09-19T13:37:11.4365403Z first', '2026-09-19T13:37:11.5180468Z second'].join(
      '\n',
    );
    expect(stripTimestamps(log)).toBe('first\nsecond');
  });

  it('keeps timestamps that appear inside a line', () => {
    expect(stripTimestamps('2026-09-19T13:37:11.4365403Z built at 2026-09-19T13:00:00.000Z')).toBe(
      'built at 2026-09-19T13:00:00.000Z',
    );
  });
});

describe('cleanLog', () => {
  it('normalizes newlines, escapes, timestamps and trailing spaces', () => {
    const raw = `2026-09-19T13:37:11.4365403Z ${ESC}[36;1mnpm test${ESC}[0m   \r\n2026-09-19T13:37:12.0000000Z done\r`;
    expect(cleanLog(raw)).toBe('npm test\ndone\n');
  });

  it('preserves the line count so line numbers stay valid', () => {
    const raw = Array.from(
      { length: 5 },
      (_, i) => `2026-09-19T13:37:1${i}.0000000Z line ${i}`,
    ).join('\n');
    expect(cleanLog(raw).split('\n')).toHaveLength(5);
  });
});

describe('normalizeNewlines', () => {
  it('turns carriage returns from progress bars into line breaks', () => {
    expect(normalizeNewlines('a\r\nb\rc')).toBe('a\nb\nc');
  });
});
