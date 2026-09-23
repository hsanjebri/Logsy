import type { Rgb, Style } from './canvas.js';

/** The app's colours: the dashboard's dark theme, tuned for a terminal. */
export const PALETTE = {
  canvas: [10, 10, 12] as Rgb,
  surface: [19, 19, 23] as Rgb,
  raised: [30, 30, 36] as Rgb,
  hairline: [44, 44, 52] as Rgb,
  ink: [250, 250, 250] as Rgb,
  muted: [161, 162, 169] as Rgb,
  faint: [92, 94, 102] as Rgb,
  accent: [124, 156, 255] as Rgb,
  accentDeep: [78, 104, 205] as Rgb,
  success: [74, 222, 128] as Rgb,
  warning: [240, 180, 41] as Rgb,
  danger: [248, 113, 113] as Rgb,
} as const;

export const BASE: Style = { fg: PALETTE.ink, bg: PALETTE.canvas };
export const MUTED: Style = { fg: PALETTE.muted, bg: PALETTE.canvas };
export const FAINT: Style = { fg: PALETTE.faint, bg: PALETTE.canvas };

/** On a surface panel rather than the page background. */
export function onSurface(style: Style = {}): Style {
  return { bg: PALETTE.surface, fg: PALETTE.ink, ...style };
}
