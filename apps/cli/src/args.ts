import { parseArgs } from 'node:util';

export const USAGE = `Logsy · why your CI failed, explained.

  logsy analyze [file] [options]

Runs Logsy's analysis on a CI log and prints the pull request comment it would post.
Reads stdin when the file is "-", and a bundled example log when it is omitted.

Options
  --no-llm        rules only: no API calls, no key needed
  --llm-only      skip the rules, to see what the model (or panel) says
  --job <name>    job name shown in the comment (default: build)
  --json          print the full result as JSON, for scripts
  -h, --help      show this help

Examples
  logsy analyze ci.log
  kubectl logs job/ci | logsy analyze -
  logsy analyze ci.log --llm-only --job "test (3.12)"

The model is configured in .env (LLM_PROVIDER and LLM_MODEL, or LLM_PANEL for
several at once). Colour follows the terminal; NO_COLOR turns it off.`;

export type CliCommand =
  | { kind: 'help' }
  | {
      kind: 'analyze';
      file: string | undefined;
      llm: boolean;
      llmOnly: boolean;
      json: boolean;
      jobName: string;
    };

/** Throws with a message fit for the terminal when the arguments make no sense. */
export function parseCliArgs(argv: readonly string[]): CliCommand {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    allowNegative: true,
    options: {
      llm: { type: 'boolean', default: true },
      'llm-only': { type: 'boolean', default: false },
      job: { type: 'string', default: 'build' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const [command, file, ...extra] = positionals;
  if (values.help || command === undefined || command === 'help') return { kind: 'help' };
  if (command !== 'analyze') throw new Error(`unknown command "${command}"`);
  if (extra.length > 0) throw new Error('analyze takes a single log file');
  if (!values.llm && values['llm-only']) {
    throw new Error('--no-llm and --llm-only cannot be combined');
  }

  return {
    kind: 'analyze',
    file,
    llm: values.llm,
    llmOnly: values['llm-only'],
    json: values.json,
    jobName: values.job,
  };
}
