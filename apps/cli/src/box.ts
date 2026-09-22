import { displayWidth, padTo, truncate, wrap } from './text.js';
import type { Theme, Tone } from './theme.js';

/** Rounded panels, a gauge and the wordmark: the CLI's visual vocabulary. */

const EDGE = { topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯', h: '─', v: '│' };

export interface PanelOptions {
  title?: string;
  /** Shown at the right end of the top edge. */
  note?: string;
  tone?: Tone;
}

export function panel(body: readonly string[], theme: Theme, options: PanelOptions = {}): string[] {
  const inner = theme.width - 4;
  const edge = tonePaint(theme, options.tone ?? 'neutral');

  const title = options.title === undefined ? '' : ` ${theme.bold(options.title)} `;
  const note = options.note === undefined ? '' : ` ${theme.dim(options.note)} `;
  const used = displayWidth(title) + displayWidth(note);
  const fill = Math.max(0, inner + 2 - used);
  const left = Math.floor(fill / 2) > 0 ? EDGE.h : '';

  const top = edge(
    `${EDGE.topLeft}${left}${title}${edge(EDGE.h.repeat(Math.max(0, fill - displayWidth(left))))}${note}${EDGE.topRight}`,
  );
  const bottom = edge(`${EDGE.bottomLeft}${EDGE.h.repeat(inner + 2)}${EDGE.bottomRight}`);

  const lines = body.flatMap((line) => (displayWidth(line) <= inner ? [line] : wrap(line, inner)));
  return [
    top,
    ...lines.map((line) => `${edge(EDGE.v)} ${padTo(line, inner)} ${edge(EDGE.v)}`),
    bottom,
  ];
}

function tonePaint(theme: Theme, tone: Tone) {
  if (tone === 'success') return theme.success;
  if (tone === 'warning') return theme.warning;
  if (tone === 'danger') return theme.danger;
  if (tone === 'accent') return theme.accent;
  return theme.dim;
}

/** A label/value row, with labels aligned in a dim column. */
export function row(label: string, value: string, theme: Theme, labelWidth = 14): string {
  const gap = theme.width - 4 - labelWidth - 1;
  return `${theme.dim(padTo(label, labelWidth))} ${truncate(value, Math.max(10, gap))}`;
}

/** A gauge for confidence: filled blocks, then the number. */
export function gauge(value: number, theme: Theme, width = 10): string {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * width);
  const paint = value >= 0.5 ? theme.success : theme.warning;
  return `${paint('▰'.repeat(filled))}${theme.dim('▱'.repeat(width - filled))} ${String(Math.round(value * 100))}%`;
}

/**
 * The banner: the same square mark the desktop app shows, with the wordmark beside
 * it. Narrow terminals get a single line instead.
 */
export function banner(theme: Theme, subtitle: string): string[] {
  if (theme.width < 52) return [`${theme.bold('Logsy')} ${theme.dim(`· ${subtitle}`)}`, ''];
  return [
    theme.dim('╭───╮'),
    `${theme.dim('│')} ${theme.bold(theme.accent('L'))} ${theme.dim('│')}  ${theme.bold('Logsy')}`,
    `${theme.dim('╰───╯')}  ${theme.dim(subtitle)}`,
    '',
  ];
}
