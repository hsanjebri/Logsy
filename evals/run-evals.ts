/**
 * Accuracy harness. Runs the real analysis pipeline over the labeled fixtures in
 * evals/fixtures/ and reports how often it gets the answer right.
 *
 *   pnpm evals              # rules only (free, no API calls)
 *   pnpm evals --llm        # also send unmatched fixtures to the configured LLM
 *
 * Results are written to evals/results/<date>.json so runs can be compared.
 */
import {
  extractFailureContext,
  fingerprint,
  matchRule,
  ruleToAnalysis,
  type AnalysisResult,
  type FailureCategory,
} from '@logsy/core';
import { llmEnvSchema, loadEnv } from '@logsy/config';
import { PROMPT_VERSION, createConfiguredProvider, type LlmProvider } from '@logsy/llm';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL('./results/', import.meta.url));
const MAX_CHARS = 12_000;

interface FixtureLabels {
  source: string;
  ecosystem?: string;
  jobName: string;
  stepName: string | null;
  expected_category: FailureCategory | null;
  expected_root_cause_keywords: string[];
}

interface CaseResult {
  fixture: string;
  source: 'rule' | 'llm' | 'none';
  ruleId: string | null;
  expectedCategory: FailureCategory | null;
  actualCategory: FailureCategory | null;
  categoryCorrect: boolean;
  keywordsExpected: number;
  keywordsHit: number;
  missingKeywords: string[];
  confidence: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  fingerprint: string;
}

interface Summary {
  ranAt: string;
  promptVersion: string;
  mode: string;
  fixtures: number;
  answered: number;
  resolvedByRule: number;
  resolvedByLlm: number;
  unanswered: number;
  categoryAccuracy: number;
  categoryAccuracyOfAnswered: number;
  keywordHitRate: number;
  averageConfidence: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  totalCostUsd: number;
  averageLatencyMs: number;
}

async function loadFixtures() {
  const names = (await readdir(FIXTURES_DIR)).filter((name) => name.endsWith('.log')).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      log: await readFile(`${FIXTURES_DIR}${name}`, 'utf8'),
      labels: JSON.parse(
        await readFile(`${FIXTURES_DIR}${name.replace(/\.log$/, '.json')}`, 'utf8'),
      ) as FixtureLabels,
    })),
  );
}

function keywordHits(result: AnalysisResult, keywords: string[]): string[] {
  const haystack = [result.title, result.rootCause, result.suggestedFix, ...result.evidence]
    .join('\n')
    .toLowerCase();
  return keywords.filter((keyword) => !haystack.includes(keyword.toLowerCase()));
}

function buildProvider(): LlmProvider | undefined {
  if (!process.argv.includes('--llm')) return undefined;
  // Same validation and wiring as the worker, so evals measure what production runs.
  const env = loadEnv([llmEnvSchema]);
  return createConfiguredProvider({
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    panel: env.LLM_PANEL,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    groqApiKey: env.GROQ_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY,
    ollamaBaseUrl: env.OLLAMA_BASE_URL,
  });
}

