import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';

export interface ExampleLog {
  file: string;
  label: string;
  /** The job that failed, when the fixture records it. */
  detail: string | null;
}

/** Each fixture log has a sibling .json saying where it came from. */
const metadataSchema = z.object({
  source: z.string().min(1).optional(),
  jobName: z.string().min(1).optional(),
});

export async function listExamples(dir: string): Promise<ExampleLog[]> {
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter((name) => name.endsWith('.log')).sort();
  return Promise.all(
    names.map(async (name) => {
      const fallback = {
        file: join(dir, name),
        label: basename(name, '.log').replace(/-\d{6,}/g, ''),
        detail: null,
      };
      try {
        const raw: unknown = JSON.parse(
          await readFile(join(dir, name.replace(/\.log$/, '.json')), 'utf8'),
        );
        const parsed = metadataSchema.safeParse(raw);
        if (!parsed.success) return fallback;
        return {
          file: fallback.file,
          label: parsed.data.source ?? fallback.label,
          detail: parsed.data.jobName ?? null,
        };
      } catch {
        // A log without metadata is still usable; it just shows its file name.
        return fallback;
      }
    }),
  );
}
