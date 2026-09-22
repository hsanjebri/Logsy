import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { labelFromFileName, listExamples, readExample } from './examples.js';

/** listExamples() looks for evals/fixtures two levels above the app directory. */
let appPath: string;

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'logsy-examples-'));
  const fixtures = join(root, 'evals', 'fixtures');
  await import('node:fs/promises').then((fs) => fs.mkdir(fixtures, { recursive: true }));
  await writeFile(join(fixtures, 'pytest-dev-pytest-32909439763-96946672485.log'), 'FAIL\n');
  await writeFile(
    join(fixtures, 'pytest-dev-pytest-32909439763-96946672485.json'),
    JSON.stringify({ source: 'pytest-dev/pytest', jobName: 'test (3.12)' }),
  );
  await writeFile(join(fixtures, 'nameless-12345678-87654321.log'), 'FAIL\n');
  appPath = resolve(root, 'apps', 'desktop');
});

describe('labelFromFileName', () => {
  it('drops the run and job ids', () => {
    expect(labelFromFileName('pytest-dev-pytest-32909439763-96946672485.log')).toBe(
      'pytest-dev-pytest',
    );
  });
});

describe('listExamples', () => {
  it('prefers the repository name recorded beside the log', async () => {
    const examples = await listExamples(appPath);
    expect(examples).toEqual([
      { id: 'nameless-12345678-87654321.log', label: 'nameless', detail: null },
      {
        id: 'pytest-dev-pytest-32909439763-96946672485.log',
        label: 'pytest-dev/pytest',
        detail: 'test (3.12)',
      },
    ]);
  });

  it('is empty rather than failing when there are no fixtures', async () => {
    await expect(
      listExamples(resolve(tmpdir(), 'logsy-not-here', 'apps', 'desktop')),
    ).resolves.toEqual([]);
  });
});

describe('readExample', () => {
  it('reads a log listed above', async () => {
    const file = await readExample(appPath, 'pytest-dev-pytest-32909439763-96946672485.log');
    expect(file).toEqual({ name: 'pytest-dev/pytest', text: 'FAIL\n' });
  });

  it('refuses anything that is not a plain log file name', async () => {
    await expect(readExample(appPath, '../../../.env')).resolves.toBeNull();
    await expect(readExample(appPath, 'nested/thing.log')).resolves.toBeNull();
    await expect(readExample(appPath, 'missing.log')).resolves.toBeNull();
  });
});
