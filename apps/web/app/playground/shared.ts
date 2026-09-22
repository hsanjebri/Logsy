import type { LogAnalysisSummary } from '@logsy/llm';

/** Server actions accept about 1 MB; a log this size is already far past what Logsy keeps. */
export const MAX_LOG_CHARS = 900_000;

export type PlaygroundResult = LogAnalysisSummary;

export type PlaygroundState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: PlaygroundResult };
