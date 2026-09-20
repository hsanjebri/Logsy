import { describe, expect, it } from 'vitest';
import { detectFlakyTests, flakyNote, testKey } from './flaky.js';
import { parseJUnitFiles, parseJUnitXml } from './junit.js';

/** Real shapes from pytest, jest-junit, surefire and Gradle. */
const PYTEST = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="0" failures="1" skipped="1" tests="3" time="4.2">
    <testcase classname="tests.test_api" name="test_login" time="0.412" />
    <testcase classname="tests.test_api" name="test_logout" time="1.004">
      <failure message="assert 401 == 200">assert 401 == 200</failure>
    </testcase>
    <testcase classname="tests.test_api" name="test_refresh" time="0.001">
      <skipped type="pytest.skip" message="needs redis" />
    </testcase>
  </testsuite>
</testsuites>`;

const SUREFIRE = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.acme.OrderServiceTest" tests="2" failures="0" errors="1" time="2.5">
  <testcase name="retries" classname="com.acme.OrderServiceTest" time="1.2"/>
  <testcase name="times_out" classname="com.acme.OrderServiceTest" time="1.3">
    <error type="java.net.SocketTimeoutException">Read timed out</error>
  </testcase>
</testsuite>`;

const NO_CLASSNAME = `<testsuites>
  <testsuite name="browser tests">
    <testcase name="loads the page" time="0.5"/>
  </testsuite>
</testsuites>`;

describe('parseJUnitXml', () => {
  it('reads names, suites, statuses and durations', () => {
    expect(parseJUnitXml(PYTEST)).toEqual([
      { suite: 'tests.test_api', testName: 'test_login', status: 'passed', durationMs: 412 },
      { suite: 'tests.test_api', testName: 'test_logout', status: 'failed', durationMs: 1004 },
      { suite: 'tests.test_api', testName: 'test_refresh', status: 'skipped', durationMs: 1 },
    ]);
  });

  it('treats an error element as a failure', () => {
    const results = parseJUnitXml(SUREFIRE);
    expect(results.map((result) => result.status)).toEqual(['passed', 'failed']);
    expect(results[1]).toMatchObject({ suite: 'com.acme.OrderServiceTest', testName: 'times_out' });
  });

  it('falls back to the enclosing suite name when there is no classname', () => {
    expect(parseJUnitXml(NO_CLASSNAME)[0]).toMatchObject({
      suite: 'browser tests',
      testName: 'loads the page',
    });
  });

  it('handles a report with no test cases', () => {
    expect(parseJUnitXml('<testsuites/>')).toEqual([]);
  });

  it('keeps going when a duration is missing or unparsable', () => {
    const xml = `<testsuite name="s"><testcase name="a"/><testcase name="b" time="zzz"/></testsuite>`;
    expect(parseJUnitXml(xml).map((result) => result.durationMs)).toEqual([null, null]);
  });

  it('throws on XML that is not well formed', () => {
    expect(() => parseJUnitXml('<testsuite><testcase name="a"></testsuite>')).toThrow();
  });
});

describe('parseJUnitFiles', () => {
  it('merges several reports and ignores unreadable ones', () => {
    const results = parseJUnitFiles([
      { name: 'a.xml', content: PYTEST },
      { name: 'not-xml.txt', content: 'this is not xml at all' },
      { name: 'b.xml', content: SUREFIRE },
    ]);

    expect(results).toHaveLength(5);
    expect(results.filter((result) => result.status === 'failed')).toHaveLength(2);
  });
});

describe('detectFlakyTests', () => {
  const passed = { suite: 's', testName: 'a', status: 'passed', durationMs: 1 } as const;
  const failed = { suite: 's', testName: 'a', status: 'failed', durationMs: 1 } as const;

  it('flags a test that both passed and failed for the same commit', () => {
    expect(detectFlakyTests([passed, failed])).toEqual([
      { suite: 's', testName: 'a', passed: 1, failed: 1 },
    ]);
  });

  it('does not flag a test that only ever failed, or only ever passed', () => {
    expect(detectFlakyTests([failed, failed])).toEqual([]);
    expect(detectFlakyTests([passed, passed])).toEqual([]);
  });

  it('ignores skips, which say nothing either way', () => {
    const skipped = { suite: 's', testName: 'a', status: 'skipped', durationMs: 0 } as const;
    expect(detectFlakyTests([passed, skipped])).toEqual([]);
  });

  it('keeps tests of the same name in different suites apart', () => {
    const other = { ...failed, suite: 'other' };
    expect(detectFlakyTests([passed, other])).toEqual([]);
  });

  it('counts how often each outcome occurred', () => {
    const [detection] = detectFlakyTests([passed, passed, failed]);
    expect(detection).toMatchObject({ passed: 2, failed: 1 });
  });
});

describe('testKey', () => {
  it('cannot be confused by a suite or name containing the separator', () => {
    expect(testKey({ suite: 'a', testName: 'b.c' })).not.toBe(
      testKey({ suite: 'a.b', testName: 'c' }),
    );
  });
});

describe('flakyNote', () => {
  it('reads as a sentence in the comment', () => {
    expect(flakyNote({ suite: 'OrderServiceTest', testName: 'retries', flipCount: 7 })).toBe(
      '`OrderServiceTest.retries` is known flaky: 7 flips recorded',
    );
    expect(flakyNote({ suite: 'S', testName: 't', flipCount: 1 })).toContain('1 flip recorded');
  });
});
