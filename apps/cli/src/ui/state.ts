import type { LogAnalysis } from '@logsy/llm';
import type { Key } from '../tui/keys.js';

/** Which screen is showing, and everything it needs to draw itself. */
export type View =
  | { name: 'home' }
  | { name: 'examples' }
  | { name: 'path'; value: string }
  | { name: 'paste'; text: string }
  | { name: 'models' }
  | { name: 'working'; label: string }
  | { name: 'report'; label: string; result: LogAnalysis; scroll: number }
  | { name: 'message'; title: string; body: string; tone: 'warning' | 'danger' | 'success' };

export interface AppState {
  view: View;
  /** Focused button or row within the current view. */
  focus: number;
  examples: { label: string; detail: string | null; file: string }[];
  settings: { useLlm: boolean; skipRules: boolean };
  modelLabel: string | null;
  /** Frames drawn since the app started; drives every animation. */
  tick: number;
  /** Frames since the current view appeared, for the fade-in. */
  entered: number;
  quit: boolean;
}

export const HOME_BUTTONS = ['Examples', 'Open file', 'Paste', 'Models', 'Quit'] as const;

export function initialState(examples: AppState['examples'], modelLabel: string | null): AppState {
  return {
    view: { name: 'home' },
    focus: 0,
    examples,
    settings: { useLlm: modelLabel !== null, skipRules: false },
    modelLabel,
    tick: 0,
    entered: 0,
    quit: false,
  };
}

/** What the app must do after a keypress, decided outside the drawing code. */
export type Effect =
  | { kind: 'none' }
  | { kind: 'analyze'; label: string; source: { file: string } | { text: string } }
  | { kind: 'openPath'; path: string }
  | { kind: 'copy' }
  | { kind: 'quit' };

export interface Step {
  state: AppState;
  effect: Effect;
}

/** The whole keyboard behaviour of the app, as a pure function over state. */
export function reduce(state: AppState, key: Key): Step {
  const stay = (next: Partial<AppState>, effect: Effect = { kind: 'none' }): Step => ({
    state: { ...state, ...next },
    effect,
  });
  const go = (view: View, effect: Effect = { kind: 'none' }): Step => ({
    state: { ...state, view, focus: 0, entered: 0 },
    effect,
  });

  if (key.name === 'c' && key.ctrl) return stay({ quit: true }, { kind: 'quit' });

  switch (state.view.name) {
    case 'home':
      return home(state, key, stay, go);
    case 'examples':
      return examples(state, key, stay, go);
    case 'models':
      return models(state, key, stay, go);
    case 'path':
      return path(state, key, stay, go);
    case 'paste':
      return paste(state, key, stay, go);
    case 'report':
      return report(state, key, stay, go);
    case 'message':
      return key.name === 'enter' || key.name === 'escape' || key.name === 'q'
        ? go({ name: 'home' })
        : stay({});
    case 'working':
      // Nothing to do but wait; Ctrl+C above is the way out.
      return stay({});
  }
}

type Stay = (next: Partial<AppState>, effect?: Effect) => Step;
type Go = (view: View, effect?: Effect) => Step;

function home(state: AppState, key: Key, stay: Stay, go: Go): Step {
  const last = HOME_BUTTONS.length - 1;
  if (key.name === 'right' || key.name === 'tab' || key.name === 'l') {
    return stay({ focus: state.focus === last ? 0 : state.focus + 1 });
  }
  if (key.name === 'left' || key.name === 'h') {
    return stay({ focus: state.focus === 0 ? last : state.focus - 1 });
  }
  if (key.name === 'q') return stay({ quit: true }, { kind: 'quit' });
  if (key.name !== 'enter') return stay({});

  switch (HOME_BUTTONS[state.focus]) {
    case 'Examples':
      return state.examples.length === 0
        ? go({
            name: 'message',
            title: 'No bundled examples',
            body: 'Run Logsy from its repository to get the ten real CI logs.',
            tone: 'warning',
          })
        : go({ name: 'examples' });
    case 'Open file':
      return go({ name: 'path', value: '' });
    case 'Paste':
      return go({ name: 'paste', text: '' });
    case 'Models':
      return go({ name: 'models' });
    default:
      return stay({ quit: true }, { kind: 'quit' });
  }
}

