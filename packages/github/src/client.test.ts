import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGitHubApp, readRateLimit } from './client.js';
import { LogsUnavailableError } from './errors.js';
import { failedStep, isFailedJob } from './schemas.js';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const INSTALLATION_ID = 51_234_567;
const RESET_AT = Math.floor(Date.UTC(2026, 8, 18, 12, 0, 0) / 1000);

const jobsResponse = {
  total_count: 3,
  jobs: [
    {
      id: 101,
      run_id: 42,
      run_attempt: 1,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/acme/api/actions/runs/42/job/101',
      started_at: '2026-09-18T10:00:00Z',
      completed_at: '2026-09-18T10:02:00Z',
      steps: [{ name: 'Build', status: 'completed', conclusion: 'success', number: 1 }],
    },
    {
      id: 102,
      run_id: 42,
      run_attempt: 1,
      name: 'test (22)',
      status: 'completed',
      conclusion: 'failure',
      html_url: 'https://github.com/acme/api/actions/runs/42/job/102',
      started_at: '2026-09-18T10:00:00Z',
      completed_at: '2026-09-18T10:05:00Z',
      steps: [
        { name: 'Install', status: 'completed', conclusion: 'success', number: 1 },
        { name: 'Run tests', status: 'completed', conclusion: 'failure', number: 2 },
      ],
    },
    {
      id: 103,
      run_id: 42,
      run_attempt: 1,
      name: 'lint',
      status: 'completed',
      conclusion: 'cancelled',
      html_url: null,
      started_at: null,
      completed_at: null,
    },
  ],
};

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

interface FetchCall {
  url: string;
  method: string;
}

interface StubOptions {
  logsStatus?: number;
  logsBody?: string;
  inlineLogs?: boolean;
  rateLimitRemaining?: number;
}

function stubGitHub(options: StubOptions = {}) {
  const calls: FetchCall[] = [];
  const rateHeaders = {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': String(options.rateLimitRemaining ?? 4_321),
    'x-ratelimit-reset': String(RESET_AT),
  };

  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    calls.push({ url, method: init?.method ?? 'GET' });

    if (url.endsWith('/access_tokens')) {
      return Promise.resolve(
        Response.json(
          { token: 'ghs_installation_token', expires_at: '2099-01-01T00:00:00Z' },
          { status: 201, headers: rateHeaders },
        ),
      );
    }
    if (url.includes('/actions/runs/42/jobs')) {
      return Promise.resolve(Response.json(jobsResponse, { status: 200, headers: rateHeaders }));
    }
    if (url.includes('/actions/jobs/102/logs')) {
      if (options.inlineLogs === true) {
        return Promise.resolve(
          new Response('inline log body', {
            status: 200,
            headers: { ...rateHeaders, 'content-type': 'text/plain' },
          }),
        );
      }
      const status = options.logsStatus ?? 302;
      if (status === 302) {
        return Promise.resolve(
          new Response(null, {
            status,
            headers: { ...rateHeaders, location: 'https://logs.example/blob/102?sig=abc' },
          }),
        );
      }
      return Promise.resolve(
        Response.json({ message: 'Not Found' }, { status, headers: rateHeaders }),
      );
    }
    if (url.startsWith('https://logs.example/')) {
      return Promise.resolve(
        new Response(options.logsBody ?? '##[error]boom', {
          status: options.logsBody === undefined ? 200 : 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );
    }
    return Promise.resolve(Response.json({ message: `unexpected ${url}` }, { status: 500 }));
  };

  const app = createGitHubApp({ appId: 1234, privateKey, fetch: fetchImpl });
  return { app, calls };
}

describe('listRunJobs', () => {
  it('returns validated jobs for the latest attempt', async () => {
    const { app, calls } = stubGitHub();
    const client = await app.forInstallation(INSTALLATION_ID);

    const jobs = await client.listRunJobs({ owner: 'acme', repo: 'api', runId: 42 });

    expect(jobs.map((job) => job.name)).toEqual(['build', 'test (22)', 'lint']);
    expect(jobs.filter(isFailedJob).map((job) => job.id)).toEqual([102]);
    const failedJob = jobs.find(isFailedJob);
    expect(failedJob && failedStep(failedJob)?.name).toBe('Run tests');
    expect(calls.some((call) => call.url.includes('filter=latest'))).toBe(true);
  });

  it('exposes the rate limit from the last response', async () => {
    const { app } = stubGitHub({ rateLimitRemaining: 17 });
    const client = await app.forInstallation(INSTALLATION_ID);
    expect(client.rateLimit()).toBeNull();

    await client.listRunJobs({ owner: 'acme', repo: 'api', runId: 42 });

    expect(client.rateLimit()).toEqual({
      limit: 5000,
      remaining: 17,
      resetAt: new Date(RESET_AT * 1000),
    });
  });

  it('rejects a malformed jobs response', async () => {
    const fetchImpl = (input: string | URL | Request): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith('/access_tokens')) {
        return Promise.resolve(
          Response.json({ token: 't', expires_at: '2099-01-01T00:00:00Z' }, { status: 201 }),
        );
      }
      return Promise.resolve(Response.json({ total_count: 1, jobs: [{ id: 'nope' }] }));
    };
    const client = await createGitHubApp({
      appId: 1,
      privateKey,
      fetch: fetchImpl,
    }).forInstallation(INSTALLATION_ID);

    await expect(client.listRunJobs({ owner: 'acme', repo: 'api', runId: 42 })).rejects.toThrow();
  });
});

describe('downloadJobLogs', () => {
  it('follows the redirect to storage without the Authorization header', async () => {
    const { app, calls } = stubGitHub({ logsBody: '##[error]Process completed with exit code 1.' });
    const client = await app.forInstallation(INSTALLATION_ID);

    const logs = await client.downloadJobLogs({ owner: 'acme', repo: 'api', jobId: 102 });

    expect(logs).toBe('##[error]Process completed with exit code 1.');
    expect(calls.at(-1)?.url).toBe('https://logs.example/blob/102?sig=abc');
  });

  it('accepts logs returned inline', async () => {
    const { app } = stubGitHub({ inlineLogs: true });
    const client = await app.forInstallation(INSTALLATION_ID);

    await expect(client.downloadJobLogs({ owner: 'acme', repo: 'api', jobId: 102 })).resolves.toBe(
      'inline log body',
    );
  });

  it('throws LogsUnavailableError when the logs are gone', async () => {
    const { app } = stubGitHub({ logsStatus: 404 });
    const client = await app.forInstallation(INSTALLATION_ID);

    await expect(
      client.downloadJobLogs({ owner: 'acme', repo: 'api', jobId: 102 }),
    ).rejects.toBeInstanceOf(LogsUnavailableError);
  });
});

describe('readRateLimit', () => {
  it('returns null when the headers are absent or unparsable', () => {
    expect(readRateLimit({})).toBeNull();
    expect(readRateLimit({ 'x-ratelimit-limit': 'many' })).toBeNull();
  });
});
