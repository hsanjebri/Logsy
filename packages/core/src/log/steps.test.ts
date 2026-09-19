import { describe, expect, it } from 'vitest';
import { findFailingStep, isRunnerStep, splitSteps } from './steps.js';

const log = [
  'Current runner version: 2.337.0',
  '##[group]Operating System',
  'Ubuntu',
  '##[endgroup]',
  '##[group]Run npm ci',
  'npm ci',
  '##[endgroup]',
  'added 400 packages',
  '##[group]Run npm test',
  'npm test',
  '##[endgroup]',
  '##[group]inner tool group',
  'noise',
  '##[endgroup]',
  'FAIL src/app.test.ts',
  '##[error]Process completed with exit code 1.',
  '##[group]Post job cleanup',
  'cleaning',
  '##[endgroup]',
].join('\n');

describe('splitSteps', () => {
  it('splits on top-level groups and names steps after the command', () => {
    expect(splitSteps(log).map((step) => step.name)).toEqual([
      'Set up job',
      'Operating System',
      'npm ci',
      'npm test',
      'Post job cleanup',
    ]);
  });

  it('keeps output that follows a step inside that step', () => {
    const npmCi = splitSteps(log).find((step) => step.name === 'npm ci');
    expect(npmCi?.lines).toContain('added 400 packages');
  });

  it('does not split on nested groups', () => {
    const npmTest = splitSteps(log).find((step) => step.name === 'npm test');
    expect(npmTest?.lines).toContain('##[group]inner tool group');
    expect(npmTest?.lines).toContain('FAIL src/app.test.ts');
  });

  it('reports line numbers that address the original log', () => {
    const lines = log.split('\n');
    for (const step of splitSteps(log)) {
      expect(lines[step.startLine - 1]).toBe(step.lines[0]);
      expect(step.endLine - step.startLine + 1).toBe(step.lines.length);
    }
  });

  it('handles a log with no groups at all', () => {
    const steps = splitSteps('just\nsome\noutput');
    expect(steps).toHaveLength(1);
    expect(steps[0]?.name).toBe('Set up job');
  });
});

describe('findFailingStep', () => {
  it('picks the step containing the error annotation', () => {
    expect(findFailingStep(splitSteps(log))?.name).toBe('npm test');
  });

  it('falls back to the last non-runner step when nothing is annotated', () => {
    const quiet = [
      '##[group]Run npm ci',
      'npm ci',
      '##[endgroup]',
      'ok',
      '##[group]Post job cleanup',
      'bye',
      '##[endgroup]',
    ].join('\n');
    expect(findFailingStep(splitSteps(quiet))?.name).toBe('npm ci');
  });
});

describe('isRunnerStep', () => {
  it('recognizes the runner’s own bookkeeping steps', () => {
    const steps = splitSteps(log);
    expect(steps.filter(isRunnerStep).map((step) => step.name)).toEqual([
      'Set up job',
      'Operating System',
      'Post job cleanup',
    ]);
  });
});
