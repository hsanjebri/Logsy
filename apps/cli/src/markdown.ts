import type { MarkdownBlock, MarkdownInline } from '@logsy/core';
import { displayWidth, wrap } from './text.js';
import type { Theme } from './theme.js';

/**
 * Renders the parsed comment for a terminal: the same tree the dashboard and the
 * desktop app draw, so all three show the reader the same thing.
 */
export function renderMarkdown(
  blocks: readonly MarkdownBlock[],
  theme: Theme,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (lines.length > 0) lines.push('');
    lines.push(...renderBlock(block, theme, width));
  }
  return lines;
}

function renderBlock(block: MarkdownBlock, theme: Theme, width: number): string[] {
  switch (block.type) {
    case 'heading':
      return [theme.bold(inline(block.children, theme))];

    case 'paragraph':
      return block.lines.flatMap((line) => wrap(inline(line, theme), width));

    case 'code':
      // A left bar instead of a box: log lines are wide and must not be reflowed.
      return block.text
        .split('\n')
        .map((line) => `${theme.dim('▏')} ${theme.dim(clip(line, width - 2))}`);

    case 'list':
      return block.items.flatMap((item) =>
        hang(`${theme.accent('•')} `, inline(item, theme), theme, width),
      );

    case 'quote':
      return block.lines.map((line) => `${theme.dim('▏')} ${theme.dim(inline(line, theme))}`);

    case 'details': {
      const summary = `${theme.dim('▾')} ${theme.bold(inline(block.summary, theme))}`;
      const body = renderMarkdown(block.children, theme, width - 2);
      return [summary, ...body.map((line) => `  ${line}`)];
    }

    case 'rule':
      return [theme.dim('─'.repeat(width))];

    case 'small':
      return wrap(inline(block.children, theme), width).map((line) => theme.dim(line));
  }
}

/** Keeps a bullet's continuation lines aligned under its text. */
function hang(marker: string, text: string, _theme: Theme, width: number): string[] {
  const indent = ' '.repeat(displayWidth(marker));
  const [first, ...rest] = wrap(text, width - displayWidth(marker));
  return [`${marker}${first ?? ''}`, ...rest.map((line) => `${indent}${line}`)];
}

function clip(text: string, width: number): string {
  return displayWidth(text) <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function inline(nodes: readonly MarkdownInline[], theme: Theme): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.text;
        case 'code':
          return theme.accent(node.text);
        case 'strong':
          return theme.bold(inline(node.children, theme));
        case 'em':
          return theme.dim(inline(node.children, theme));
        case 'link':
          return theme.link(inline(node.children, theme), node.href);
      }
    })
    .join('');
}
