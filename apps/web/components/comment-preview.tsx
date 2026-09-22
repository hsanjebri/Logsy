import type { MarkdownBlock, MarkdownInline } from '@logsy/core';
import type { ReactNode } from 'react';

/**
 * Renders a parsed Logsy comment the way GitHub shows it. Built from the tree, never
 * from an HTML string, so nothing a model writes can become markup.
 */
export function CommentPreview({ blocks }: { blocks: readonly MarkdownBlock[] }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink">
      {renderBlocks(blocks)}
    </div>
  );
}

function renderBlocks(blocks: readonly MarkdownBlock[]): ReactNode[] {
  return blocks.map((block, index) => <Block key={index} block={block} />);
}

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.type) {
    case 'heading':
      return (
        <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
          {renderInline(block.children)}
        </h3>
      );
    case 'paragraph':
      return (
        <p className="text-secondary">
          {block.lines.map((line, index) => (
            <span key={index}>
              {index > 0 ? <br /> : null}
              {renderInline(line)}
            </span>
          ))}
        </p>
      );
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-[10px] bg-track px-4 py-3 font-[family-name:var(--font-mono)] text-[12.5px] leading-[1.6] text-ink">
          <code>{block.text}</code>
        </pre>
      );
    case 'list':
      return (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-secondary">
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'quote':
      return (
        <blockquote className="border-l-[3px] border-hairline pl-3 text-secondary">
          {block.lines.map((line, index) => (
            <div key={index}>{renderInline(line)}</div>
          ))}
        </blockquote>
      );
    case 'details':
      return (
        <details className="group rounded-[10px] border border-hairline px-4 py-2.5">
          <summary className="cursor-pointer text-[13px] font-medium text-ink select-none">
            {renderInline(block.summary)}
          </summary>
          <div className="mt-3 flex flex-col gap-3">{renderBlocks(block.children)}</div>
        </details>
      );
    case 'rule':
      return <hr className="border-hairline" />;
    case 'small':
      return <p className="text-xs text-tertiary">{renderInline(block.children)}</p>;
  }
}

function renderInline(nodes: readonly MarkdownInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <span key={index}>{node.text}</span>;
      case 'code':
        return (
          <code
            key={index}
            className="rounded-[5px] bg-track px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[12.5px] text-ink"
          >
            {node.text}
          </code>
        );
      case 'strong':
        return (
          <strong key={index} className="font-semibold text-ink">
            {renderInline(node.children)}
          </strong>
        );
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>;
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink underline decoration-hairline underline-offset-2 hover:decoration-ink"
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}
