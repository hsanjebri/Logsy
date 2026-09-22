import { padTo, truncate } from '../text.js';
import type { Theme } from '../theme.js';

export interface MenuItem {
  label: string;
  /** Dim text after the label: a count, a job name, a reminder. */
  hint?: string;
  /** Shown instead of being selectable. */
  disabled?: boolean;
}

export interface MenuView {
  title: string;
  items: readonly MenuItem[];
  index: number;
  /** Most rows to show at once; the list scrolls inside that. */
  rows?: number;
  footer?: string;
}

/** The pointer line, the visible slice of a long list, and the key hints. */
export function renderMenu(view: MenuView, theme: Theme): string[] {
  const rows = Math.max(3, view.rows ?? 12);
  const { start, end } = windowFor(view.index, view.items.length, rows);
  const labelWidth = Math.min(38, Math.max(...view.items.map((item) => item.label.length), 10));

  const lines = [theme.bold(view.title), ''];
  if (start > 0) lines.push(theme.dim(`   ↑ ${String(start)} more`));

  for (let index = start; index < end; index += 1) {
    const item = view.items[index];
    if (!item) continue;
    const selected = index === view.index;
    const label = truncate(item.label, labelWidth);
    const hint = item.hint === undefined ? '' : theme.dim(`  ${item.hint}`);
    const line = `${padTo(label, labelWidth)}${hint}`;
    lines.push(
      item.disabled
        ? theme.dim(`   ${line}`)
        : selected
          ? `${theme.accent('❯')} ${theme.bold(line)}`
          : `  ${line}`,
    );
  }

  if (end < view.items.length) {
    lines.push(theme.dim(`   ↓ ${String(view.items.length - end)} more`));
  }
  lines.push('', theme.dim(view.footer ?? '↑↓ move   ↵ select   q quit'));
  return lines;
}

/** Keeps the selected row inside the visible slice, without jumping around. */
export function windowFor(
  index: number,
  total: number,
  rows: number,
): { start: number; end: number } {
  if (total <= rows) return { start: 0, end: total };
  const half = Math.floor(rows / 2);
  const start = Math.max(0, Math.min(index - half, total - rows));
  return { start, end: start + rows };
}

/** Wraps around at both ends, so the list never dead-ends. */
export function moveIndex(index: number, total: number, delta: number): number {
  if (total === 0) return 0;
  return (index + delta + total) % total;
}
