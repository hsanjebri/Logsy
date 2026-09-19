import type { AnalysisResult } from './analysis.js';
import type { FailureCategory } from './categories.js';

/**
 * Known failure patterns, checked before any LLM call. A rule is cheap, instant and
 * deterministic, so anything recognizable belongs here.
 *
 * Rules are evaluated in order and the first match wins, so specific patterns come
 * before general ones. Every rule carries example lines, which the tests use as its
 * coverage.
 */
export interface Rule {
  id: string;
  category: FailureCategory;
  /** Comment title, at most ~80 characters. */
  title: string;
  pattern: RegExp;
  /** One to three sentences explaining the cause. */
  explanation: string;
  suggestedFix: string;
  /** How sure the rule is. Rules are precise, so this is high by default. */
  confidence?: number;
  /** Real log lines this rule must match. Used by the tests. */
  examples: string[];
}

export const RULES: readonly Rule[] = [
  {
    id: 'npm-eresolve',
    category: 'dependency_error',
    title: 'npm could not resolve the dependency tree',
    pattern: /ERESOLVE (?:unable to resolve|could not resolve)|npm ERR! ERESOLVE/,
    explanation:
      'npm found conflicting peer dependency requirements and refused to install a tree that satisfies none of them.',
    suggestedFix:
      'Read the conflict npm prints and align the versions in package.json. If the conflict is in a transitive dependency, add an `overrides` entry. `--legacy-peer-deps` hides the problem rather than fixing it.',
    examples: ['npm ERR! ERESOLVE unable to resolve dependency tree', 'ERESOLVE could not resolve'],
  },
  {
    id: 'npm-lockfile-out-of-sync',
    category: 'dependency_error',
    title: 'Lockfile is out of sync with the manifest',
    pattern:
      /npm ci can only install packages when your package\.json and package-lock\.json .* are in sync|Missing: \S+ from lock file|ERR_PNPM_OUTDATED_LOCKFILE|Your lockfile needs to be updated|The lockfile is not up to date/i,
    explanation:
      'The lockfile does not match the manifest, so the install refused to run. A dependency was changed without the lockfile being regenerated and committed.',
    suggestedFix:
      'Run the install locally (`npm install`, `pnpm install` or `yarn install`), then commit the updated lockfile.',
    examples: [
      'npm ci can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync',
      'ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile"',
      'Missing: typescript@6.0.3 from lock file',
    ],
  },
  {
    id: 'node-version-mismatch',
    category: 'configuration',
    title: 'Node.js version does not satisfy the required range',
    pattern:
      /The engine "node" is incompatible with this module|Unsupported engine|EBADENGINE|requires Node\.js version|Node\.js version \S+ is not supported/i,
    explanation:
      'The Node.js version on the runner does not satisfy the range the project requires.',
    suggestedFix:
      'Set the version in the workflow (`actions/setup-node` with `node-version-file: .nvmrc`) so CI and the `engines` field agree.',
    examples: [
      'error @logsy/core@0.0.0: The engine "node" is incompatible with this module. Expected version ">=22".',
      'npm warn EBADENGINE Unsupported engine',
    ],
  },
  {
    id: 'out-of-memory',
    category: 'out_of_memory',
    title: 'The job ran out of memory',
    // `\bMemoryError\b` deliberately does not match `-XX:+HeapDumpOnOutOfMemoryError`,
    // which merely configures what to do if memory runs out.
    pattern:
      /JavaScript heap out of memory|FATAL ERROR: .*Allocation failed|OOMKilled|Killed\s*$|exit code 137|java\.lang\.OutOfMemoryError|\bMemoryError\b/,
    explanation:
      'The process was killed after exhausting the memory available to the runner. Exit code 137 is the kernel’s out-of-memory kill.',
    suggestedFix:
      'Lower the memory the job needs (fewer parallel workers, smaller batches) or raise the limit, for example `NODE_OPTIONS=--max-old-space-size=4096`, or move to a larger runner.',
    examples: [
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
      '##[error]Process completed with exit code 137',
      'java.lang.OutOfMemoryError: Java heap space',
    ],
  },
  {
    id: 'job-timeout',
    category: 'timeout',
    title: 'The job exceeded its time limit',
    pattern:
      /The job running on runner .* has exceeded the maximum execution time|The operation was canceled\.|timeout of \d+ms exceeded|Timeout - Async callback was not invoked within|ETIMEDOUT/,
    explanation:
      'The job or one of its operations hit a timeout and was cancelled before finishing.',
    suggestedFix:
      'Find the step that hangs and give it its own `timeout-minutes`. If it waits on a service, make the wait explicit with a readiness check instead of a fixed sleep.',
    examples: [
      'The job running on runner GitHub Actions 12 has exceeded the maximum execution time of 360 minutes.',
      'Error: timeout of 5000ms exceeded',
    ],
  },
  {
    id: 'missing-secret',
    category: 'configuration',
    title: 'A required environment variable or secret is missing',
    pattern:
      /(?:Missing|Required|Unset|Undefined) (?:required )?(?:environment variable|env var|secret)\b|Input required and not supplied|is not set in the environment|KeyError: '[A-Z_]{3,}'|Environment variable \S+ is (?:not set|required)/i,
    explanation:
      'The job read a variable or secret that is not configured, so it had nothing to work with.',
    suggestedFix:
      'Add the value in Settings → Secrets and variables → Actions, and pass it to the step through `env:`. Secrets are not available to workflows triggered by `pull_request` from a fork.',
    examples: [
      'Error: Input required and not supplied: token',
      'Missing required environment variable: DATABASE_URL',
      "KeyError: 'API_TOKEN'",
    ],
  },
  {
    id: 'docker-rate-limit',
    category: 'infrastructure',
    title: 'Docker Hub pull rate limit reached',
    pattern: /toomanyrequests|You have reached your pull rate limit|rate limit exceeded.*docker/i,
    explanation:
      'Docker Hub refused the image pull because the anonymous rate limit for the runner’s IP is exhausted. This is unrelated to the change being tested.',
    suggestedFix:
      'Log in to Docker Hub with `docker/login-action` before pulling, or mirror the image to GitHub Container Registry.',
    examples: [
      'toomanyrequests: You have reached your pull rate limit. You may increase the limit by authenticating and upgrading',
    ],
  },
  {
    id: 'network-failure',
    category: 'infrastructure',
    title: 'A network request failed',
    pattern:
      /\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b|socket hang up|TLS handshake timeout|Could not resolve host/,
    explanation:
      'A network call failed while the job was running. These failures are usually transient and unrelated to the change.',
    suggestedFix:
      'Re-run the job. If it keeps happening, add a retry around the download, or cache the dependency so the network is not needed.',
    examples: [
      'npm ERR! network request to https://registry.npmjs.org/react failed, reason: ECONNRESET',
      'fatal: unable to access: Could not resolve host: github.com',
    ],
  },
  {
    id: 'maven-dependency-resolution',
    category: 'dependency_error',
    title: 'Maven could not resolve a dependency',
    pattern:
      /Could not resolve dependencies for project|Failed to (?:read|collect) artifact descriptor|Non-resolvable (?:parent POM|import POM)|was cached in the local repository, resolution will not be reattempted/,
    explanation:
      'Maven could not download an artifact the build needs, either because the coordinates are wrong or the repository was unreachable.',
    suggestedFix:
      'Check the groupId, artifactId and version, and that the repository serving them is declared and reachable. For a cached failure, re-run with `-U` to force an update check.',
    examples: [
      '[ERROR] Failed to execute goal on project api: Could not resolve dependencies for project com.acme:api:jar:1.0',
      '[ERROR] Non-resolvable parent POM for com.acme:api:1.0',
    ],
  },
  {
    id: 'maven-goal-failure',
    category: 'build_error',
    title: 'A Maven goal failed',
    pattern: /^\[ERROR\] Failed to execute goal /m,
    explanation:
      'A Maven plugin goal exited with an error, so the build stopped. The plugin and the project it failed on are named on the error line.',
    suggestedFix:
      'Reproduce with the same goal locally (`mvn -e <goal>`); the plugin’s own output above the error explains what it rejected.',
    examples: [
      '[ERROR] Failed to execute goal org.apache.maven.plugins:maven-javadoc-plugin:3.12.0:jar (attach-javadocs) on project maven-cli',
    ],
  },
  {
    id: 'precommit-hook-failed',
    category: 'lint_error',
    title: 'A pre-commit hook failed',
    // Anchored on the word, not the dots: matching dots first backtracks badly.
    pattern: /(?<=\.{5})Failed\s*$/m,
    explanation:
      'A pre-commit hook reported a problem. Hooks that reformat files fail when they had to change something.',
    suggestedFix:
      'Run `pre-commit run --all-files` locally, then commit whatever the hooks changed.',
    examples: [
      'ruff format..............................................................Failed',
      'trim trailing whitespace.................................................Failed',
    ],
  },
  {
    id: 'gradle-daemon-crash',
    category: 'infrastructure',
    title: 'The Gradle daemon disappeared',
    pattern:
      /Gradle build daemon disappeared unexpectedly|Unable to start the daemon process|Daemon will be stopped at the end of the build after running out of JVM memory|MessageIOException: Could not write/,
    explanation:
      'The Gradle daemon died mid-build, usually after running out of memory or being killed by the runner.',
    suggestedFix:
      'Raise the daemon heap with `org.gradle.jvmargs=-Xmx4g` in gradle.properties, or run with `--no-daemon` in CI.',
    examples: [
      'Gradle build daemon disappeared unexpectedly (it may have been killed or may have crashed)',
      "org.gradle.internal.remote.internal.MessageIOException: Could not write '/127.0.0.1:51894'.",
    ],
  },
  {
    id: 'java-version-mismatch',
    category: 'configuration',
    title: 'Java version mismatch',
    pattern:
      /(?:has been compiled by a more recent version of the Java Runtime|Unsupported class file major version|invalid target release|error: invalid source release)/,
    explanation: 'The Java version used to compile and the one used to run or build do not match.',
    suggestedFix:
      'Pin the JDK in the workflow with `actions/setup-java` and make the project’s `release`, `sourceCompatibility` or `targetCompatibility` agree with it.',
    examples: [
      'class file has wrong version 65.0, should be 61.0: has been compiled by a more recent version of the Java Runtime',
      'Unsupported class file major version 68',
      'error: invalid target release: 21',
    ],
  },
  {
    id: 'typescript-compile-error',
    category: 'type_error',
    title: 'TypeScript compilation failed',
    pattern: /\berror TS\d{4}\b/,
    explanation: 'The TypeScript compiler rejected the code; the error codes are in the log.',
    suggestedFix:
      'Fix the reported types. Reproduce locally with the same command CI runs, usually `tsc --noEmit`.',
    examples: [
      "src/app.ts(3,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
    ],
  },
  {
    id: 'eslint-failure',
    category: 'lint_error',
    title: 'ESLint reported errors',
    pattern: /✖ \d+ problems? \(\d+ errors?|^\s*\d+:\d+\s+error\s+\S+.*\s{2,}[\w@/-]+$/m,
    explanation: 'ESLint found rule violations that are configured as errors.',
    suggestedFix:
      'Run `eslint .` locally, or `eslint . --fix` for the automatically fixable ones. Do not silence a rule without a reason.',
    examples: ['✖ 3 problems (3 errors, 0 warnings)'],
  },
  {
    // Checked before the JavaScript rule: pytest also prints "AssertionError".
    id: 'pytest-failure',
    category: 'test_failure',
    title: 'Python tests failed',
    pattern:
      /^=+ short test summary info =+|^FAILED \S+::|^E\s{3}(?:assert |\w*(?:Error|Exception)\b)|\d+ failed,? \d+ passed/m,
    explanation:
      'pytest reported failing tests. The summary lists each failure with its assertion.',
    suggestedFix:
      'Run the failing test locally with `pytest path::test -x -vv` and compare the assertion’s two sides.',
    examples: [
      '=========================== short test summary info ============================',
      'FAILED tests/test_api.py::test_login - assert 401 == 200',
      'E   AssertionError: numpy array are different',
      '3 failed, 128 passed in 42.10s',
    ],
  },
  {
    id: 'go-test-failure',
    category: 'test_failure',
    title: 'Go tests failed',
    pattern: /^\s*--- FAIL: |^\s*FAIL\s+(?:Package\s+)?\S+\s+[\d.]+m?s?\b|^\s*FAIL\s+Package\s/m,
    explanation: 'One or more Go tests failed. The failing test names are listed in the log.',
    suggestedFix:
      'Run `go test ./... -run TestName -v` locally for the failing package and read the assertion above the FAIL line.',
    examples: [
      '--- FAIL: TestComposeUp (2.31s)',
      '  FAIL Package pkg/e2e (4m37.923s)',
      'FAIL github.com/acme/api/pkg/store 0.512s',
    ],
  },
  {
    id: 'js-test-failure',
    category: 'test_failure',
    title: 'JavaScript tests failed',
    pattern:
      /^\s*(?:FAIL|✕|×)\s+.*\.(?:test|spec)\.[cm]?[jt]sx?\b|Tests:\s+\d+ failed|expect\(received\)|\d+ (?:test|spec)s? failed/m,
    explanation: 'One or more tests failed. The assertion and the expected value are in the log.',
    suggestedFix:
      'Reproduce the failing test locally and compare the expected and received values. If it passes locally but fails in CI, suspect ordering, timing or a missing environment variable.',
    examples: [
      'FAIL src/server.test.ts > returns 401 for an invalid signature',
      ' FAIL  |chromium| hooks-timeout.test.ts > timeouts are failing correctly',
      'Tests:       2 failed, 40 passed, 42 total',
    ],
  },
  {
    id: 'disk-full',
    category: 'infrastructure',
    title: 'The runner ran out of disk space',
    pattern: /No space left on device|ENOSPC|There is not enough space on the disk/i,
    explanation: 'The runner’s disk filled up, so the job could not write what it needed.',
    suggestedFix:
      'Free space during the job (remove unused toolchains, prune Docker images) or reduce what the build writes. `jlumbroso/free-disk-space` is a common fix for image-heavy jobs.',
    examples: [
      'ENOSPC: no space left on device, write',
      'failed to write: No space left on device',
    ],
  },
  {
    id: 'permission-denied',
    category: 'configuration',
    title: 'Permission denied',
    pattern:
      /Permission denied|EACCES|Resource not accessible by integration|403 Forbidden|denied: (?:permission_denied|requested access to the resource is denied)/,
    explanation:
      'An operation was refused for lack of permission: a file mode, a registry credential, or the workflow token’s scopes.',
    suggestedFix:
      'For the GitHub token, grant the scope under `permissions:` in the workflow. For a script, commit it executable (`git update-index --chmod=+x`). For a registry, check the credentials.',
    examples: [
      '/bin/bash: ./scripts/deploy.sh: Permission denied',
      'Error: Resource not accessible by integration',
      'EACCES: permission denied, open /usr/local/lib/node_modules',
    ],
  },
  {
    id: 'cache-restore-failure',
    category: 'infrastructure',
    title: 'Restoring the cache failed',
    pattern:
      /Failed to restore: |Cache service responded with \d+|Unable to reserve cache|Failed to save: |tar: .*: Cannot open: No such file or directory.*cache/i,
    explanation:
      'The cache could not be restored or saved. The job usually continues without it, so this is rarely the real cause of the failure.',
    suggestedFix:
      'Usually safe to ignore or re-run. If it persists, check the cache key and that the paths exist before the save step.',
    examples: [
      'Failed to restore: Cache service responded with 429',
      'Unable to reserve cache with key node-modules-linux, another job may be creating this cache.',
    ],
  },
  {
    id: 'test-report-parse-error',
    category: 'configuration',
    title: 'The test report could not be parsed',
    pattern:
      /Error parsing (?:JUnit|XML) (?:report|file)|no test report files were found|Unable to parse .*\.xml|JUnit report .* is empty/i,
    explanation:
      'The reporting step could not read the test results: the file was missing, empty or malformed.',
    suggestedFix:
      'Check that the test command actually writes the report and that the path pattern matches. Make the reporting step run even on failure with `if: always()`.',
    examples: [
      'Error parsing JUnit report: unexpected end of file',
      'No test report files were found',
    ],
  },
  {
    id: 'run-cancelled',
    category: 'infrastructure',
    title: 'The run was cancelled',
    pattern:
      /The operation was canceled\.|##\[error\]The run was canceled|Canceling since a higher priority waiting request|The job was canceled because/,
    explanation:
      'The run did not fail on its own: it was cancelled, usually superseded by a newer commit on the same branch.',
    suggestedFix: 'No action needed. Look at the newest run for the branch instead.',
    confidence: 0.95,
    examples: [
      'Canceling since a higher priority waiting request for refs/pull/7/merge exists',
      '##[error]The operation was canceled.',
    ],
  },
  {
    id: 'module-not-found',
    category: 'dependency_error',
    title: 'A module could not be found',
    pattern:
      /Cannot find module '[^']+'|ModuleNotFoundError: No module named|ImportError: cannot import name|Cannot find package '[^']+'/,
    explanation:
      'The code imported something that is not installed or not built: a missing dependency, a wrong path, or a build step that did not run.',
    suggestedFix:
      'Check that the package is a dependency (not only a devDependency if it runs in production) and that any build step producing it runs before this one.',
    examples: [
      "Error: Cannot find module '@logsy/core'",
      "ModuleNotFoundError: No module named 'requests'",
    ],
  },
  {
    id: 'docker-build-failure',
    category: 'build_error',
    title: 'The Docker build failed',
    pattern:
      /failed to solve: |ERROR \[[\w\s/-]+ \d+\/\d+\]|returned a non-zero code: \d+|dockerfile parse error/i,
    explanation: 'A step of the Docker build exited non-zero, so the image was not produced.',
    suggestedFix:
      'Reproduce with `docker build .` locally. The failing instruction and its output are shown just above the error in the log.',
    examples: [
      'failed to solve: process "/bin/sh -c npm ci" did not complete successfully: exit code: 1',
      'ERROR [builder 4/8] RUN npm ci',
    ],
  },
  {
    id: 'git-diff-not-clean',
    category: 'configuration',
    title: 'Generated files are not committed',
    pattern:
      /git diff(?:\s+--?[\w-]+)*\s+--exit-code|Changes not staged for commit|working tree is dirty|Please commit the generated files/i,
    explanation:
      'CI regenerated files and found them different from what is committed, so generated output is out of date in the repository.',
    suggestedFix:
      'Run the generation command locally and commit the result. The diff in the log shows which files changed.',
    examples: [
      'Run git diff --staged --exit-code --stat',
      'Please commit the generated files and push again',
    ],
  },
];

export interface RuleMatch {
  rule: Rule;
  /** The log lines that matched, at most five, for the comment's evidence. */
  evidence: string[];
}

/**
 * First rule whose pattern appears in `text`, with the matching lines as evidence.
 * Text is matched line by line, plus once as a whole for multi-line patterns.
 */
export function matchRule(text: string): RuleMatch | undefined {
  const lines = text.split('\n');

  for (const rule of RULES) {
    const matching = lines.filter((line) => rule.pattern.test(line));
    if (matching.length > 0) return { rule, evidence: matching.slice(0, 5) };
    if (rule.pattern.test(text)) return { rule, evidence: [] };
  }
  return undefined;
}

/** Turns a rule match into the same shape an LLM analysis produces. */
export function ruleToAnalysis(match: RuleMatch): AnalysisResult {
  return {
    category: match.rule.category,
    title: match.rule.title,
    rootCause: match.rule.explanation,
    evidence: match.evidence,
    likelyFiles: [],
    suggestedFix: match.rule.suggestedFix,
    isLikelyFlaky:
      match.rule.category === 'flaky' ||
      match.rule.id === 'network-failure' ||
      match.rule.id === 'cache-restore-failure',
    confidence: match.rule.confidence ?? 0.9,
  };
}
