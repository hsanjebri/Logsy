import type { AnalysisInput } from './types.js';

/** Bump when the prompt changes; stored with every analysis so results stay comparable. */
export const PROMPT_VERSION = 'v1';

export const SYSTEM_PROMPT = `You explain why a CI job failed, for the developer who wrote the code.

Rules:
- Use only the evidence in the log excerpt and the diff summary you are given.
- Never invent file paths, line numbers, test names or error messages. Every path you name must appear in the log or the diff.
- Quote evidence verbatim from the log, at most five lines, shortest lines that prove the cause.
- The last error in a log is usually a consequence ("Process completed with exit code 1"). Find the first real cause.
- If the log does not say why the job failed, answer with category "unknown", say what is missing, and give a low confidence.
- Be concise: a root cause of one to three plain sentences, and a fix someone can act on.
- Confidence is your own estimate that this explanation is correct: below 0.5 when you are guessing.
- Redacted values appear as [REDACTED:type]. Treat them as secrets that were removed, never as the cause.

Categories: test_failure, build_error, type_error, lint_error, dependency_error, infrastructure, timeout, out_of_memory, configuration, flaky, unknown.`;

export function buildUserMessage(input: AnalysisInput): string {
  const sections: string[] = [
    `Repository: ${input.repoFullName}`,
    `Workflow: ${input.workflowName}`,
    `Failed job: ${input.jobName}`,
    `Failed step: ${input.stepName ?? 'unknown'}`,
  ];

  if (input.diffSummary) {
    sections.push(`\nChanges in this pull request:\n${input.diffSummary}`);
  }
  if (input.workflowFile) {
    sections.push(`\nWorkflow file:\n\`\`\`yaml\n${input.workflowFile}\n\`\`\``);
  }

  sections.push(`\nLog excerpt (cleaned, trimmed and redacted):\n\`\`\`\n${input.excerpt}\n\`\`\``);
  sections.push('\nExplain why this job failed.');

  return sections.join('\n');
}

/** Appended on a retry so the model can correct its own invalid output. */
export function buildRepairMessage(issues: string): string {
  return `Your previous answer did not match the required schema:\n${issues}\nAnswer again, correcting exactly those problems.`;
}
