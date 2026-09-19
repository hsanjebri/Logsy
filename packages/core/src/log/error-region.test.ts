import { describe, expect, it } from 'vitest';
import { findAnchors, findErrorRegion } from './error-region.js';
import { splitSteps, type LogStep } from './steps.js';

function step(lines: string[], name = 'npm test'): LogStep {
  return { name, startLine: 1, endLine: lines.length, lines };
}

describe('findAnchors', () => {
  it('ranks a real error above the runner annotation that follows it', () => {
    const anchors = findAnchors([
      'Running tests',
      'Error: EMFILE error not encountered.',
      '##[error]Process completed with exit code 1.',
    ]);

    expect(anchors.map((anchor) => [anchor.line, anchor.priority])).toEqual([
      [2, 'root'],
      [3, 'cascade'],
    ]);
  });

  it('treats an annotation with its own message as annotated, not cascade', () => {
    const [anchor] = findAnchors(['##[error]Unable to resolve action actions/checkout@v99']);
    expect(anchor?.priority).toBe('annotated');
  });

  it.each([
    ['npm ERR! code ERESOLVE', 'npm_error'],
    ['src/app.ts(3,5): error TS2345: Argument of type', 'typescript_error'],
    ['[ERROR] Failed to execute goal on project api', 'maven_failure'],
    ['FAILURE: Build failed with an exception.', 'gradle_failure'],
    ['Traceback (most recent call last):', 'python_traceback'],
    ['FAILED tests/test_api.py::test_login - assert 401 == 200', 'pytest_failure'],
    ['<--- JavaScript heap out of memory --->', 'out_of_memory'],
    [
      'npm error network request to https://registry.npmjs.org failed, reason: ETIMEDOUT',
      'npm_error',
    ],
    ['No space left on device', 'disk_full'],
    ['toomanyrequests: You have reached your pull rate limit', 'docker_error'],
  ])('recognizes %s', (line, patternId) => {
    const [anchor] = findAnchors([line]);
    expect(anchor?.priority).toBe('root');
    expect(anchor?.patternId).toBe(patternId);
  });

  it('ignores ordinary output', () => {
    expect(findAnchors(['added 400 packages in 12s', '38819 passing (48s)'])).toEqual([]);
  });
});

describe('findErrorRegion', () => {
  it('keeps context before and after the first root error', () => {
    const lines = [
      ...Array.from({ length: 50 }, (_, i) => `noise ${i}`),
      'Error: connect ECONNREFUSED 127.0.0.1:5432',
      'at Socket.emit',
      ...Array.from({ length: 30 }, (_, i) => `after ${i}`),
      '##[error]Process completed with exit code 1.',
    ];

    const region = findErrorRegion(step(lines), { before: 5, after: 3 });

    expect(region?.priority).toBe('root');
    expect(region?.startLine).toBe(46);
    expect(region?.endLine).toBe(54);
    expect(region?.lines[5]).toBe('Error: connect ECONNREFUSED 127.0.0.1:5432');
  });

  it('prefers the first root error over later cascaded ones', () => {
    const lines = [
      'ModuleNotFoundError: No module named "app"',
      ...Array.from({ length: 100 }, (_, i) => `noise ${i}`),
      'Error: pytest exited with code 1',
      '##[error]Process completed with exit code 1.',
    ];

    const region = findErrorRegion(step(lines), { before: 2, after: 2, maxAnchors: 5 });

    expect(region?.anchors[0]?.line).toBe(1);
    expect(region?.lines[0]).toContain('ModuleNotFoundError');
  });

  it('merges the windows of several anchors of the same priority', () => {
    const lines = [
      'npm ERR! code ERESOLVE',
      'npm ERR! ERESOLVE unable to resolve dependency tree',
      'npm ERR! peer react@"^18" from react-dom@18',
    ];

    const region = findErrorRegion(step(lines), { before: 0, after: 0 });

    expect(region?.anchors).toHaveLength(3);
    expect(region?.startLine).toBe(1);
    expect(region?.endLine).toBe(3);
  });

  it('falls back to the exit-code line when nothing else matches', () => {
    const region = findErrorRegion(
      step(['building', '##[error]Process completed with exit code 2.']),
    );
    expect(region?.priority).toBe('cascade');
  });

  it('never reaches outside the failing step', () => {
    const log = [
      '##[group]Run npm ci',
      'npm ERR! early failure that was retried',
      '##[endgroup]',
      '##[group]Run npm test',
      'FAIL src/app.test.ts',
      '##[error]Process completed with exit code 1.',
    ].join('\n');
    const steps = splitSteps(log);
    const failing = steps.find((s) => s.name === 'npm test');
    if (!failing) throw new Error('expected an "npm test" step');

    const region = findErrorRegion(failing, { before: 40, after: 20 });

    expect(region?.startLine).toBeGreaterThanOrEqual(failing.startLine);
    expect(region?.lines.join('\n')).not.toContain('early failure');
  });

  it('returns undefined when the step contains nothing error-like', () => {
    expect(findErrorRegion(step(['all good', 'done']))).toBeUndefined();
  });
});

describe('noise filtering', () => {
  it('ignores Maven reactor summary lines and bare prefixes', () => {
    const anchors = findAnchors([
      '[ERROR] Maven 4 CLI ................................ FAILURE [ 35.817 s]',
      '[ERROR] ',
      '[ERROR] Failed to execute goal org.apache.maven.plugins:maven-javadoc-plugin:3.12.0:jar',
    ]);

    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.line).toBe(3);
    expect(anchors[0]?.text).toContain('Failed to execute goal');
  });

  it('ignores separator rules', () => {
    expect(findAnchors(['================================================'])).toEqual([]);
  });
});
