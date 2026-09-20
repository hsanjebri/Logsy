import { Content, Empty, Page, Rail, TopBar } from '@/components/chrome';
import { db } from '@/lib/db';
import { relativeTime } from '@/lib/format';
import { requireViewer, viewerRepoIds } from '@/lib/access';
import { listRepositories } from '@logsy/db';
import Link from 'next/link';

export default async function RepositoriesPage() {
  const viewer = await requireViewer();
  const repoIds = await viewerRepoIds(viewer.accessToken);
  const repositories = await listRepositories(db, repoIds);

  return (
    <Page>
      <Rail active="repos" viewer={viewer} />
      <Content>
        <TopBar>
          <h1 className="flex-1 text-sm font-semibold text-ink">Repositories</h1>
          <span className="text-[13px] text-secondary">
            {repositories.length} with Logsy installed
          </span>
        </TopBar>

        <div className="flex flex-col gap-5 p-8">
          {repositories.length === 0 ? (
            <Empty
              title="No repositories yet"
              hint="Install the Logsy GitHub App on a repository. It appears here after the first workflow run."
            />
          ) : (
            <div className="card divide-y divide-track">
              {repositories.map((repository) => (
                <Link
                  key={repository.id}
                  href={`/repos/${repository.fullName}`}
                  className="flex items-center gap-4 px-7 py-5 no-underline first:rounded-t-[18px] last:rounded-b-[18px] hover:bg-track"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium text-ink">
                      {repository.fullName}
                    </div>
                    <div className="mt-1 text-[13px] text-secondary">
                      {repository.private ? 'Private' : 'Public'}
                      {repository.settings.enabled ? '' : ' · analysis off'}
                      {repository.lastFailureAt
                        ? ` · last failure ${relativeTime(repository.lastFailureAt)}`
                        : ' · no failures yet'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[22px] font-semibold tracking-[-0.025em] text-ink">
                      {repository.failedRuns}
                    </div>
                    <div className="text-[11px] text-tertiary">failed · 14d</div>
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