async function main(): Promise<void> {
  const llm = buildProvider();
  const fixtures = await loadFixtures();
  const cases: CaseResult[] = [];

  for (const fixture of fixtures) {
    const context = extractFailureContext(fixture.log, { maxChars: MAX_CHARS });
    const match = matchRule(context.excerpt);
    const started = Date.now();

    let result: AnalysisResult | null = null;
    let source: CaseResult['source'] = 'none';
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let latencyMs = 0;

    if (match) {
      result = ruleToAnalysis(match);
      source = 'rule';
      latencyMs = Date.now() - started;
    } else if (llm) {
      const analysis = await llm.analyze({
        excerpt: context.excerpt,
        repoFullName: fixture.labels.source,
        workflowName: 'CI',
        jobName: fixture.labels.jobName,
        stepName: context.stepName,
      });
      result = analysis.result;
      source = 'llm';
      inputTokens = analysis.usage.inputTokens;
      outputTokens = analysis.usage.outputTokens;
      costUsd = analysis.usage.costUsd ?? 0;
      latencyMs = analysis.latencyMs;
    }

    // With no analysis, every keyword is missed; counting them as hits would flatter the score.
    const missing = result
      ? keywordHits(result, fixture.labels.expected_root_cause_keywords)
      : [...fixture.labels.expected_root_cause_keywords];
    cases.push({
      fixture: fixture.name,
      source,
      ruleId: match?.rule.id ?? null,
      expectedCategory: fixture.labels.expected_category,
      actualCategory: result?.category ?? null,
      categoryCorrect: result?.category === fixture.labels.expected_category,
      keywordsExpected: fixture.labels.expected_root_cause_keywords.length,
      keywordsHit: fixture.labels.expected_root_cause_keywords.length - missing.length,
      missingKeywords: missing,
      confidence: result?.confidence ?? null,
      inputTokens,
      outputTokens,
      costUsd,
      latencyMs,
      fingerprint: fingerprint({
        normalizedError: context.normalizedError,
        stepName: context.stepName,
      }),
    });
  }

  const answered = cases.filter((entry) => entry.source !== 'none');
  const summary: Summary = {
    ranAt: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    mode: llm ? `rules + ${llm.name}/${llm.model}` : 'rules only',
    fixtures: cases.length,
    answered: answered.length,
    resolvedByRule: cases.filter((entry) => entry.source === 'rule').length,
    resolvedByLlm: cases.filter((entry) => entry.source === 'llm').length,
    unanswered: cases.length - answered.length,
    categoryAccuracy: ratio(cases.filter((entry) => entry.categoryCorrect).length, cases.length),
    categoryAccuracyOfAnswered: ratio(
      answered.filter((entry) => entry.categoryCorrect).length,
      answered.length,
    ),
    keywordHitRate: ratio(
      sum(cases, (entry) => entry.keywordsHit),
      sum(cases, (entry) => entry.keywordsExpected),
    ),
    averageConfidence: ratio(
      sum(answered, (entry) => entry.confidence ?? 0),
      answered.length,
    ),
    averageInputTokens: Math.round(
      ratio(
        sum(cases, (e) => e.inputTokens),
        cases.length,
      ) * 1,
    ),
    averageOutputTokens: Math.round(
      ratio(
        sum(cases, (e) => e.outputTokens),
        cases.length,
      ) * 1,
    ),
    totalCostUsd: Number(sum(cases, (entry) => entry.costUsd).toFixed(4)),
    averageLatencyMs: Math.round(
      ratio(
        sum(cases, (e) => e.latencyMs),
        cases.length,
      ),
    ),
  };

  print(summary, cases);

  await mkdir(RESULTS_DIR, { recursive: true });
  const file = `${RESULTS_DIR}${new Date().toISOString().slice(0, 10)}.json`;
  await writeFile(file, `${JSON.stringify({ summary, cases }, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nSaved ${file}\n`);
}

function sum<T>(items: T[], select: (item: T) => number): number {
  return items.reduce((total, item) => total + select(item), 0);
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function print(summary: Summary, cases: CaseResult[]): void {
  const lines = ['', `Logsy evals — ${summary.mode}`, '='.repeat(72), ''];

  for (const entry of cases) {
    const mark = entry.categoryCorrect ? '✓' : entry.source === 'none' ? '–' : '✗';
    const name = entry.fixture
      .replace(/-\d+-\d+\.log$/, '')
      .slice(0, 30)
      .padEnd(31);
    const category = (entry.actualCategory ?? 'none').padEnd(16);
    const expected = entry.categoryCorrect ? '' : `expected ${entry.expectedCategory ?? '?'}`;
    lines.push(
      `${mark} ${name}${category}${String(entry.keywordsHit)}/${String(entry.keywordsExpected)} keywords  ${(entry.ruleId ?? entry.source).padEnd(22)}${expected}`,
    );
  }

  lines.push(
    '',
    '-'.repeat(72),
    `Fixtures              ${summary.fixtures} (${summary.resolvedByRule} by rule, ${summary.resolvedByLlm} by LLM, ${summary.unanswered} unanswered)`,
    `Category accuracy     ${percent(summary.categoryAccuracy)} overall, ${percent(summary.categoryAccuracyOfAnswered)} of answered`,
    `Keyword hit rate      ${percent(summary.keywordHitRate)}`,
    `Average confidence    ${summary.averageConfidence.toFixed(2)}`,
    `Average tokens        ${summary.averageInputTokens} in, ${summary.averageOutputTokens} out`,
    `Total cost            $${summary.totalCostUsd}`,
    `Average latency       ${summary.averageLatencyMs} ms`,
  );

  process.stdout.write(`${lines.join('\n')}\n`);
}

await main();
