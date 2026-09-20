import { Content, Empty, Page, Rail, TopBar } from '@/components/chrome';
import { requireRepository, requireViewer } from '@/lib/access';
import { db } from '@/lib/db';
import { relativeTime } from '@/lib/format';
import { listFlakyTests } from '@logsy/db';
import { notFound } from 'next/navigation';

export default async function FlakyPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const viewer = await requireViewer();
  const repository = await requireRepository(fullName, viewer.accessToken);
  if (!repository) notFound();

  const flaky = await listFlakyTests(db, repository.id);

  return (
    <Page>
      <Rail active="flaky" repoFullName={fullName} viewer={viewer} />
      <Content>
        <TopBar>
          <h1 className="flex-1 text-sm font-semibold text-ink">Flaky tests</h1>
        </TopBar>

        <div className="p-8">
          {flaky.length === 0 ? (
            <Empty
              title="No flaky tests detected"
              hint="A test counts as flaky when the same commit both passed and failed it. Detection arrives with JUnit report parsing in the next phase."
            />
          ) : (
            <div className="card divide-y divide-track">
              {flaky.map((test) => (
                <div key={test.id} className="flex items-center gap-4 px-7 py-4">
                  <span
                    aria-hidden="true"
                    className={
                      test.status === 'active'
                        ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-warning'
                        : 'h-1.5 w-1.5 shrink-0 rounded-full bg-hairline'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{test.testName}</div>
                    <div className="text-[13px] text-secondary">{test.suite}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-ink">{test.flipCount} flips</div>
                    <div className="text-xs text-tertiary">
                      {test.lastFlippedAt ? relativeTime(test.lastFlippedAt) : 'never'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Content>
    </Page>
  );
}