function examples(state: AppState, key: Key, stay: Stay, go: Go): Step {
  const total = state.examples.length;
  if (key.name === 'down' || key.name === 'j') return stay({ focus: (state.focus + 1) % total });
  if (key.name === 'up' || key.name === 'k') {
    return stay({ focus: (state.focus - 1 + total) % total });
  }
  if (key.name === 'escape' || key.name === 'q') return go({ name: 'home' });
  if (key.name === 'enter') {
    const example = state.examples[state.focus];
    if (!example) return stay({});
    return go(
      { name: 'working', label: example.label },
      { kind: 'analyze', label: example.label, source: { file: example.file } },
    );
  }
  return stay({});
}

function models(state: AppState, key: Key, stay: Stay, go: Go): Step {
  if (key.name === 'escape' || key.name === 'q') return go({ name: 'home' });
  if (key.name === 'down' || key.name === 'up' || key.name === 'tab') {
    return stay({ focus: state.focus === 0 ? 1 : 0 });
  }
  if (key.name === 'enter' || key.name === 'space') {
    if (state.modelLabel === null) return stay({});
    if (state.focus === 0) {
      const useLlm = !state.settings.useLlm;
      return stay({ settings: { useLlm, skipRules: useLlm ? state.settings.skipRules : false } });
    }
    if (!state.settings.useLlm) return stay({});
    return stay({ settings: { ...state.settings, skipRules: !state.settings.skipRules } });
  }
  return stay({});
}

function path(state: AppState, key: Key, stay: Stay, go: Go): Step {
  if (state.view.name !== 'path') return stay({});
  const value = state.view.value;
  if (key.name === 'escape') return go({ name: 'home' });
  if (key.name === 'enter') {
    return value.trim() === ''
      ? go({ name: 'home' })
      : go({ name: 'working', label: value.trim() }, { kind: 'openPath', path: value.trim() });
  }
  if (key.name === 'backspace') return stay({ view: { name: 'path', value: value.slice(0, -1) } });
  if (key.name === 'space') return stay({ view: { name: 'path', value: `${value} ` } });
  if (!key.ctrl && key.name.length === 1) {
    return stay({ view: { name: 'path', value: value + key.name } });
  }
  return stay({});
}

function paste(state: AppState, key: Key, stay: Stay, go: Go): Step {
  if (state.view.name !== 'paste') return stay({});
  const text = state.view.text;
  if (key.name === 'escape') return go({ name: 'home' });
  if (key.name === 'd' && key.ctrl) {
    return text.trim() === ''
      ? go({ name: 'home' })
      : go(
          { name: 'working', label: 'pasted log' },
          {
            kind: 'analyze',
            label: 'pasted log',
            source: { text },
          },
        );
  }
  const addition =
    key.name === 'enter' ? '\n' : key.name === 'space' ? ' ' : key.name === 'tab' ? '\t' : '';
  if (addition !== '') return stay({ view: { name: 'paste', text: text + addition } });
  if (key.name === 'backspace') return stay({ view: { name: 'paste', text: text.slice(0, -1) } });
  if (!key.ctrl && key.name.length === 1) {
    return stay({ view: { name: 'paste', text: text + key.name } });
  }
  return stay({});
}

function report(state: AppState, key: Key, stay: Stay, go: Go): Step {
  if (state.view.name !== 'report') return stay({});
  const view = state.view;
  const scrollBy = (delta: number): Step =>
    stay({ view: { ...view, scroll: Math.max(0, view.scroll + delta) } });

  if (key.name === 'down' || key.name === 'j') return scrollBy(1);
  if (key.name === 'up' || key.name === 'k') return scrollBy(-1);
  if (key.name === 'pagedown' || key.name === 'space') return scrollBy(10);
  if (key.name === 'pageup') return scrollBy(-10);
  if (key.name === 'home') return stay({ view: { ...view, scroll: 0 } });
  if (key.name === 'c') return stay({}, { kind: 'copy' });
  if (key.name === 'escape' || key.name === 'enter') return go({ name: 'home' });
  if (key.name === 'q') return stay({ quit: true }, { kind: 'quit' });
  return stay({});
}
