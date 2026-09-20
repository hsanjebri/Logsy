import { Content, Page, Rail, TopBar } from '@/components/chrome';
import { requireRepository, requireViewer } from '@/lib/access';
import { db } from '@/lib/db';
import { relativeTime, shortSha } from '@/lib/format';
import { categoryLabel } from '@logsy/core';
import { findRunByGithubId, findRunFailures } from '@logsy/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function RunDetail({
  params,
}: {
  params: Promise<{ owner: string; repo: string; runId: string }>;
}) {
  const { owner, repo, runId } = await params;
  const fullName = `${owner}/${repo}`;
  const viewer = await requireViewer();
  const repository = await requireRepository(fullName, viewer.accessToken);
  if (!repository) notFound();

  const githubRunId = Number(runId);
  if (!Number.isInteger(githubRunId)) notFound();

  const run = await findRunByGithubId(db, repository.id, githubRunId);
  if (!run) notFound();

  const failures = await findRunFailures(db, run.id);

  return (
    <Page>
      <Rail active="runs" repoFullName={fullName} viewer={viewer} />
      <Content>
        <TopBar>
          <div className="flex flex-1 items-baseline gap-1.5">
            <Link href={`/repos/${fullName}`} className="text-sm text-tertiary no-underline">
              {fullName}
            </Link>
            <span className="text-sm text-hairline">/</span>
            <span className="text-sm font-semibold text-ink">{run.workflowName}</span>
          </div>
          <a
            href={run.htmlUrl}
            className="text-[13px] text-secondary no-underline hover:text-ink"
            rel="noreferrer"
          >
            View on GitHub ↗
          </a>
        </TopBar>

        <div className="flex flex-col gap-5 p-8">
          <section className="card flex flex-wrap items-center gap-x-10 gap-y-4 px-8 py-6">
            <div className="flex flex-col gap-1">
              <span className="label">Conclusion</span>
              <span
                className={
                  run.conclusion === 'failure'
                    ? 'text-[15px] font-medium text-danger'
                    : 'text-[15px] font-medium text-success'
                }
              >
                {run.conclusion ?? 'unknown'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="label">Attempt</span>
              <span className="text-[15px] text-ink">{run.runAttempt}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="label">Branch</span>
              <span className="text-[15px] text-ink">{run.headBranch ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="label">Commit</span>
              <span className="font-[family-name:var(--font-mono)] text-[14px] text-ink">
                {shortSha(run.headSha)}
              </span>
            </div>
            {run.prNumber === null ? null : (
              <div className="flex flex-col gap-1">
                <span className="label">Pull request</span>
                <span className="text-[15px] text-ink">#{run.prNumber}</span>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="label">When</span>
              <span className="text-[15px] text-ink">{relativeTime(run.createdAt)}</span>
            </div>
          </section>

          {failures.map((failure) => (
            <section key={failure.failureId} className="card px-8 py-6">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-track px-2.5 py-1 text-xs font-medium text-ink">
                  {categoryLabel(failure.category)}
                </span>
                <span className="text-[15px] font-medium text-ink">{failure.jobName}</span>
                {failure.stepName ? (
                  <span className="text-[13px] text-secondary">› {failure.stepName}</span>
                ) : null}
                <span className="ml-auto font-[family-name:var(--font-mono)] text-[11px] text-tertiary">
                  {failure.fingerprint.slice(0, 17)}…
                </span>
              </div>

              {failure.result ? (
                <div className="flex flex-col gap-3">
                  <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">
                    {failure.result.title}
                  </h2>
                  <p className="text-sm leading-relaxed text-ink">{failure.result.rootCause}</p>

                  {failure.result.evidence.length > 0 ? (
                    <pre className="overflow-x-auto rounded-[10px] border border-hairline bg-track p-4 font-[family-name:var(--font-mono)] text-xs leading-relaxed text-ink">
                      {failure.result.evidence.join('\n')}
                    </pre>
                  ) : null}

                  <div>
                    <h3 className="mb-1 text-[13px] font-semibold text-ink">Suggested fix</h3>
                    <p className="text-sm leading-relaxed text-secondary">
                      {failure.result.suggestedFix}
                    </p>
                  </div>

                  <p className="text-xs text-tertiary">
                    {failure.source === 'rule'
                      ? 'Matched a known failure pattern'
                      : failure.source === 'cache'
                        ? 'Reused an earlier analysis of the same error'
                        : `Analysed by ${failure.model ?? 'an LLM'}`}
                    {failure.confidence === null
                      ? ''
                      : ` · confidence ${String(Math.round(failure.confidence * 100))}%`}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-secondary">
                    No explanation was produced for this failure. The error excerpt is below.
                  </p>
                  <pre className="max-h-96 overflow-auto rounded-[10px] border border-hairline bg-track p-4 font-[family-name:var(--font-mono)] text-xs leading-relaxed text-ink">
                    {failure.errorExcerpt || 'No log was available.'}
                  </pre>
                </div>
              )}
            </section>
          ))}

          {failures.length === 0 ? (
            <section className="card px-8 py-6 text-sm text-secondary">
              This run has no stored failures.
            </section>
          ) : null}
        </div>
      </Content>
    </Page>
  );
}
