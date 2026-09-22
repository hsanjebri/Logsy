/**
 * Parses the Markdown subset Logsy's comments use into a tree, so a page can render
 * the comment as GitHub would without an HTML string. Text is only ever text: model
 * output that looks like HTML stays inert, and links other than http(s) are dropped.
 */

export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'link'; href: string; children: MarkdownInline[] };

export type MarkdownBlock =
  | { type: 'heading'; children: MarkdownInline[] }
  /** One entry per source line: GitHub comments keep single line breaks. */
  | { type: 'paragraph'; lines: MarkdownInline[][] }
  | { type: 'code'; language: string | null; text: string }
  | { type: 'list'; items: MarkdownInline[][] }
  | { type: 'quote'; lines: MarkdownInline[][] }
  | { type: 'details'; summary: MarkdownInline[]; children: MarkdownBlock[] }
  | { type: 'rule' }
  | { type: 'small'; children: MarkdownInline[] };

const FENCE = /^```\s*([\w+-]+)?\s*$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const SMALL = /^<sub>(.*)<\/sub>$/;
const SUMMARY = /^<summary>(.*)<\/summary>$/;

export function parseCommentMarkdown(markdown: string): MarkdownBlock[] {
  return parseBlocks(markdown.replace(/\r\n/g, '\n').split('\n'));
}

function parseBlocks(lines: readonly string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('<!--')) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(trimmed);
    if (fence) {
      const end = findFenceEnd(lines, index + 1);
      blocks.push({
        type: 'code',
        language: fence[1] ?? null,
        text: lines.slice(index + 1, end).join('\n'),
      });
      index = end + 1;
      continue;
    }

    if (trimmed === '<details>') {
      const end = findDetailsEnd(lines, index + 1);
      let bodyStart = index + 1;
      const summary = SUMMARY.exec((lines[bodyStart] ?? '').trim());
      if (summary) bodyStart += 1;
      blocks.push({
        type: 'details',
        summary: parseInline(summary?.[1] ?? 'Details'),
        children: parseBlocks(lines.slice(bodyStart, end)),
      });
      index = end + 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      blocks.push({ type: 'heading', children: parseInline(heading[1] ?? '') });
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    const small = SMALL.exec(trimmed);
    if (small) {
      blocks.push({ type: 'small', children: parseInline(small[1] ?? '') });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: MarkdownInline[][] = [];
      while (index < lines.length && /^[-*]\s+/.test((lines[index] ?? '').trim())) {
        items.push(parseInline((lines[index] ?? '').trim().replace(/^[-*]\s+/, '')));
        index += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoted: MarkdownInline[][] = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        quoted.push(parseInline((lines[index] ?? '').trim().replace(/^>\s?/, '')));
        index += 1;
      }
      blocks.push({ type: 'quote', lines: quoted });
      continue;
    }

    const paragraph: MarkdownInline[][] = [];
    while (index < lines.length && isParagraphLine(lines[index] ?? '')) {
      paragraph.push(parseInline((lines[index] ?? '').trim()));
      index += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraph });
  }

  return blocks;
}

/** A line that continues a paragraph rather than starting another block. */
function isParagraphLine(line: string): boolean {
  const trimmed = line.trim();
  return !(
    trimmed === '' ||
    FENCE.test(trimmed) ||
    trimmed === '<details>' ||
    HEADING.test(trimmed) ||
    /^(-{3,}|\*{3,})$/.test(trimmed) ||
    SMALL.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    trimmed.startsWith('>')
  );
}

/** Index of the closing fence, or the end of input when it is missing. */
function findFenceEnd(lines: readonly string[], from: number): number {
  for (let index = from; index < lines.length; index += 1) {
    if ((lines[index] ?? '').trim() === '```') return index;
  }
  return lines.length;
}

/** The matching `</details>`, skipping nested blocks and anything inside code fences. */
function findDetailsEnd(lines: readonly string[], from: number): number {
  let depth = 1;
  for (let index = from; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? '').trim();
    if (FENCE.test(trimmed)) {
      index = findFenceEnd(lines, index + 1);
      continue;
    }
    if (trimmed === '<details>') depth += 1;
    if (trimmed === '</details>') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return lines.length;
}

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w])_([^_\n]+)_(?![\w])/g;

export function parseInline(text: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    if (start > last) nodes.push({ type: 'text', text: text.slice(last, start) });

    const [whole, code, strong, label, href, em] = match;
    if (code !== undefined) {
      nodes.push({ type: 'code', text: code });
    } else if (strong !== undefined) {
      nodes.push({ type: 'strong', children: parseInline(strong) });
    } else if (label !== undefined && href !== undefined) {
      nodes.push(
        /^https?:\/\//i.test(href)
          ? { type: 'link', href, children: parseInline(label) }
          : { type: 'text', text: whole },
      );
    } else if (em !== undefined) {
      nodes.push({ type: 'em', children: parseInline(em) });
    }
    last = start + whole.length;
  }

  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes;
}
