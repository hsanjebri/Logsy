import { requireViewer, viewerRepoIds } from '@/lib/access';
import { db } from '@/lib/db';
import { findAnalysisOwner, findFeedback, findRepositoryById, recordFeedback } from '@logsy/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';

/**
 * Where the 👍 / 👎 links in a PR comment land. Signing in is what makes the vote
 * attributable and keeps it from being spammed, and the same login already decides
 * which repositories a person may see.
 */
export default async function FeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ analysisId: string }>;
  searchParams: Promise<{ verdict?: string }>;
}) {
  const { analysisId: rawId } = await params;
  const { verdict: rawVerdict } = await searchParams;

  const analysisId = Number(rawId);
  if (!Number.isInteger(analysisId) || analysisId <= 0) notFound();

  const viewer = await requireViewer();
  const analysis = await findAnalysisOwner(db, analysisId);
  if (!analysis) notFound();

  // The analysis belongs to a repository; only people who can see it may judge it.
  const repository = await findRepositoryById(db, analysis.repositoryId);
  if (!repository) notFound();

  const allowed = await viewerRepoIds(viewer.accessToken);
  if (!allowed.includes(repository.githubRepoId)) notFound();

  const verdict = rawVerdict === 'helpful' || rawVerdict === 'wrong' ? rawVerdict : null;
  if (verdict) {
    await recordFeedback(db, { analysisId, githubUser: viewer.name, verdict });
  }
  const existing = await findFeedback(db, analysisId, viewer.name);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="card flex w-full max-w-md flex-col gap-5 px-8 py-9">
        <span className="label">Feedback</span>

        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-ink">
            {existing?.verdict === 'helpful'
              ? 'Thanks — glad it helped'
              : existing?.verdict === 'wrong'
                ? 'Thanks — noted that it was wrong'
                : 'How was this analysis?'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            {analysis.title ?? 'Analysis'} · {repository.fullName}
          </p>
        </div>

        <div className="flex gap-3">
          <Link
            href={`/feedback/${String(analysisId)}?verdict=helpful`}
            className={
              existing?.verdict === 'helpful'
                ? 'flex-1 rounded-[10px] bg-ink px-4 py-3 text-center text-sm font-medium text-surface no-underline'
                : 'flex-1 rounded-[10px] border border-hairline px-4 py-3 text-center text-sm font-medium text-ink no-underline'
            }
          >
            👍 Helpful
          </Link>
          <Link
            href={`/feedback/${String(analysisId)}?verdict=wrong`}
            className={
              existing?.verdict === 'wrong'
                ? 'flex-1 rounded-[10px] bg-ink px-4 py-3 text-center text-sm font-medium text-surface no-underline'
                : 'flex-1 rounded-[10px] border border-hairline px-4 py-3 text-center text-sm font-medium text-ink no-underline'
            }
          >
            👎 Wrong
          </Link>
        </div>

        <p className="text-xs leading-relaxed text-tertiary">
          Your vote is stored against this analysis only, and you can change it by clicking the
          other button. Wrong answers are what the accuracy work is measured against.
        </p>

        <Link
          href={`/repos/${repository.fullName}`}
          className="text-[13px] text-secondary no-underline hover:text-ink"
        >
          ← {repository.fullName}
        </Link>
      </div>
    </main>
  );
}
