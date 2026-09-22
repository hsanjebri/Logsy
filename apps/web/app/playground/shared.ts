import type { MarkdownBlock } from '@logsy/core';

/** Server actions accept about 1 MB; a log this size is already far past what Logsy keeps. */
export const MAX_LOG_CHARS = 900_000;

export interface PlaygroundResult {
  stepName: string | null;
  charsOriginal: number;
  charsExcerpt: number;
  redactions: number;
  fingerprint: string;
  source: 'rule' | 'llm' | 'none';
  ruleId: string | null;
  category: string;
  confidence: number;
  confident: boolean;
  title: string;
  llm: { model: string; latencyMs: number; tokens: number; fellBack: boolean } | null;
  markdown: string;
  blocks: MarkdownBlock[];
}

export type PlaygroundState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: PlaygroundResult };
