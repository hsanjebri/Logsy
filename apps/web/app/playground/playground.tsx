'use client';

import { CommentPreview } from '@logsy/ui';
import { useActionState, useState, type ChangeEvent } from 'react';
import { analyzePlaygroundLog } from './actions';
import { SAMPLES } from './samples';
import { MAX_LOG_CHARS, type PlaygroundResult, type PlaygroundState } from './shared';

export function Playground({ llmEnabled }: { llmEnabled: boolean }) {
  const [state, formAction, pending] = useActionState<PlaygroundState, FormData>(
    analyzePlaygroundLog,
    { status: 'idle' },
  );
  const [log, setLog] = useState(SAMPLES[0]?.log ?? '');
  const [activeSample, setActiveSample] = useState<string | null>(SAMPLES[0]?.id ?? null);

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLog(await file.text());
    setActiveSample(null);
    event.target.value = '';
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form action={formAction} className="card flex min-w-0 flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="label">CI log</span>
          <label className="cursor-pointer text-[13px] text-secondary hover:text-ink">
            Upload a file
            <input
              type="file"
              accept=".log,.txt,text/plain"
              className="hidden"
              onChange={(event) => {
                void loadFile(event);
              }}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              title={sample.hint}
              onClick={() => {
                setLog(sample.log);
                setActiveSample(sample.id);
              }}
              className={
                sample.id === activeSample
                  ? 'rounded-full bg-ink px-3 py-1.5 text-[13px] font-medium text-surface'
                  : 'rounded-full bg-track px-3 py-1.5 text-[13px] text-secondary hover:text-ink'
              }
            >
              {sample.label}
            </button>
          ))}
        </div>

        <textarea
          name="log"
          value={log}
          onChange={(event) => {
            setLog(event.target.value);
            setActiveSample(null);
          }}
          spellCheck={false}
          placeholder="Paste the log of a failed GitHub Actions job…"
          className="min-h-[420px] w-full resize-y rounded-[12px] border border-hairline bg-canvas p-4 font-[family-name:var(--font-mono)] text-[12px] leading-[1.6] text-ink outline-none focus:border-secondary"
        />
        <div className="flex items-center justify-between text-xs text-tertiary">
          <span>{log.length.toLocaleString('en-US')} characters</span>
          {log.length > MAX_LOG_CHARS ? (
            <span className="text-danger">Too large: paste the failing job only.</span>
          ) : (
            <span>Secrets are redacted before anything else sees the log.</span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label
            className={`flex items-center gap-2 text-[13px] ${llmEnabled ? 'text-secondary' : 'text-tertiary'}`}
          >
            <input type="checkbox" name="skipRules" disabled={!llmEnabled} className="accent-ink" />
            Skip the rules and ask the models
          </label>
          <button
            type="submit"
            disabled={pending || log.trim() === ''}
            className="rounded-[10px] bg-ink px-5 py-2.5 text-sm font-medium text-surface disabled:opacity-50"
          >
            {pending ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
      </form>

      <section className="flex min-w-0 flex-col gap-6" aria-live="polite">
        {pending ? (
          <Placeholder
            title="Analyzing…"
            hint={
              llmEnabled
                ? 'Rules answer instantly. When the log goes to the models, free tiers can take 5 to 20 seconds.'
                : 'This takes a moment.'
            }
          />
        ) : state.status === 'error' ? (
          <div className="card flex flex-col gap-2 border-l-4 border-danger px-6 py-5">
            <span className="label">Could not analyze</span>
            <p className="text-sm text-ink">{state.message}</p>
          </div>
        ) : state.status === 'done' ? (
          <Result result={state.result} />
        ) : (
          <Placeholder
            title="Pick an example or paste a log"
            hint="Logsy finds the failing step, redacts secrets, locates the root error and writes the pull request comment it would post."
          />
        )}
      </section>
    </div>
  );
}

function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-8 py-20 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      <p className="max-w-sm text-sm text-secondary">{hint}</p>
    </div>
  );
}

function Result({ result }: { result: PlaygroundResult }) {
  const [view, setView] = useState<'preview' | 'markdown'>('preview');

  const decidedBy =
    result.source === 'rule'
      ? `Rule “${result.ruleId ?? '?'}”, no LLM call`
      : result.source === 'llm' && result.llm
        ? `${result.llm.model} · ${(result.llm.latencyMs / 1000).toFixed(1)} s · ${result.llm.tokens.toLocaleString('en-US')} tokens${result.llm.fellBack ? ' · no valid answer' : ''}`
        : 'Nothing: no rule matched and no model is enabled';

  const rows: [string, string][] = [
    ['Failing step', result.stepName ?? 'Not identified'],
    [
      'Log',
      `${result.charsOriginal.toLocaleString('en-US')} characters, ${result.charsExcerpt.toLocaleString('en-US')} kept`,
    ],
    ['Secrets redacted', result.redactions === 0 ? 'None found' : String(result.redactions)],
    ['Decided by', decidedBy],
    ['Category', `${result.category} · confidence ${String(Math.round(result.confidence * 100))}%`],
    ['Fingerprint', result.fingerprint.slice(0, 19)],
  ];

  return (
    <>
      <div className="card flex flex-col gap-4 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="label">Verdict</span>
            <p className="mt-1 text-[17px] font-semibold tracking-[-0.015em] text-ink">
              {result.confident ? result.title : 'Not sure enough to explain it'}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
              result.confident ? 'bg-track text-success' : 'bg-track text-warning'
            }`}
          >
            {result.confident ? 'Confident' : 'Excerpt only'}
          </span>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px]">
          {rows.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-tertiary">{name}</dt>
              <dd className="truncate text-ink" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card flex min-w-0 flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="label">Pull request comment</span>
          <div className="flex rounded-[9px] bg-track p-0.5 text-[13px]">
            {(['preview', 'markdown'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setView(option);
                }}
                className={
                  view === option
                    ? 'card rounded-[7px] px-3 py-1 font-medium text-ink'
                    : 'rounded-[7px] px-3 py-1 text-secondary hover:text-ink'
                }
              >
                {option === 'preview' ? 'Preview' : 'Markdown'}
              </button>
            ))}
          </div>
        </div>
        {view === 'preview' ? (
          <CommentPreview blocks={result.blocks} />
        ) : (
          <pre className="max-h-[560px] overflow-auto rounded-[10px] bg-track p-4 font-[family-name:var(--font-mono)] text-[12px] leading-[1.6] whitespace-pre-wrap text-ink">
            {result.markdown}
          </pre>
        )}
      </div>
    </>
  );
}
