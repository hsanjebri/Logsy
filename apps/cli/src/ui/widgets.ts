import { displayWidth } from '../text.js';
import { mix, type Canvas, type Rgb, type Style } from './canvas.js';
import { FAINT, PALETTE } from './palette.js';

/** The pieces the views are built from: background, header, buttons, bars, lists. */

/**
 * The page background: a flat fill plus a faint dot texture, which stops a dark
 * terminal from looking like an empty prompt.
 */
export function background(canvas: Canvas): void {
  canvas.fill(0, 0, canvas.width, canvas.height, { bg: PALETTE.canvas });
  for (let y = 0; y < canvas.height; y += 2) {
    for (let x = (y / 2) % 4 === 0 ? 0 : 2; x < canvas.width; x += 4) {
      canvas.set(x, y, '·', {
        fg: mix(PALETTE.canvas, PALETTE.hairline, 0.65),
        bg: PALETTE.canvas,
      });
    }
  }
}

export interface HeaderOptions {
  subtitle: string;
  /** 0 to 1: how much of the wordmark has swept in. */
  reveal?: number;
  right?: string;
}

/** The mark, the wordmark and a gradient rule under them. */
export function header(canvas: Canvas, options: HeaderOptions): void {
  const reveal = options.reveal ?? 1;
  const badgeStyle = { fg: PALETTE.canvas, bg: PALETTE.accent, bold: true };
  // The header sits on clean background: the dot texture behind letters reads as noise.
  canvas.fill(0, 0, canvas.width, 5, { bg: PALETTE.canvas });

  canvas.fill(2, 1, 5, 3, { bg: PALETTE.accent });
  canvas.centered(2, 2, 5, 'L', badgeStyle);

  const word = 'LOGSY';
  const shown = Math.max(0, Math.round(word.length * reveal));
  for (let index = 0; index < shown; index += 1) {
    canvas.text(9 + index, 2, word[index] ?? '', {
      fg: mix(PALETTE.accent, PALETTE.ink, index / Math.max(1, word.length - 1)),
      bg: PALETTE.canvas,
      bold: true,
    });
  }

  const chipWidth = options.right === undefined ? 0 : displayWidth(options.right) + 3;
  if (options.right !== undefined) {
    canvas.text(canvas.width - chipWidth, 2, options.right, {
      fg: PALETTE.muted,
      bg: PALETTE.canvas,
    });
  }
  if (reveal >= 1) {
    const subtitleX = 9 + word.length + 2;
    const room = canvas.width - chipWidth - subtitleX - 2;
    if (room > 12) canvas.text(subtitleX, 2, options.subtitle, FAINT, room);
  }

  // A rule that fades from the accent into the background, drawn to the reveal point.
  const ruleWidth = Math.round((canvas.width - 4) * Math.min(1, reveal * 1.4));
  for (let x = 0; x < ruleWidth; x += 1) {
    canvas.set(2 + x, 4, '─', {
      fg: mix(PALETTE.accent, PALETTE.canvas, x / Math.max(1, canvas.width - 4)),
      bg: PALETTE.canvas,
    });
  }
}

export interface ButtonSpec {
  label: string;
  hint?: string;
  icon?: string;
  disabled?: boolean;
}

/**
 * A button shape. Focused it fills with the accent and carries a marker; otherwise it
 * is an outline on the surface. Returns the width it occupied.
 */
export function button(
  canvas: Canvas,
  x: number,
  y: number,
  spec: ButtonSpec,
  state: { focused: boolean; pulse?: number },
): number {
  const label = `${spec.icon === undefined ? '' : `${spec.icon} `}${spec.label}`;
  const width = displayWidth(label) + 6;
  const focused = state.focused && spec.disabled !== true;
  const pulse = state.pulse ?? 0;

  const fill = focused
    ? mix(PALETTE.accentDeep, PALETTE.accent, 0.5 + Math.sin(pulse) * 0.5)
    : PALETTE.surface;
  const text = spec.disabled === true ? PALETTE.faint : focused ? PALETTE.canvas : PALETTE.ink;
  const border = focused ? fill : PALETTE.hairline;

  canvas.box(x, y, width, 3, { style: { fg: border, bg: PALETTE.canvas }, fill: { bg: fill } });
  canvas.centered(x + 1, y + 1, width - 2, focused ? `▸ ${label}` : label, {
    fg: text,
    bg: fill,
    bold: focused,
  });
  return width;
}

