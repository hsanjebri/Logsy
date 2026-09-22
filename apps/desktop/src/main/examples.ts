import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';

export interface ExampleLog {
  id: string;
  label: string;
  /** The job that failed, when the fixture records it. */
  detail: string | null;
}

/** Each fixture log has a sibling .json describing where it came from. */
const metadataSchema = z.object({
  source: z.string().min(1).optional(),
  jobName: z.string().min(1).optional(),
});

/**
 * The real failed CI logs kept with the evals. They ship with the repository rather
 * than the app, so a packaged build simply shows no examples.
 */
function examplesDir(appPath: string): string | undefined {
  const candidates = [
    resolve(appPath, '../../evals/fixtures'),
    resolve(process.cwd(), 'evals/fixtures'),
  ];
  return candidates.find((path) => existsSync(path));
}

/**
 * "pytest-dev-pytest-32909439763-96946672485.log" → "pytest-dev-pytest". Only a
 * fallback: the owner and the repository cannot be told apart in a file name, so the
 * sibling .json is what gives "pytest-dev/pytest".
 */
export function labelFromFileName(fileName: string): string {
  return basename(fileName, '.log').replace(/-\d{6,}/g, '');
}

async function describe(dir: string, id: string): Promise<ExampleLog> {
  const fallback = { id, label: labelFromFileName(id), detail: null };
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(dir, id.replace(/\.log$/, '.json')), 'utf8'),
    );
    const parsed = metadataSchema.safeParse(raw);
    if (!parsed.success) return fallback;
    return {
      id,
      label: parsed.data.source ?? fallback.label,
      detail: parsed.data.jobName ?? null,
    };
  } catch {
    // A log without metadata is still usable; it just shows its file name.
    return fallback;
  }
}

export async function listExamples(appPath: string): Promise<ExampleLog[]> {
  const dir = examplesDir(appPath);
  if (!dir) return [];
  const names = (await readdir(dir)).filter((name) => name.endsWith('.log')).sort();
  return Promise.all(names.map((name) => describe(dir, name)));
}

export async function readExample(
  appPath: string,
  id: string,
): Promise<{ name: string; text: string } | null> {
  const dir = examplesDir(appPath);
  // Only ever a plain file name from the list above; never a path from the window.
  if (!dir || id.includes('/') || id.includes('\\') || !id.endsWith('.log')) return null;
  const file = join(dir, id);
  if (!existsSync(file)) return null;
  const { label } = await describe(dir, id);
  return { name: label, text: await readFile(file, 'utf8') };
}
