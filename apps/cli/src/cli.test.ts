import { analyzeLog } from '@logsy/llm';
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './args.js';
import { PLAIN, renderComment, renderSummary } from './render.js';

describe('parseCliArgs', () => {
  it('shows help with no command', () => {
    expect(parseCliArgs([])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['analyze', '--help'])).toEqual({ kind: 'help' });
  });

  it('reads a file and defaults to using the LLM', () => {
    expect(parseCliArgs(['analyze', 'ci.log'])).toEqual({
      kind: 'analyze',
      file: 'ci.log',
      llm: true,
      llmOnly: false,
      json: false,
      jobName: 'build',
    });
  });

  it('understands the flags', () => {
    expect(parseCliArgs(['analyze', '-', '--no-llm', '--json', '--job', 'test'])).toMatchObject({
      file: '-',
      llm: false,
      json: true,
      jobName: 'test',
    });
    expect(parseCliArgs(['analyze', '--llm-only'])).toMatchObject({
      file: undefined,
      llmOnly: true,
    });
  });

  it('rejects what makes no sense', () => {
    expect(() => parseCliArgs(['explain'])).toThrow('unknown command');
    expect(() => parseCliArgs(['analyze', 'a.log', 'b.log'])).toThrow('single log file');
    expect(() => parseCliArgs(['analyze', '--no-llm', '--llm-only'])).toThrow('cannot be combined');
  });
});

describe('rendering', () => {
  const log = [
    '##[group]Run npm ci',
    'npm ci',
    'npm ERR! code ERESOLVE',
    'npm ERR! ERESOLVE unable to resolve dependency tree',
    '##[error]Process completed with exit code 1.',
  ].join('\n');

  it('summarizes how the failure was decided, then previews the comment', async () => {
    const result = await analyzeLog(log);
    const summary = renderSummary('ci.log', result, PLAIN);

    expect(summary).toContain('Failing step  npm ci');
    expect(summary).toMatch(/Decided by +rule \S+ \(no LLM call\)/);
    expect(summary).toContain('no secrets found');
    expect(renderComment(result, PLAIN)).toContain('PR comment preview');
  });

  it('says when nothing could explain the failure', async () => {
    const result = await analyzeLog(
      '##[group]Run ./x\nodd\n##[error]Process completed with exit code 3.',
    );
    const summary = renderSummary('x.log', result, PLAIN);
    expect(summary).toContain('no rule matched and no LLM is configured');
    expect(summary).toContain('unsure');
  });
});
