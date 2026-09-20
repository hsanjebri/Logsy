import { Queue, Worker, type JobsOptions, type Processor, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';
import {
  QUEUE_NAMES,
  analyzeRunJobId,
  postCommentJobId,
  type AnalyzeRunJob,
  type PostCommentJob,
} from './jobs.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null`: blocking commands must not time out.
 */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

/** Retry transient GitHub and database failures, and keep a window of finished jobs. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1_000 },
  removeOnFail: { age: 30 * 24 * 3600, count: 5_000 },
};

export interface AnalyzeRunQueue {
  enqueueAnalyzeRun(job: AnalyzeRunJob): Promise<void>;
  close(): Promise<void>;
}

export function createAnalyzeRunQueue(connection: Redis): AnalyzeRunQueue {
  const queue = new Queue<AnalyzeRunJob>(QUEUE_NAMES.analyzeRun, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  return {
    async enqueueAnalyzeRun(job) {
      await queue.add(QUEUE_NAMES.analyzeRun, job, { jobId: analyzeRunJobId(job) });
    },
    close: () => queue.close(),
  };
}

export interface PostCommentQueue {
  enqueuePostComment(job: PostCommentJob): Promise<void>;
  close(): Promise<void>;
}

export function createPostCommentQueue(connection: Redis): PostCommentQueue {
  const queue = new Queue<PostCommentJob>(QUEUE_NAMES.postComment, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  return {
    async enqueuePostComment(job) {
      await queue.add(QUEUE_NAMES.postComment, job, { jobId: postCommentJobId(job) });
    },
    close: () => queue.close(),
  };
}

export function createPostCommentWorker(
  connection: Redis,
  processor: Processor<PostCommentJob>,
  options: Omit<WorkerOptions, 'connection'> = {},
): Worker<PostCommentJob> {
  return new Worker<PostCommentJob>(QUEUE_NAMES.postComment, processor, {
    connection,
    ...options,
  });
}

export function createAnalyzeRunWorker(
  connection: Redis,
  processor: Processor<AnalyzeRunJob>,
  options: Omit<WorkerOptions, 'connection'> = {},
): Worker<AnalyzeRunJob> {
  return new Worker<AnalyzeRunJob>(QUEUE_NAMES.analyzeRun, processor, { connection, ...options });
}
