import { analyzeLog, type LlmProvider, type LogAnalysis } from '@logsy/llm';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { copyToClipboard } from '../tui/clipboard.js';
import { listExamples } from '../tui/examples.js';
import { draw } from './draw.js';
import { FRAME_MS, type Screen } from './screen.js';
import { initialState, reduce, type AppState, type Effect } from './state.js';

export interface RunOptions {
  screen: Screen;
  examplesDir: string;
  llm: LlmProvider | undefined;
  /** How the models are named in the header. */
  modelLabel: string | null;
}

/**
 * The app loop: draw a frame every tick, fold keypresses into the state, and run the
 * effects a keypress asked for. Resolves when the person quits.
 */
export async function runApp(options: RunOptions): Promise<void> {
  const { screen } = options;
  const examples = (await listExamples(options.examplesDir)).map((example) => ({
    label: example.label,
    detail: example.detail,
    file: example.file,
  }));

  let state = initialState(examples, options.modelLabel);
  let done: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    done = resolve;
  });

  const render = () => {
    screen.paint(draw(state, screen.width, screen.height).render());
  };

  const apply = (next: AppState, effect: Effect) => {
    state = next;
    render();
    if (effect.kind === 'quit') {
      done();
      return;
    }
    void perform(effect);
  };

  /** Effects are async: the view is already showing "working" when they start. */
  const perform = async (effect: Effect): Promise<void> => {
    if (effect.kind === 'analyze' || effect.kind === 'openPath') {
      const label =
        effect.kind === 'analyze' ? effect.label : basename(effect.path.replace(/^"|"$/g, ''));
      try {
        const log =
          effect.kind === 'openPath'
            ? await readFile(effect.path.replace(/^"|"$/g, ''), 'utf8')
            : 'text' in effect.source
              ? effect.source.text
              : await readFile(effect.source.file, 'utf8');
        const result = await analyze(options, state, log);
        state = {
          ...state,
          view: { name: 'report', label, result, scroll: 0 },
          focus: 0,
          entered: 0,
        };
      } catch (error) {
        state = {
          ...state,
          view: {
            name: 'message',
            title: 'Could not analyze that log',
            body: error instanceof Error ? error.message : String(error),
            tone: 'danger',
          },
          entered: 0,
        };
      }
      render();
      return;
    }

    if (effect.kind === 'copy' && state.view.name === 'report') {
      const copied = await copyToClipboard(state.view.result.comment);
      state = {
        ...state,
        view: {
          name: 'message',
          title: copied ? 'Copied' : 'Could not copy',
          body: copied
            ? 'The comment is on your clipboard, ready to paste into a pull request.'
            : 'No clipboard tool answered. Use `logsy analyze <file> --json` instead.',
          tone: copied ? 'success' : 'warning',
        },
        entered: 0,
      };
      render();
    }
  };

  screen.onKey((key) => {
    const step = reduce(state, key);
    apply(step.state, step.effect);
  });
  screen.onResize(render);

  const timer = setInterval(() => {
    state = { ...state, tick: state.tick + 1, entered: state.entered + 1 };
    render();
  }, FRAME_MS);
  timer.unref();

  render();
  await finished;
  clearInterval(timer);
}

function analyze(options: RunOptions, state: AppState, log: string): Promise<LogAnalysis> {
  const llm = state.settings.useLlm ? options.llm : undefined;
  return analyzeLog(log, {
    ...(llm ? { llm } : {}),
    skipRules: state.settings.skipRules && llm !== undefined,
  });
}
