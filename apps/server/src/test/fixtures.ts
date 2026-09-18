// Trimmed but structurally faithful GitHub webhook payloads.

export const INSTALLATION_ID = 51_234_567;

const installation = {
  id: INSTALLATION_ID,
  account: { login: 'hsanjebri', id: 1001, type: 'User' },
  repository_selection: 'selected',
  suspended_at: null,
};

export function installationCreated() {
  return {
    action: 'created',
    installation,
    repositories: [
      { id: 900_000_001, node_id: 'R_1', name: 'api', full_name: 'hsanjebri/api', private: true },
      { id: 900_000_002, node_id: 'R_2', name: 'web', full_name: 'hsanjebri/web', private: false },
    ],
    sender: { login: 'hsanjebri', id: 1001 },
  };
}

export function installationAction(action: string, suspendedAt: string | null = null) {
  return {
    action,
    installation: { ...installation, suspended_at: suspendedAt },
    sender: { login: 'hsanjebri', id: 1001 },
  };
}

export const REPO_ID = 900_000_001;
export const RUN_ID = 42_000_000_000;

export function workflowRunCompleted(
  overrides: { conclusion?: string | null; action?: string; runAttempt?: number } = {},
) {
  return {
    action: overrides.action ?? 'completed',
    workflow_run: {
      id: RUN_ID,
      run_attempt: overrides.runAttempt ?? 1,
      name: 'CI',
      head_sha: '9f2c1ab5d4e3f60718293a4b5c6d7e8f90123456',
      head_branch: 'feat/queue',
      event: 'pull_request',
      conclusion: overrides.conclusion === undefined ? 'failure' : overrides.conclusion,
      status: 'completed',
      html_url: `https://github.com/hsanjebri/api/actions/runs/${RUN_ID}`,
      pull_requests: [{ number: 7 }],
    },
    repository: {
      id: REPO_ID,
      name: 'api',
      full_name: 'hsanjebri/api',
      private: true,
      owner: { login: 'hsanjebri', id: 1001, type: 'User' },
    },
    installation: { id: INSTALLATION_ID },
    sender: { login: 'hsanjebri', id: 1001 },
  };
}

export function installationRepositories(
  action: 'added' | 'removed',
  added: { id: number; full_name: string; private: boolean }[],
  removed: { id: number; full_name: string; private: boolean }[],
) {
  return {
    action,
    installation,
    repository_selection: 'selected',
    repositories_added: added,
    repositories_removed: removed,
    sender: { login: 'hsanjebri', id: 1001 },
  };
}
