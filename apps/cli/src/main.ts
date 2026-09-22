#!/usr/bin/env node
import { EnvValidationError, llmEnvSchema, loadEnv } from '@logsy/config';
import { analyzeLog, createConfiguredProvider, type LlmProvider } from '@logsy/llm';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USAGE, parseCliArgs } from './args.js';
import { runInteractive } from './tui/app.js';
import { openTerminal } from './tui/terminal.js';
import { renderReport } from './render.js';
import { startSpinner } from './spinner.js';
import { colorLevel, createTheme } from './theme.js';

const interactive = process.stdout.isTTY;
const theme = createTheme({
  level: colorLevel(process.env, interactive),
  interactive,
  // Not a terminal: a width that reads well when piped into a file or a pager.
  width: interactive ? process.stdout.columns : 92,
});

/** Real logs from public projects, bundled with the evals; present in a clone of the repo. */
const FIXTURES_DIR = fileURLToPath(new URL('../../../evals/fixtures/', import.meta.url));

async function readInput(file: string | undefined): Promise<{ label: string; text: string }> {
  if (file === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return { label: 'stdin', text: Buffer.concat(chunks).toString('utf8') };
  }
  if (file !== undefined) {
    return { label: basename(file), text: await readFile(file, 'utf8') };
  }
  if (!existsSync(FIXTURES_DIR)) throw new Error('pass a log file: logsy analyze <file>');
  const names = (await readdir(FIXTURES_DIR)).filter((name) => name.endsWith('.log')).sort();
  const pick = names.find((name) => name.includes('vitest')) ?? names[0];
  if (!pick) throw new Error('pass a log file: logsy analyze <file>');
  return {
    label: `${basename(pick)} (example)`,
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
      `${theme.warning('LLM not configured, using rules only:')}\n${theme.dim(
        error.issues.map((issue) => `  ${issue.variable}: ${issue.message}`).join('\n'),
      )}\n`,
    );
    return undefined;
  }
}

async function main(): Promise<void> {
  const command = parseCliArgs(process.argv.slice(2), interactive && process.stdin.isTTY);
  if (command.kind === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (command.kind === 'interactive') {
    const terminal = openTerminal();
    try {
      await runInteractive({
        terminal,
        theme,
        examplesDir: FIXTURES_DIR,
        llm: buildLlm(false),
        llmNote: 'no model configured; see .env',
      });
    } finally {
      terminal.close();
    }
    return;
  }

  const input = await readInput(command.file);
  const llm = command.llm ? buildLlm(command.llmOnly) : undefined;
  // Rules answer instantly; only a model call is worth a spinner.
  const spinner =
    llm && !command.json ? startSpinner(`Analyzing with ${llm.model}`, theme) : undefined;

  try {
    const result = await analyzeLog(input.text, {
      ...(llm ? { llm } : {}),
      skipRules: command.llmOnly,
      jobName: command.jobName,
    });
    spinner?.stop();

    process.stdout.write(
      command.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : renderReport(input.label, result, theme),
    );
  } catch (error) {
    spinner?.stop();
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${theme.danger('error:')} ${message}\n\n${USAGE}\n`);
  process.exitCode = 1;
});
