import { unzipSync } from 'fflate';
import { z } from 'zod';

/**
 * Test reports arrive as zipped workflow artifacts. `fflate` is a small,
 * dependency-free unzip: Node has no built-in one for in-memory archives.
 */

export const artifactSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  expired: z.boolean().optional(),
  size_in_bytes: z.number().int().nonnegative().optional(),
});

export const listArtifactsResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  artifacts: z.array(artifactSchema),
});

export type Artifact = z.infer<typeof artifactSchema>;

export interface ExtractedFile {
  name: string;
  content: string;
}

/** Artifacts whose name suggests they hold test reports. */
const REPORT_NAME = /(test|junit|report|result)/i;

export function looksLikeTestReport(artifact: Artifact): boolean {
  return artifact.expired !== true && REPORT_NAME.test(artifact.name);
}

export interface ExtractOptions {
  /** Refuse archives larger than this once unpacked, to bound memory. */
  maxTotalBytes?: number;
  /** Only files matching this are returned. */
  include?: RegExp;
}

const DEFAULT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const XML_FILE = /\.xml$/i;

/**
 * Unzips an artifact and returns the XML files inside it. Entries that are not
 * wanted are never decoded, and the total is capped.
 */
export function extractXmlFiles(zip: Uint8Array, options: ExtractOptions = {}): ExtractedFile[] {
  const include = options.include ?? XML_FILE;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;

  const entries = unzipSync(zip, { filter: (file) => include.test(file.name) });
  const decoder = new TextDecoder();
  const files: ExtractedFile[] = [];
  let total = 0;

  for (const [name, bytes] of Object.entries(entries)) {
    total += bytes.length;
    if (total > maxTotalBytes) break;
    files.push({ name, content: decoder.decode(bytes) });
  }

  return files;
}
