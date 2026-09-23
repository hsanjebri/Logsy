import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { analyses, failureEmbeddings, failures, workflowRuns } from '../schema.js';

export interface EmbeddingInput {
  failureId: number;
  repositoryId: number;
  fingerprint: string;
  embedding: number[];
  model: string;
}

/** One embedding per failure; re-analysing a failure replaces it. */
export async function upsertFailureEmbedding(db: Executor, input: EmbeddingInput): Promise<void> {
  await db
    .insert(failureEmbeddings)
    .values(input)
    .onConflictDoUpdate({
      target: failureEmbeddings.failureId,
      set: { embedding: input.embedding, fingerprint: input.fingerprint, model: input.model },
    });
}

/** See {@link SimilarSearch.minSimilarity}. */
export const DEFAULT_MIN_SIMILARITY = 0.72;

export interface SimilarFailure {
  failureId: number;
  fingerprint: string;
  /** 0 to 1, where 1 is the same vector. */
  similarity: number;
  title: string | null;
  category: string;
  prNumber: number | null;
  runUrl: string;
  lastSeenAt: Date;
}

export interface SimilarSearch {
  repositoryId: number;
  embedding: number[];
  /** The failure being explained: its own fingerprint is never a useful match. */
  fingerprint: string;
  /**
   * Cosine similarity a row must reach to be worth mentioning. The default was measured
   * on Gemini embeddings of real CI failures: the same problem worded differently scores
   * 0.77 to 0.89, a merely related failure 0.61, and unrelated ones 0.52 to 0.64.
   */
  minSimilarity?: number;
  limit?: number;
}

/**
 * Older failures in this repository that mean the same thing as the new one. Rows with
 * the same fingerprint are excluded: an identical error is already counted as a
 * recurrence, and this is here to catch the same problem worded differently.
 */
export async function findSimilarFailures(
  db: Executor,
  search: SimilarSearch,
): Promise<SimilarFailure[]> {
  const vector = `[${search.embedding.join(',')}]`;
  // `<=>` is pgvector's cosine distance: 0 is identical, 2 is opposite.
  const similarity = sql<number>`1 - (${failureEmbeddings.embedding} <=> ${vector}::vector)`;

  const rows = await db
    .select({
      failureId: failureEmbeddings.failureId,
      fingerprint: failureEmbeddings.fingerprint,
      similarity,
      title: sql<string | null>`${analyses.result} ->> 'title'`,
      category: failures.category,
      prNumber: workflowRuns.prNumber,
      runUrl: workflowRuns.htmlUrl,
      lastSeenAt: failures.createdAt,
    })
    .from(failureEmbeddings)
    .innerJoin(failures, eq(failures.id, failureEmbeddings.failureId))
    .innerJoin(workflowRuns, eq(workflowRuns.id, failures.workflowRunId))
    .leftJoin(analyses, eq(analyses.failureId, failures.id))
    .where(
      and(
        eq(failureEmbeddings.repositoryId, search.repositoryId),
        ne(failureEmbeddings.fingerprint, search.fingerprint),
        sql`1 - (${failureEmbeddings.embedding} <=> ${vector}::vector) >= ${search.minSimilarity ?? DEFAULT_MIN_SIMILARITY}`,
      ),
    )
    .orderBy(desc(similarity), desc(failures.createdAt))
    .limit(search.limit ?? 3);

  return rows;
}
