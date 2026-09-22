import type { LogAnalysisSummary } from '@logsy/llm';
import { CommentPreview } from '@logsy/ui';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';

interface ExampleLog {
  id: string;
  label: string;
  detail: string | null;
}
interface ModelStatus {
  label: string;
  ready: boolean;
  detail: string;
}
type AnalyzeResponse = { ok: true; result: LogAnalysisSummary } | { ok: false; message: string };

interface Bridge {
  status(): Promise<ModelStatus>;
  examples(): Promise<ExampleLog[]>;
  example(id: string): Promise<{ name: string; text: string } | null>;
  openFile(): Promise<{ name: string; text: string } | null>;
  analyze(request: {
    log: string;
    name: string;
    skipRules: boolean;
    useLlm: boolean;
  }): Promise<AnalyzeResponse>;
}
declare global {
  interface Window {
    logsy: Bridge;
  }
}

interface HistoryEntry {
  id: number;
  name: string;
  at: Date;
  result: LogAnalysisSummary;
}

export function App() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [examples, setExamples] = useState<ExampleLog[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useLlm, setUseLlm] = useState(true);
  const [skipRules, setSkipRules] = useState(false);
  const nextId = useRef(1);

  useEffect(() => {
    void window.logsy.status().then(setStatus);
    void window.logsy.examples().then(setExamples);
  }, []);

  const run = useCallback(
    async (name: string, log: string) => {
      setBusy(name);
      setError(null);
      const response = await window.logsy.analyze({ log, name, skipRules, useLlm });
      setBusy(null);
      if (!response.ok) {
        setError(response.message);
        return;
      }
      const entry = { id: nextId.current++, name, at: new Date(), result: response.result };
      setHistory((previous) => [entry, ...previous]);
      setSelected(entry.id);
    },
    [skipRules, useLlm],
  );

  const openFile = useCallback(async () => {
    const file = await window.logsy.openFile();
    if (file) await run(file.name, file.text);
  }, [run]);

  const openExample = useCallback(
    async (example: ExampleLog) => {
      const file = await window.logsy.example(example.id);
      if (file) await run(file.name, file.text);
    },
    [run],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file) void file.text().then((text) => run(file.name, text));
    },
    [run],
  );

  const current = history.find((entry) => entry.id === selected) ?? null;

  return (
    <div
      className="flex h-screen flex-col bg-canvas text-ink"
      onDrop={onDrop}
      onDragOver={(event) => {
        event.preventDefault();
      }}
    >
      <Toolbar
        status={status}
        busy={busy !== null}
        currentName={current?.name ?? null}
        onOpen={() => void openFile()}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          history={history}
          examples={examples}
          selected={selected}
          busy={busy}
          onSelect={setSelected}
          onExample={(example) => void openExample(example)}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Options
            useLlm={useLlm}
            skipRules={skipRules}
            modelsReady={status?.ready ?? false}
            onUseLlm={setUseLlm}
            onSkipRules={setSkipRules}
          />
          <div className="min-h-0 flex-1 p-6">
            {busy !== null ? (
              <Centered
                title={`Analyzing ${busy}…`}
                hint="Rules answer instantly. A log that reaches the models takes a few seconds."
              />
            ) : error !== null ? (
              <div className="card border-l-4 border-danger px-6 py-5">
                <p className="label">Could not analyze</p>
                <p className="mt-2 text-sm">{error}</p>
              </div>
            ) : current ? (
              <Analysis entry={current} />
            ) : (
              <Centered
                title="Drop a CI log here"
                hint="Or press Open log…, or pick one of the real failed builds on the left. Logsy finds the failing step, redacts secrets and writes the pull request comment it would post."
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Toolbar({
  status,
  busy,
  currentName,
  onOpen,
}: {
  status: ModelStatus | null;
  busy: boolean;
  currentName: string | null;
  onOpen: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-stretch gap-px border-b border-hairline bg-track">
      <div className="flex w-[300px] items-center gap-2.5 bg-surface px-4">
        <span
          aria-hidden="true"
          className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-ink text-[13px] font-semibold text-surface"
        >
          L
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.02em]">Logsy</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center bg-surface px-4">
        <span className="text-[11px] text-tertiary">Current log</span>
        <span className="truncate text-[13px] font-medium">{currentName ?? 'None'}</span>
      </div>
      <div className="flex min-w-0 flex-col justify-center bg-surface px-4" title={status?.detail}>
        <span className="text-[11px] text-tertiary">Models</span>
        <span className="truncate text-[13px] font-medium">{status?.label ?? '…'}</span>
      </div>
      <div className="flex items-center bg-surface px-4">
        <button
          type="button"
          onClick={onOpen}
          disabled={busy}
          className="rounded-[9px] bg-ink px-4 py-2 text-[13px] font-medium text-surface disabled:opacity-50"
        >
          Open log…
        </button>
      </div>
    </header>
  );
}

function Sidebar({
  history,
  examples,
  selected,
  busy,
  onSelect,
  onExample,
}: {
  history: HistoryEntry[];
  examples: ExampleLog[];
  selected: number | null;
  busy: string | null;
  onSelect: (id: number) => void;
  onExample: (example: ExampleLog) => void;
}) {
  return (
    <nav className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-hairline bg-surface">
      <section className="flex flex-col">
        <h2 className="label px-4 pt-4 pb-2">Analyzed ({history.length})</h2>
        {history.length === 0 ? (
          <p className="px-4 pb-3 text-[13px] text-tertiary">Nothing yet.</p>
        ) : (
          history.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                onSelect(entry.id);
              }}
              className={`flex flex-col items-start gap-0.5 px-4 py-2.5 text-left ${
                entry.id === selected ? 'bg-track' : 'hover:bg-track'
              }`}
            >
              <span className="w-full truncate text-[13px] font-medium">{entry.name}</span>
              <span className="w-full truncate text-[12px] text-secondary">
                {entry.result.category} ·{' '}
                {entry.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>
          ))
        )}
      </section>

      <section className="flex flex-col border-t border-hairline">
        <h2 className="label px-4 pt-4 pb-2">Example failures</h2>
        {examples.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-tertiary">
            Run the app from the repository to get the bundled logs.
          </p>
        ) : (
          examples.map((example) => (
            <button
              key={example.id}
              type="button"
              disabled={busy !== null}
              onClick={() => {
                onExample(example);
              }}
              title={example.detail ?? example.label}
              className="truncate px-4 py-2 text-left text-[13px] text-secondary hover:bg-track hover:text-ink disabled:opacity-50"
            >
              {example.label}
            </button>
          ))
        )}
      </section>
    </nav>
  );
}

