import { analyzeLog, type LlmProvider, type LogAnalysis } from '@logsy/llm';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { banner } from '../box.js';
import { renderReport } from '../render.js';
import { startSpinner } from '../spinner.js';
import type { Theme } from '../theme.js';
import { copyToClipboard } from './clipboard.js';
import { listExamples } from './examples.js';
import { askMenu, askPaste, askText, Frame } from './prompts.js';
import type { Terminal } from './terminal.js';

export interface InteractiveDeps {
  terminal: Terminal;
  theme: Theme;
  /** Where the bundled example logs live; empty when running outside the repo. */
  examplesDir: string;
  llm: LlmProvider | undefined;
  /** Why there is no model, shown in the menu. */
  llmNote: string;
}

interface Settings {
  useLlm: boolean;
  skipRules: boolean;
}

/** The whole interactive session: pick a log, read the report, pick another. */
export async function runInteractive(deps: InteractiveDeps): Promise<void> {
  const { terminal, theme } = deps;
  const settings: Settings = { useLlm: deps.llm !== undefined, skipRules: false };

  terminal.write(`${banner(theme, 'Why your CI failed, explained.').join('\n')}\n`);

  for (;;) {
    const choice = await askMenu(terminal, theme, {
      title: 'What do you want to analyze?',
      items: [
        { label: 'Example failures', hint: 'real logs from public projects' },
        { label: 'Open a file…', hint: 'a path on this machine' },
        { label: 'Paste a log', hint: 'straight from your CI' },
        { label: 'Models', hint: modelsHint(deps, settings) },
        { label: 'Quit' },
      ],
      footer: '↑↓ move   ↵ select   q quit',
    });

    if (choice.kind !== 'selected' || choice.index === 4) return;

    if (choice.index === 3) {
      await editSettings(deps, settings);
      continue;
    }

    const input = await pickLog(deps, choice.index);
    if (!input) continue;

    const result = await analyze(deps, settings, input.text);
    if (!result) continue;

    terminal.write(`${renderReport(input.label, result, theme)}\n`);
    if ((await afterReport(deps, result)) === 'quit') return;
  }
}

function modelsHint(deps: InteractiveDeps, settings: Settings): string {
  if (!deps.llm) return deps.llmNote;
  if (!settings.useLlm) return 'off — rules only';
  return settings.skipRules ? `${deps.llm.model} · rules skipped` : deps.llm.model;
}

async function editSettings(deps: InteractiveDeps, settings: Settings): Promise<void> {
  const { terminal, theme } = deps;
  if (!deps.llm) {
    const frame = new Frame(terminal);
    frame.show(['', theme.warning(deps.llmNote), '']);
    await terminal.readKey();
    frame.clear();
    return;
  }

  for (;;) {
    const choice = await askMenu(terminal, theme, {
      title: `Models · ${deps.llm.model}`,
      items: [
        {
          label: settings.useLlm ? '◉ Ask the models when no rule matches' : '○ Rules only',
          hint: 'enter toggles',
        },
        {
          label: settings.skipRules ? '◉ Skip the rules entirely' : '○ Rules first',
          hint: settings.useLlm ? 'enter toggles' : 'needs the models on',
          disabled: !settings.useLlm,
        },
        { label: 'Back' },
      ],
      footer: '↑↓ move   ↵ toggle   q back',
    });

    if (choice.kind !== 'selected' || choice.index === 2) return;
    if (choice.index === 0) {
      settings.useLlm = !settings.useLlm;
      if (!settings.useLlm) settings.skipRules = false;
    } else settings.skipRules = !settings.skipRules;
  }
}

async function pickLog(
  deps: InteractiveDeps,
  choice: number,
): Promise<{ label: string; text: string } | null> {
  const { terminal, theme } = deps;

  if (choice === 0) {
    const examples = await listExamples(deps.examplesDir);
    if (examples.length === 0) {
      const frame = new Frame(terminal);
      frame.show([
        '',
        theme.warning('No bundled examples here; run Logsy from its repository.'),
        '',
      ]);
      await terminal.readKey();
      frame.clear();
      return null;
    }
    const picked = await askMenu(terminal, theme, {
      title: 'Example failures',
      items: examples.map((example) => ({
        label: example.label,
        ...(example.detail === null ? {} : { hint: example.detail }),
      })),
      rows: 12,
      footer: '↑↓ move   ↵ analyze   q back',
    });
    if (picked.kind !== 'selected') return null;
    const example = examples[picked.index];
    if (!example) return null;
    return { label: example.label, text: await readFile(example.file, 'utf8') };
  }

  if (choice === 1) {
    const path = await askText(terminal, theme, {
      title: 'Path to a log file',
      hint: '↵ analyze   esc back',
    });
    if (path === null || path === '') return null;
    try {
      return { label: basename(path), text: await readFile(path.replace(/^"|"$/g, ''), 'utf8') };
    } catch {
      const frame = new Frame(terminal);
      frame.show(['', theme.danger(`Could not read ${path}`), '']);
      await terminal.readKey();
      frame.clear();
      return null;
    }
  }

  const pasted = await askPaste(terminal, theme);
  return pasted === null ? null : { label: 'pasted log', text: pasted };
}

async function analyze(
  deps: InteractiveDeps,
  settings: Settings,
  log: string,
): Promise<LogAnalysis | null> {
  const llm = settings.useLlm ? deps.llm : undefined;
  const spinner = llm ? startSpinner(`Analyzing with ${llm.model}`, deps.theme) : undefined;
  try {
    return await analyzeLog(log, {
      ...(llm ? { llm } : {}),
      skipRules: settings.skipRules && llm !== undefined,
    });
  } catch (error) {
    const frame = new Frame(deps.terminal);
    frame.show(['', deps.theme.danger(error instanceof Error ? error.message : String(error)), '']);
    await deps.terminal.readKey();
    frame.clear();
    return null;
  } finally {
    spinner?.stop();
  }
}

async function afterReport(deps: InteractiveDeps, result: LogAnalysis): Promise<'again' | 'quit'> {
  const { terminal, theme } = deps;
  for (;;) {
    const choice = await askMenu(terminal, theme, {
      title: 'What next?',
      items: [
        { label: 'Analyze another log' },
        { label: 'Copy the comment', hint: 'Markdown, ready to paste' },
        { label: 'Quit' },
      ],
      footer: '↑↓ move   ↵ select   q quit',
    });
    if (choice.kind !== 'selected' || choice.index === 2) return 'quit';
    if (choice.index === 0) return 'again';

    const copied = await copyToClipboard(result.comment);
    const frame = new Frame(terminal);
    frame.show([
      '',
      copied
        ? theme.success('Copied to the clipboard.')
        : theme.warning('Could not reach the clipboard; use --json or pipe the output instead.'),
      '',
    ]);
    await terminal.readKey();
    frame.clear();
  }
}
