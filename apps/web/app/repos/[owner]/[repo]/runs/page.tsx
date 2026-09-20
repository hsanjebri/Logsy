import { Content, Empty, Page, Rail, TopBar } from '@/components/chrome';
import { requireRepository, requireViewer } from '@/lib/access';
import { db } from '@/lib/db';
import { relativeTime, shortSha } from '@/lib/format';
import { listRuns } from '@logsy/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function RunsPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const viewer = await requireViewer();
  const repository = await requireRepository(fullName, viewer.accessToken);
  if (!repository) notFound();

  const runs = await listRuns(db, repository.id, 50);

  return (
    <Page>
      <Rail active="runs" repoFullName={fullName} viewer={viewer} />
      <Content>
        <TopBar>
          <h1 className="flex-1 text-sm font-semibold text-ink">Runs</h1>
          <span className="text-[13px] text-secondary">{runs.length} stored</span>
        </TopBar>

        <div className="p-8">
          {runs.length === 0 ? (
            <Empty
              title="No runs yet"
              hint="Logsy stores a run the first time one of its jobs fails."
            />
          ) : (
            <div className="card divide-y divide-track">
              {runs.map((run) => (
                <Link
                  key={run.id}
                  href={`/repos/${fullName}/runs/${String(run.githubRunId)}`}
                  className="flex items-center gap-4 px-7 py-4 no-underline first:rounded-t-[18px] last:rounded-b-[18px] hover:bg-track"
                >
                  <span
                    aria-hidden="true"
                    className={
                      run.conclusion === 'failure'
                        ? 'h-2 w-2 shrink-0 rounded-full bg-danger'
                        : 'h-2 w-2 shrink-0 rounded-full bg-success'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {run.workflowName}
                      {run.runAttempt > 1 ? (
                        <span className="text-secondary"> · attempt {run.runAttempt}</span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[13px] text-secondary">
                      {run.headBranch ?? 'unknown branch'} ·{' '}
                      <span className="font-[family-name:var(--font-mono)]">
                        {shortSha(run.headSha)}
                      </span>
                      {run.prNumber === null ? '' : ` · PR #${String(run.prNumber)}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-ink">
                      {run.failureCount} failed job{run.failureCount === 1 ? '' : 's'}
                    </div>
                    <div className="text-xs text-tertiary">{relativeTime(run.createdAt)}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </Content>
    </Page>
  );
}