function Options({
  useLlm,
  skipRules,
  modelsReady,
  onUseLlm,
  onSkipRules,
}: {
  useLlm: boolean;
  skipRules: boolean;
  modelsReady: boolean;
  onUseLlm: (value: boolean) => void;
  onSkipRules: (value: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-5 border-b border-hairline bg-surface px-6 py-2.5 text-[13px]">
      <label
        className={`flex items-center gap-2 ${modelsReady ? 'text-secondary' : 'text-tertiary'}`}
      >
        <input
          type="checkbox"
          className="accent-ink"
          checked={useLlm}
          disabled={!modelsReady}
          onChange={(event) => {
            onUseLlm(event.target.checked);
          }}
        />
        Ask the models when no rule matches
      </label>
      <label
        className={`flex items-center gap-2 ${modelsReady ? 'text-secondary' : 'text-tertiary'}`}
      >
        <input
          type="checkbox"
          className="accent-ink"
          checked={skipRules}
          disabled={!modelsReady || !useLlm}
          onChange={(event) => {
            onSkipRules(event.target.checked);
          }}
        />
        Skip the rules entirely
      </label>
    </div>
  );
}

function Centered({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="card flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      <p className="max-w-md text-sm text-secondary">{hint}</p>
    </div>
  );
}

function Analysis({ entry }: { entry: HistoryEntry }) {
  const [view, setView] = useState<'preview' | 'markdown'>('preview');
  const [copied, setCopied] = useState(false);
  const { result } = entry;

  const decidedBy =
    result.source === 'rule'
      ? `Rule “${result.ruleId ?? '?'}”, no model call`
      : result.llm
        ? `${result.llm.model} · ${(result.llm.latencyMs / 1000).toFixed(1)} s · ${result.llm.tokens.toLocaleString('en-US')} tokens`
        : 'Nothing: no rule matched and no model was asked';

  return (
    <div className="flex flex-col gap-5">
      <div className="card flex flex-col gap-4 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="label">Verdict</span>
            <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">
              {result.confident ? result.title : 'Not sure enough to explain it'}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full bg-track px-2.5 py-1 text-xs font-medium ${
              result.confident ? 'text-success' : 'text-warning'
            }`}
          >
            {result.confident ? 'Confident' : 'Excerpt only'}
          </span>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px]">
          {(
            [
              ['Failing step', result.stepName ?? 'Not identified'],
              [
                'Log',
                `${result.charsOriginal.toLocaleString('en-US')} characters, ${result.charsExcerpt.toLocaleString('en-US')} kept`,
              ],
              [
                'Secrets redacted',
                result.redactions === 0 ? 'None found' : String(result.redactions),
              ],
              ['Decided by', decidedBy],
              [
                'Category',
                `${result.category} · confidence ${String(Math.round(result.confidence * 100))}%`,
              ],
              ['Fingerprint', result.fingerprint.slice(0, 19)],
            ] as const
          ).map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-tertiary">{name}</dt>
              <dd className="truncate" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="label">Pull request comment</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(result.markdown).then(() => {
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                  }, 1500);
                });
              }}
              className="rounded-[8px] bg-track px-3 py-1 text-[13px] text-secondary hover:text-ink"
            >
              {copied ? 'Copied' : 'Copy Markdown'}
            </button>
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
                      ? 'card rounded-[7px] px-3 py-1 font-medium'
                      : 'rounded-[7px] px-3 py-1 text-secondary hover:text-ink'
                  }
                >
                  {option === 'preview' ? 'Preview' : 'Markdown'}
                </button>
              ))}
            </div>
          </div>
        </div>
        {view === 'preview' ? (
          <CommentPreview blocks={result.blocks} />
        ) : (
          <pre className="overflow-auto rounded-[10px] bg-track p-4 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap">
            {result.markdown}
          </pre>
        )}
      </div>
    </div>
  );
}
