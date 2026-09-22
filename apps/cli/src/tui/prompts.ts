import type { Theme } from '../theme.js';
import { moveIndex, renderMenu, type MenuItem } from './menu.js';
import type { Terminal } from './terminal.js';

/** Draws a block, then erases exactly what it drew before the next one. */
export class Frame {
  private drawn = 0;

  constructor(private readonly terminal: Terminal) {}

  show(lines: readonly string[]): void {
    this.clear();
    this.terminal.write(`${lines.join('\n')}\n`);
    this.drawn = lines.length;
  }

  clear(): void {
    this.terminal.eraseLines(this.drawn);
    this.drawn = 0;
  }
}

export interface MenuPrompt {
  title: string;
  items: readonly MenuItem[];
  footer?: string;
  rows?: number;
  /** Keys that close the menu and are returned to the caller, such as 'q' or 'm'. */
  shortcuts?: readonly string[];
}

export type MenuAnswer =
  { kind: 'selected'; index: number } | { kind: 'cancelled' } | { kind: 'shortcut'; key: string };

export async function askMenu(
  terminal: Terminal,
  theme: Theme,
  prompt: MenuPrompt,
): Promise<MenuAnswer> {
  const frame = new Frame(terminal);
  let index = prompt.items.findIndex((item) => item.disabled !== true);
  if (index < 0) index = 0;

  for (;;) {
    frame.show(
      renderMenu(
        {
          title: prompt.title,
          items: prompt.items,
          index,
          ...(prompt.rows === undefined ? {} : { rows: prompt.rows }),
          ...(prompt.footer === undefined ? {} : { footer: prompt.footer }),
        },
        theme,
      ),
    );

    const key = await terminal.readKey();
    if ((key.name === 'c' && key.ctrl) || key.name === 'q' || key.name === 'escape') {
      frame.clear();
      return { kind: 'cancelled' };
    }
    if (key.name === 'up' || key.name === 'k') index = skip(prompt.items, index, -1);
    else if (key.name === 'down' || key.name === 'j') index = skip(prompt.items, index, 1);
    else if (key.name === 'enter') {
      if (prompt.items[index]?.disabled === true) continue;
      frame.clear();
      return { kind: 'selected', index };
    } else if (prompt.shortcuts?.includes(key.name) === true && !key.ctrl) {
      frame.clear();
      return { kind: 'shortcut', key: key.name };
    }
  }
}

/** Moves past disabled rows so the pointer never rests on one. */
function skip(items: readonly MenuItem[], from: number, delta: number): number {
  let index = from;
  for (const _unused of items) {
    index = moveIndex(index, items.length, delta);
    if (items[index]?.disabled !== true) return index;
  }
  return from;
}

export async function askText(
  terminal: Terminal,
  theme: Theme,
  prompt: { title: string; hint?: string },
): Promise<string | null> {
  const frame = new Frame(terminal);
  let value = '';

  for (;;) {
    frame.show([
      theme.bold(prompt.title),
      '',
      `${theme.accent('❯')} ${value}${theme.dim('▏')}`,
      '',
      theme.dim(prompt.hint ?? '↵ confirm   esc cancel'),
    ]);

    const key = await terminal.readKey();
    if ((key.name === 'c' && key.ctrl) || key.name === 'escape') {
      frame.clear();
      return null;
    }
    if (key.name === 'enter') {
      frame.clear();
      return value.trim();
    }
    if (key.name === 'backspace') value = value.slice(0, -1);
    else if (key.name === 'space') value += ' ';
    else if (!key.ctrl && key.name.length === 1) value += key.name;
  }
}

/**
 * Collects a pasted log. Raw mode delivers a paste as ordinary keystrokes, so the
 * end is marked by Ctrl+D rather than by a blank line a log could contain.
 */
export async function askPaste(terminal: Terminal, theme: Theme): Promise<string | null> {
  const frame = new Frame(terminal);
  let text = '';
  const draw = () => {
    frame.show([
      theme.bold('Paste the log, then press Ctrl+D'),
      '',
      theme.dim(`${text.length.toLocaleString('en-US')} characters received`),
      '',
      theme.dim('ctrl+d analyze   esc cancel'),
    ]);
  };

  draw();
  for (;;) {
    const key = await terminal.readKey();
    if ((key.name === 'c' && key.ctrl) || key.name === 'escape') {
      frame.clear();
      return null;
    }
    if (key.name === 'd' && key.ctrl) {
      frame.clear();
      return text.trim() === '' ? null : text;
    }
    if (key.name === 'enter') text += '\n';
    else if (key.name === 'space') text += ' ';
    else if (key.name === 'tab') text += '\t';
    else if (key.name === 'backspace') text = text.slice(0, -1);
    else if (!key.ctrl) text += key.name;
    draw();
  }
}
