#!/usr/bin/env node
import { EnvValidationError, llmEnvSchema, loadEnv } from '@logsy/config';
import { analyzeLog, createConfiguredProvider, type LlmProvider } from '@logsy/llm';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USAGE, parseCliArgs } from './args.js';
import { COLOR, PLAIN, renderComment, renderSummary } from './render.js';

const style = process.stdout.isTTY && !process.env.NO_COLOR ? COLOR : PLAIN;

/** Real logs from public projects, bundled with the evals; present in a clone of the repo. */
const FIXTURES_DIR = fileURLToPath(new URL('../../../evals/fixtures/', import.meta.url));

async function readInput(file: string | undefined): Promise<{ label: string; text: string }> {
  if (file === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return { label: 'stdin', text: Buffer.concat(chunks).toString('utf8') };
  }
  if (file !== undefined) {
    return { label: file, text: await readFile(file, 'utf8') };
  }
  if (!existsSync(FIXTURES_DIR)) throw new Error('pass a log file: logsy analyze <file>');
  const names = (await readdir(FIXTURES_DIR)).filter((name) => name.endsWith('.log')).sort();
  const pick = names.find((name) => name.includes('vitest')) ?? names[0];
  if (!pick) throw new Error('pass a log file: logsy analyze <file>');
  return {
    label: `example log ${style.dim(`(${basename(pick)})`)}`,
    text: await readFile(`${FIXTURES_DIR}${pick}`, 'utf8'),
  };
}

/** The LLM from .env, or undefined with a note when it is off or not configured. */
function buildLlm(required: boolean): LlmProvider | undefined {
  if (process.env.LLM_ENABLED === 'false') {
    if (required) throw new Error('--llm-only needs LLM_ENABLED=true');
    return undefined;
  }
  try {
    const env = loadEnv([llmEnvSchema]);
    return createConfiguredProvider({
      provider: env.LLM_PROVIDER,
      model: env.LLM_MODEL,
      modelFast: env.LLM_MODEL_FAST,
      panel: env.LLM_PANEL,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      openaiApiKey: env.OPENAI_API_KEY,
      groqApiKey: env.GROQ_API_KEY,
      geminiApiKey: env.GEMINI_API_KEY,
      ollamaBaseUrl: env.OLLAMA_BASE_URL,
    });
  } catch (error) {
    if (required || !(error instanceof EnvValidationError)) throw error;
    process.stderr.write(
      style.yellow('LLM not configured, using rules only:\n') +
        style.dim(error.issues.map((issue) => `  ${issue.variable}: ${issue.message}`).join('\n')) +
        '\n',
    );
    return undefined;
  }
}

async function main(): Promise<void> {
  const command = parseCliArgs(process.argv.slice(2));
  if (command.kind === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const input = await readInput(command.file);
  const llm = command.llm ? buildLlm(command.llmOnly) : undefined;
  if (llm && !command.json) {
    process.stderr.write(style.dim(`analyzing with ${llm.model}...\n`));
  }

  const result = await analyzeLog(input.text, {
    llm,
    skipRules: command.llmOnly,
    jobName: command.jobName,
  });

  if (command.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderSummary(input.label, result, style));
  process.stdout.write(renderComment(result, style));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${style.red('error:')} ${message}\n\n${USAGE}\n`);
  process.exitCode = 1;
});
