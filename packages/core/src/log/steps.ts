/** Splitting a cleaned job log into the steps GitHub ran. */

export interface LogStep {
  /** Step name, e.g. `Run npm test` becomes `npm test`. */
  name: string;
  /** 1-based, inclusive line numbers in the cleaned log. */
  startLine: number;
  endLine: number;
  lines: string[];
}

const GROUP_START = /^##\[group\](.*)$/;

/**
 * Only some top-level groups start a step. The runner opens `##[group]Run <cmd>`
 * per step plus a few fixed sections; tools (npm, gradle, docker) open groups of
 * their own inside a step's output, and those must not split it.
 */
const STEP_TITLE =
  /^(?:Run |Post Run |Operating System|Runner Image|Runner Image Provisioner|GITHUB_TOKEN|Secret source|Set up job|Post job cleanup|Complete job)/;

/**
 * A step begins at a `##[group]` whose title the runner owns (`Run npm test` and a
 * few fixed sections). Groups opened by tools inside a step are ignored, and output
 * after a group's `##[endgroup]` still belongs to that step, which is where the
 * interesting failures usually are.
 *
 * Nesting is deliberately not tracked: composite actions emit groups that are never
 * closed, which would otherwise swallow every later step.
 */
export function splitSteps(cleanedLog: string): LogStep[] {
  const lines = cleanedLog.split('\n');
  const steps: LogStep[] = [];
  let current: { name: string; startLine: number; lines: string[] } | null = null;

  const close = (endLine: number): void => {
    if (!current) return;
    steps.push({ name: current.name, startLine: current.startLine, endLine, lines: current.lines });
    current = null;
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const start = GROUP_START.exec(line);

    if (start && STEP_TITLE.test((start[1] ?? '').trim())) {
      close(lineNumber - 1);
      current = { name: stepName(start[1] ?? ''), startLine: lineNumber, lines: [line] };
      return;
    }

    if (current) current.lines.push(line);
    else if (steps.length === 0 && line.trim() !== '') {
      // Output before the first group (runner preamble).
      current = { name: 'Set up job', startLine: lineNumber, lines: [line] };
    }
  });

  close(lines.length);
  return steps;
}

function stepName(groupTitle: string): string {
  const title = groupTitle.trim();
  return title.startsWith('Run ') ? title.slice(4).trim() : title;
}

/** Steps the runner adds around the user's own steps. */
const RUNNER_STEP =
  /^(Set up job|Post job cleanup|Cleaning up orphan processes|Complete job|Run actions\/|Post Run |Operating System|Runner Image|Runner Image Provisioner|GITHUB_TOKEN|Secret source)/i;

export function isRunnerStep(step: LogStep): boolean {
  return RUNNER_STEP.test(step.name);
}

/**
 * The step that failed: the last step containing an `##[error]` marker, falling
 * back to the last step that is not runner bookkeeping.
 */
export function findFailingStep(steps: readonly LogStep[]): LogStep | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.lines.some((line) => line.startsWith('##[error]'))) return step;
  }
  const candidates = steps.filter((step) => !isRunnerStep(step));
  return candidates.at(-1) ?? steps.at(-1);
}
