import { displayWidth, stripAnsi } from '../text.js';

/**
 * A grid of styled cells. Everything the full-screen app draws goes through here, so
 * backgrounds, overlapping panels and animations are just writes to a buffer that is
 * painted once per frame.
 */

export interface Style {
  fg?: Rgb;
  bg?: Rgb;
  bold?: boolean;
  dim?: boolean;
}

export type Rgb = readonly [number, number, number];

interface Cell {
  ch: string;
  style: Style;
  /** A wide character owns the following cell, which renders as nothing. */
  skip?: boolean;
}

export class Canvas {
  readonly width: number;
  readonly height: number;
  private readonly cells: Cell[][];

  constructor(
    width: number,
    height: number,
    private readonly base: Style = {},
  ) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.cells = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => ({ ch: ' ', style: base })),
    );
  }

  /** Paints a rectangle, used for the background and for filled buttons. */
  fill(x: number, y: number, width: number, height: number, style: Style, ch = ' '): void {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        this.set(column, row, ch, style);
      }
    }
  }

  set(x: number, y: number, ch: string, style: Style = {}): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const row = this.cells[y];
    if (!row) return;
    row[x] = { ch, style: { ...this.base, ...style } };
  }

  /**
   * Writes text, clipped to `maxWidth` columns. Wide characters take two cells, so a
   * following cell is blanked to keep every row exactly `width` columns.
   */
  text(x: number, y: number, text: string, style: Style = {}, maxWidth?: number): number {
    const limit = maxWidth ?? this.width - x;
    let column = x;
    for (const character of stripAnsi(text)) {
      const size = displayWidth(character);
      if (size === 0) continue;
      if (column + size > x + limit) break;
      this.set(column, y, character, style);
      if (size === 2) {
        const row = this.cells[y];
        if (row && column + 1 < this.width) row[column + 1] = { ch: '', style, skip: true };
      }
      column += size;
    }
    return column - x;
  }

  /** Text centred inside a width, the way a button label sits in its shape. */
  centered(x: number, y: number, width: number, text: string, style: Style = {}): void {
    const offset = Math.max(0, Math.floor((width - displayWidth(text)) / 2));
    this.text(x + offset, y, text, style, width - offset);
  }

  /** A rounded box. The border is drawn, the inside is left alone unless filled. */
  box(
    x: number,
    y: number,
    width: number,
    height: number,
    options: { style?: Style; fill?: Style; title?: string; titleStyle?: Style } = {},
  ): void {
    const style = options.style ?? {};
    if (options.fill) this.fill(x, y, width, height, options.fill);

    const right = x + width - 1;
    const bottom = y + height - 1;
    this.set(x, y, '╭', style);
    this.set(right, y, '╮', style);
    this.set(x, bottom, '╰', style);
    this.set(right, bottom, '╯', style);
    for (let column = x + 1; column < right; column += 1) {
      this.set(column, y, '─', style);
      this.set(column, bottom, '─', style);
    }
    for (let row = y + 1; row < bottom; row += 1) {
      this.set(x, row, '│', style);
      this.set(right, row, '│', style);
    }
    if (options.title !== undefined && width > 6) {
      this.text(x + 2, y, ` ${options.title} `, options.titleStyle ?? style, width - 4);
    }
  }

  /** Pulls every colour towards one, which is how a view fades in. */
  fade(towards: Rgb, amount: number): void {
    if (amount <= 0) return;
    for (const row of this.cells) {
      for (const cell of row) {
        cell.style = {
          ...cell.style,
          ...(cell.style.fg ? { fg: mix(cell.style.fg, towards, amount) } : {}),
          ...(cell.style.bg ? { bg: mix(cell.style.bg, towards, amount) } : {}),
        };
      }
    }
  }

  /** Turns the grid into one string of escape sequences, ready to paint. */
  render(colour = true): string {
    const lines: string[] = [];
    for (const row of this.cells) {
      let line = '';
      let current: string | null = null;
      for (const cell of row) {
        if (cell.skip) continue;
        if (colour) {
          const code = escapeFor(cell.style);
          if (code !== current) {
            line += code === '' ? '\u001b[0m' : code;
            current = code;
          }
        }
        line += cell.ch;
      }
      lines.push(colour ? `${line}\u001b[0m` : line);
    }
    return lines.join('\n');
  }

  /** The plain text of the frame, which is what tests assert on. */
  toText(): string {
    return this.render(false);
  }
}

function escapeFor(style: Style): string {
  const parts: string[] = [];
  if (style.bold === true) parts.push('1');
  if (style.dim === true) parts.push('2');
  if (style.fg) parts.push(`38;2;${style.fg[0]};${style.fg[1]};${style.fg[2]}`);
  if (style.bg) parts.push(`48;2;${style.bg[0]};${style.bg[1]};${style.bg[2]}`);
  return parts.length === 0 ? '' : `\u001b[0m\u001b[${parts.join(';')}m`;
}

/** Mixes two colours, for gradients and for fading a row in. */
export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}