/** A row of buttons, laid out left to right, wrapping is the caller's problem. */
export function buttonRow(
  canvas: Canvas,
  x: number,
  y: number,
  specs: readonly ButtonSpec[],
  focusedIndex: number,
  pulse: number,
): void {
  let cursor = x;
  specs.forEach((spec, index) => {
    cursor += button(canvas, cursor, y, spec, { focused: index === focusedIndex, pulse }) + 2;
  });
}

/** A pill: the category badge, the model chip, a status. */
export function pill(canvas: Canvas, x: number, y: number, text: string, colour: Rgb): number {
  const width = displayWidth(text) + 2;
  canvas.fill(x, y, width, 1, { bg: colour });
  canvas.centered(x, y, width, text, { fg: PALETTE.canvas, bg: colour, bold: true });
  return width;
}

/** A filled bar for confidence, in the tone the value deserves. */
export function gaugeBar(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  value: number,
  colour: Rgb,
): void {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * width);
  for (let index = 0; index < width; index += 1) {
    canvas.set(x + index, y, index < filled ? '▰' : '▱', {
      fg: index < filled ? colour : PALETTE.hairline,
      bg: PALETTE.canvas,
    });
  }
}

/** The shimmering bar shown while the models think; `phase` advances each frame. */
export function shimmerBar(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  phase: number,
): void {
  for (let index = 0; index < width; index += 1) {
    const wave = (Math.sin((index - phase * 3) / 3) + 1) / 2;
    canvas.set(x + index, y, '━', {
      fg: mix(PALETTE.hairline, PALETTE.accent, wave),
      bg: PALETTE.canvas,
    });
  }
}

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export function spinnerFrame(tick: number): string {
  return SPINNER[tick % SPINNER.length] ?? '⠋';
}

export interface ListRow {
  label: string;
  hint?: string;
}

/** A selectable list inside a panel, with a marker and a scrollbar. */
export function list(
  canvas: Canvas,
  area: { x: number; y: number; width: number; height: number },
  rows: readonly ListRow[],
  selected: number,
): void {
  const visible = Math.max(1, area.height);
  const start = Math.max(0, Math.min(selected - Math.floor(visible / 2), rows.length - visible));
  const end = Math.min(rows.length, Math.max(visible, start + visible));

  for (let index = start; index < end; index += 1) {
    const row = rows[index];
    if (!row) continue;
    const y = area.y + (index - start);
    const focused = index === selected;
    const style: Style = focused
      ? { bg: PALETTE.raised, fg: PALETTE.ink, bold: true }
      : { bg: PALETTE.surface, fg: PALETTE.muted };

    canvas.fill(area.x, y, area.width, 1, style);
    canvas.text(area.x + 1, y, focused ? '▸' : ' ', { ...style, fg: PALETTE.accent });
    canvas.text(area.x + 3, y, row.label, style, area.width - 4);
    if (row.hint !== undefined) {
      const hintX = area.x + area.width - displayWidth(row.hint) - 2;
      if (hintX > area.x + displayWidth(row.label) + 4) {
        canvas.text(hintX, y, row.hint, { ...style, fg: PALETTE.faint, bold: false });
      }
    }
  }

  if (rows.length > visible) {
    const thumb = Math.round((selected / Math.max(1, rows.length - 1)) * (visible - 1));
    for (let index = 0; index < visible; index += 1) {
      canvas.set(area.x + area.width - 1, area.y + index, index === thumb ? '█' : '│', {
        fg: index === thumb ? PALETTE.accent : PALETTE.hairline,
        bg: PALETTE.surface,
      });
    }
  }
}

/** The key hints along the bottom, drawn as little chips. */
export function keyBar(canvas: Canvas, y: number, keys: readonly [string, string][]): void {
  let x = 2;
  for (const [key, label] of keys) {
    const keyWidth = displayWidth(key) + 2;
    canvas.fill(x, y, keyWidth, 1, { bg: PALETTE.raised });
    canvas.centered(x, y, keyWidth, key, { fg: PALETTE.ink, bg: PALETTE.raised, bold: true });
    x += keyWidth + 1;
    canvas.text(x, y, label, FAINT);
    x += displayWidth(label) + 3;
  }
}
