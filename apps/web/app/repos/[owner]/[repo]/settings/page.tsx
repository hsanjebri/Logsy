import { Content, Page, Rail, TopBar } from '@/components/chrome';
import { requireRepository, requireViewer } from '@/lib/access';
import { notFound } from 'next/navigation';
import { saveSettings } from './actions';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const viewer = await requireViewer();
  const repository = await requireRepository(fullName, viewer.accessToken);
  if (!repository) notFound();

  const { settings } = repository;

  return (
    <Page>
      <Rail active="settings" repoFullName={fullName} viewer={viewer} />
      <Content>
        <TopBar>
          <h1 className="flex-1 text-sm font-semibold text-ink">Settings</h1>
          <span className="text-[13px] text-secondary">{fullName}</span>
        </TopBar>

        <div className="p-8">
          <form action={saveSettings} className="card flex max-w-2xl flex-col">
            <input type="hidden" name="fullName" value={fullName} />

            <Row
              label="Analyse failed runs"
              hint="When off, Logsy ignores this repository entirely."
            >
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={settings.enabled}
                className="h-5 w-5 accent-[var(--color-ink)]"
              />
            </Row>

            <Row
              label="Use the LLM"
              hint="Rules and cached analyses still run. Only failures nothing recognises reach the model."
            >
              <input
                type="checkbox"
                name="llmEnabled"
                defaultChecked={settings.llmEnabled}
                className="h-5 w-5 accent-[var(--color-ink)]"
              />
            </Row>

            <Row
              label="Pull request comment"
              hint="One comment per pull request, updated in place."
            >
              <select
                name="commentMode"
                defaultValue={settings.commentMode}
                className="rounded-[9px] border border-hairline bg-surface px-3 py-2 text-[13px] text-ink"
              >
                <option value="single">Post and update one comment</option>
                <option value="off">Do not comment</option>
              </select>
            </Row>

            <div className="flex items-center justify-end gap-3 px-7 py-5">
              <button
                type="submit"
                className="rounded-[10px] bg-ink px-4 py-2.5 text-[13px] font-medium text-surface"
              >
                Save settings
              </button>
            </div>
          </form>
        </div>
      </Content>
    </Page>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-6 border-b border-track px-7 py-5">
      <span className="flex-1">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-1 block text-[13px] leading-relaxed text-secondary">{hint}</span>
      </span>
      {children}
    </label>
  );
}
