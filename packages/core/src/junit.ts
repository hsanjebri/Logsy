import { XmlElement, parseXml } from '@rgrove/parse-xml';

/**
 * JUnit XML is what every test runner writes for CI, but each writes it slightly
 * differently. Only the parts every dialect agrees on are read: a `testcase` with a
 * name, an owning suite, an optional time, and a child element saying it did not pass.
 */

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface TestResultRecord {
  suite: string;
  testName: string;
  status: TestStatus;
  durationMs: number | null;
}

/** Elements that mean the test did not simply pass. */
const FAILED_CHILDREN = new Set(['failure', 'error']);
const SKIPPED_CHILDREN = new Set(['skipped']);

/**
 * Parses one JUnit XML document. Malformed XML throws; anything valid but
 * unfamiliar is skipped rather than guessed at.
 */
export function parseJUnitXml(xml: string): TestResultRecord[] {
  const document = parseXml(xml);
  const results: TestResultRecord[] = [];

  walk(document.root, (element, ancestors) => {
    if (element.name !== 'testcase') return;

    const testName = attribute(element, 'name');
    if (testName === null) return;

    results.push({
      suite: suiteOf(element, ancestors),
      testName,
      status: statusOf(element),
      durationMs: durationOf(element),
    });
  });

  return results;
}

/** Parses several report files, ignoring any that are not JUnit XML at all. */
export function parseJUnitFiles(
  files: readonly { name: string; content: string }[],
): TestResultRecord[] {
  const results: TestResultRecord[] = [];
  for (const file of files) {
    try {
      results.push(...parseJUnitXml(file.content));
    } catch {
      // A report we cannot read is not worth failing the job over.
    }
  }
  return results;
}

function walk(
  element: XmlElement | null,
  visit: (element: XmlElement, ancestors: XmlElement[]) => void,
  ancestors: XmlElement[] = [],
): void {
  if (!element) return;
  visit(element, ancestors);
  const nextAncestors = [...ancestors, element];
  for (const child of element.children) {
    if (child instanceof XmlElement) walk(child, visit, nextAncestors);
  }
}

function attribute(element: XmlElement, name: string): string | null {
  const value = element.attributes[name];
  return value === undefined || value === '' ? null : value;
}

/**
 * `classname` is the most specific owner when a runner sets it (pytest, surefire);
 * otherwise the enclosing `testsuite` names the suite.
 */
function suiteOf(testcase: XmlElement, ancestors: readonly XmlElement[]): string {
  const className = attribute(testcase, 'classname');
  if (className !== null) return className;

  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];
    if (ancestor?.name === 'testsuite') {
      const name = attribute(ancestor, 'name');
      if (name !== null) return name;
    }
  }
  return 'unknown';
}

function statusOf(testcase: XmlElement): TestStatus {
  for (const child of testcase.children) {
    if (!(child instanceof XmlElement)) continue;
    if (FAILED_CHILDREN.has(child.name)) return 'failed';
    if (SKIPPED_CHILDREN.has(child.name)) return 'skipped';
  }
  // Some runners mark skips with an attribute instead of a child element.
  return attribute(testcase, 'status') === 'notrun' ? 'skipped' : 'passed';
}

function durationOf(testcase: XmlElement): number | null {
  const time = attribute(testcase, 'time');
  if (time === null) return null;
  const seconds = Number(time);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}
