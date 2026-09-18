/** Raised when job logs cannot be fetched (expired, deleted, or not yet available). */
export class LogsUnavailableError extends Error {
  readonly jobId: number;
  readonly status: number;

  constructor(jobId: number, status: number) {
    super(`Logs for job ${jobId} are unavailable (HTTP ${status})`);
    this.name = 'LogsUnavailableError';
    this.jobId = jobId;
    this.status = status;
  }
}

/** Raised when the installation's REST quota is exhausted; carries when it resets. */
export class RateLimitedError extends Error {
  readonly resetAt: Date;

  constructor(resetAt: Date) {
    super(`GitHub rate limit exhausted until ${resetAt.toISOString()}`);
    this.name = 'RateLimitedError';
    this.resetAt = resetAt;
  }
}

export function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error;
    if (typeof status === 'number') return status;
  }
  return undefined;
}
