import { CategoryBars, FailuresPerDay } from '@/components/charts';
import { Content, Empty, Page, Rail, TopBar } from '@/components/chrome';
import { requireRepository, requireViewer } from '@/lib/access';
import { db } from '@/lib/db';
import { money, percent, relativeTime } from '@/lib/format';
import {
  getCategoryBreakdown,
  getFailuresPerDay,
  getFeedbackStats,
  getOverviewStats,
  getRecurringFailures,
  listRuns,
} from '@logsy/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function RepositoryOverview({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const viewer = await requireViewer();
  const repository = await requireRepository(fullName, viewer.accessToken);
  if (!repository) notFound();

  const [stats, days, categories, recurring, runs, votes] = await Promise.all([
    getOverviewStats(db, repository.id),
    getFailuresPerDay(db, repository.id),
    getCategoryBreakdown(db, repository.id),
    getRecurringFailures(db, repository.id, 5),
    listRuns(db, repository.id, 5),
    getFeedbackStats(db, repository.id),
  ]);

  return (
    <Page>
      <Rail active="overview" repoFullName={fullName} viewer={viewer} />
      <Content>
        <TopBar>
          <div className="flex flex-1 items-baseline gap-1.5">
            <span className="text-sm text-tertiary">{owner}</span>
            <span className="text-sm text-hairline">/</span>
            <span className="text-sm font-semibold text-ink">{repo}</span>
          </div>
          <span className="text-[13px] text-secondary">Last 14 days</span>
        </TopBar>

        <div className="flex flex-col gap-5 p-8">
          {stats.failedRuns === 0 ? (
            <Empty
              title="No failures in the last 14 days"
              hint="Logsy analyses a run as soon as it fails. Nothing to show means nothing broke."
            />
          ) : null}

          <section className="card flex items-stretch">
            <div className="flex flex-col gap-2.5 px-8 py-7">
              <span className="label">Failed runs · last 14 days</span>
              <div className="flex items-baseline gap-3">
                <span className="text-[56px] leading-none font-semibold tracking-[-0.04em] text-ink">
                  {stats.failedRuns}
                </span>
                <span className="text-[15px] text-secondary">
                  {stats.failures} failed job{stats.failures === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            <div className="ml-auto flex items-center">
              <div className="flex flex-col gap-1.5 border-l border-track px-8">
                <span className="text-xs text-tertiary">Explained</span>
                <span className="text-2xl font-semibold tracking-[-0.025em] text-ink">
                  {percent(stats.explained, stats.failures)}
                </span>
                <span className="text-xs text-tertiary">
                  {stats.bySource.rule} rule · {stats.bySource.cache} cached · {stats.bySource.llm}{' '}
                  LLM
                </span>
              </div>
              <div className="flex flex-col gap-1.5 border-l border-track px-8">
                <span className="text-xs text-tertiary">LLM spend</span>
                <span className="text-2xl font-semibold tracking-[-0.025em] text-ink">
                  {money(stats.costUsd)}
                </span>
                <span className="text-xs text-tertiary">{stats.bySource.llm} calls</span>
              </div>
              <div className="flex flex-col gap-1.5 border-l border-track px-8">
                <span className="text-xs text-tertiary">Rated helpful</span>
                <span className="text-2xl font-semibold tracking-[-0.025em] text-ink">
                  {votes.helpful + votes.wrong === 0
                    ? '—'
                    : percent(votes.helpful, votes.helpful + votes.wrong)}
                </span>
                <span className="text-xs text-tertiary">
                  {votes.helpful} helpful · {votes.wrong} wrong
                </span>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-[1.7fr_1fr] gap-5">
            <div className="card px-7 pt-6 pb-4">
              <h2 className="mb-5 text-sm font-semibold tracking-[-0.01em] text-ink">
                Failures per day
              </h2>
              <FailuresPerDay days={days} />
            </div>

            <div className="card px-7 py-6">
              <h2 className="mb-5 text-sm font-semibold tracking-[-0.01em] text-ink">
                By category
              </h2>
              {categories.length === 0 ? (
                <p className="text-[13px] text-secondary">No failures recorded yet.</p>
              ) : (
                <CategoryBars categories={categories} />
              )}
            </div>
          </section>

          <section className="grid grid-cols-[1.7fr_1fr] gap-5">
            <div className="card px-7 py-5">
              <h2 className="mb-2 text-sm font-semibold tracking-[-0.01em] text-ink">
                Recurring failures
              </h2>
              {recurring.length === 0 ? (
                <p className="py-3 text-[13px] text-secondary">Nothing has failed twice yet.</p>
              ) : (
                <table className="w-full border-collapse text-[13.5px]">
                  <tbody>
                    {recurring.map((failure) => (
                      <tr key={failure.fingerprint} className="border-t border-track">
                        <td className="py-3.5">
                          <div className="font-medium text-ink">{failure.title}</div>
                          <div className="font-[family-name:var(--font-mono)] text-[11px] text-tertiary">
                            {failure.fingerprint.slice(0, 17)}…
                          </div>
                        </td>
                        <td className="w-20 py-3.5 text-right">
                          <span className="rounded-full bg-track px-2.5 py-1 text-xs font-medium text-ink">
                            {failure.occurrences}×
                          </span>
                        </td>
                        <td className="w-24 py-3.5 text-right text-xs text-tertiary">
                          {relativeTime(failure.lastSeenAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card px-7 py-5">
              <h2 className="mb-3 text-sm font-semibold tracking-[-0.01em] text-ink">
                Recent runs
              </h2>
              <div className="flex flex-col">
                {runs.length === 0 ? (
                  <p className="text-[13px] text-secondary">No runs recorded yet.</p>
                ) : (
                  runs.map((run) => (
                    <Link
                      key={run.id}
                      href={`/repos/${fullName}/runs/${String(run.githubRunId)}`}
                      className="flex items-center gap-3 border-t border-track py-3 text-[13px] no-underline first:border-t-0"
                    >
                      <span
                        aria-hidden="true"
                        className={
                          run.conclusion === 'failure'
                            ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-danger'
                            : 'h-1.5 w-1.5 shrink-0 rounded-full bg-success'
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">{run.workflowName}</span>
                      <span className="text-xs text-tertiary">{relativeTime(run.createdAt)}</span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </Content>
    </Page>
  );
}
