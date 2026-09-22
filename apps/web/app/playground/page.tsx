import type { Metadata } from 'next';
import Link from 'next/link';
import { playgroundLlm } from './llm';
import { Playground } from './playground';

export const metadata: Metadata = {
  title: 'Playground · Logsy',
  description: 'Paste a CI log and see the pull request comment Logsy would post.',
};

// Reads the LLM settings from the environment at request time, not at build time.
export const dynamic = 'force-dynamic';

/** Public on purpose: it needs no GitHub login, database or installed app. */
export default function PlaygroundPage() {
  const llm = playgroundLlm();

  return (
    <main className="min-h-screen bg-canvas">
      <header className="flex h-[66px] items-center gap-4 border-b border-hairline px-8">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <span
            aria-hidden="true"
            className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-ink text-[13px] font-semibold text-surface"
          >
            L
          </span>
          <span className="text-base font-semibold tracking-[-0.02em] text-ink">Logsy</span>
        </Link>
        <span className="text-sm text-tertiary">/</span>
        <h1 className="flex-1 text-sm font-semibold text-ink">Playground</h1>
        <span
          className="hidden max-w-[50%] truncate rounded-full bg-track px-3 py-1 text-xs text-secondary md:inline"
          title={llm.note}
        >
          {llm.provider ? `Models: ${llm.note}` : 'Rules only'}
        </span>
      </header>

      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 p-8">
        <div className="max-w-2xl">
          <h2 className="text-[22px] font-semibold tracking-[-0.025em] text-ink">
            Why did this CI run fail?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            Paste the log of a failed job. Logsy runs the same analysis it runs on a pull request:
            rules first, then {llm.provider ? 'the models' : 'a model when one is enabled'}, and
            shows the comment it would post.
            {llm.provider ? null : ` ${llm.note}`}
          </p>
        </div>
        <Playground llmEnabled={llm.provider !== undefined} />
      </div>
    </main>
  );
}
