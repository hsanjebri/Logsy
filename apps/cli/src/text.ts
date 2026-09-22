/** Measuring and wrapping text that contains colour codes and wide characters. */

// Colour codes and OSC 8 hyperlinks are invisible, so they must not count as width.
// eslint-disable-next-line no-control-regex -- matching escape sequences is the point
const ANSI = /\u001b\[[0-9;]*m|\u001b\]8;;[^\u0007]*\u0007/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/**
 * Columns a string occupies. Emoji and CJK take two, combining marks and the
 * variation selector take none; everything else counts as one.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const character of stripAnsi(text)) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0xfe0f || (code >= 0x0300 && code <= 0x036f)) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f680 && code <= 0x1f6ff) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x1fa70 && code <= 0x1faff)
  );
}

export function padTo(text: string, width: number): string {
  const missing = width - displayWidth(text);
  return missing > 0 ? text + ' '.repeat(missing) : text;
}

/** Cuts to `width` columns, ending with an ellipsis when something was removed. */
export function truncate(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let out = '';
  for (const character of stripAnsi(text)) {
    if (displayWidth(out + character) > width - 1) break;
    out += character;
  }
  return `${out}…`;
}

/**
 * Wraps on spaces, breaking a word only when it cannot fit on a line of its own.
 * Existing line breaks are kept: a log excerpt must not be reflowed.
 */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/).filter((part) => part !== '')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (displayWidth(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line !== '') lines.push(line);
      if (displayWidth(word) <= width) {
        line = word;
        continue;
      }
      // A path or a token longer than the whole line: cut it into chunks.
      let rest = word;
      while (displayWidth(rest) > width) {
        let chunk = '';
        for (const character of rest) {
          if (displayWidth(chunk + character) > width) break;
          chunk += character;
        }
        lines.push(chunk);
        rest = rest.slice(chunk.length);
      }
      line = rest;
    }
    if (line !== '') lines.push(line);
  }
  return lines;
}
