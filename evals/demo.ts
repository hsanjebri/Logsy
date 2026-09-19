/**
 * Runs the whole analysis pipeline over one log file and prints the PR comment
 * Logsy would post. No GitHub, no database, no API key.
 *
 *   pnpm demo                       # a bundled fixture
 *   pnpm demo path/to/ci-log.txt    # your own log
 */
import {
  COMMENT_MARKER,
  extractFailureContext,
  fingerprint,
  formatFailureComment,
  matchRule,
  ruleToAnalysis,
  type AnalysisResult,
} from '@logsy/core';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

async function defaultFixture(): Promise<string> {
  const names = (await readdir(FIXTURES_DIR)).filter((name) => name.endsWith('.log')).sort();
  const pick = names.find((name) => name.includes('vitest')) ?? names[0];
  if (!pick) throw new Error('no fixtures found');
  return `${FIXTURES_DIR}${pick}`;
}

const path = process.argv[2] ?? (await defaultFixture());
const raw = await readFile(path, 'utf8');

const context = extractFailureContext(raw, { maxChars: 12_000 });
const match = matchRule(context.excerpt);
const analysis: AnalysisResult = match
  ? ruleToAnalysis(match)
  : {
      category: 'unknown',
      title: 'CI failed',
      rootCause: '',
      evidence: [],
      likelyFiles: [],
      suggestedFix: '',
      isLikelyFlaky: false,
      confidence: 0,
    };

const id = fingerprint({ normalizedError: context.normalizedError, stepName: context.stepName });

console.log(`
Log:          ${path}
Size:         ${raw.length.toLocaleString()} chars in, ${context.charsExcerpt.toLocaleString()} kept
Failing step: ${context.stepName ?? 'unknown'}
Error found:  ${context.region?.anchors[0]?.text.trim().slice(0, 80) ?? 'none'}
Matched:      ${match ? `rule "${match.rule.id}" (${match.rule.category})` : 'no rule — an LLM would be asked'}
Fingerprint:  ${id}
${'─'.repeat(78)}`);

console.log(
  formatFailureComment({
    analysis,
    source: match ? 'rule' : 'llm',
    repoFullName: 'your-org/your-repo',
    workflowName: 'CI',
    jobName: 'build',
    stepName: context.stepName,
    runUrl: 'https://github.com/your-org/your-repo/actions/runs/1',
    errorExcerpt: context.excerpt,
    headSha: '9f2c1ab5d4e3f60718293a4b5c6d7e8f90123456',
  }).replace(`${COMMENT_MARKER}\n\n`, ''),
);
