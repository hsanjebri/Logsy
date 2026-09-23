import { analyzeLog, type LogAnalysis } from '@logsy/llm';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseKey } from '../tui/keys.js';
import { displayWidth } from '../text.js';
import { Canvas, mix } from './canvas.js';
import { draw } from './draw.js';
import { PALETTE } from './palette.js';
import { initialState, reduce, type AppState } from './state.js';
import { button, list } from './widgets.js';

const WIDTH = 92;
const HEIGHT = 28;

const examples = [
  { label: 'vitest-dev/vitest', detail: 'Test Browser', file: 'a.log' },
  { label: 'microsoft/TypeScript', detail: 'Baselines', file: 'b.log' },
];

function press(state: AppState, ...keys: string[]): { state: AppState; effects: unknown[] } {
  const effects: unknown[] = [];
  let next = state;
  for (const raw of keys) {
    const step = reduce(next, parseKey(raw));
    next = step.state;
    if (step.effect.kind !== 'none') effects.push(step.effect);
  }
  return { state: next, effects };
}

const DOWN = '\u001b[B';
const RIGHT = '\u001b[C';
const LEFT = '\u001b[D';
const ENTER = '\r';

describe('canvas', () => {
  it('keeps every row exactly as wide as the canvas', () => {
    const canvas = new Canvas(20, 3, { fg: PALETTE.ink, bg: PALETTE.canvas });
    canvas.text(0, 0, 'hello');
    canvas.text(0, 1, '🧪 emoji takes two columns and is then clipped');
    const rows = canvas.toText().split('\n');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(displayWidth(row)).toBe(20);
  });

  it('draws a box with rounded corners and an inset title', () => {
    const canvas = new Canvas(12, 3);
    canvas.box(0, 0, 12, 3, { title: 'Hi' });
    expect(canvas.toText().split('\n')).toEqual(['╭─ Hi ─────╮', '│          │', '╰──────────╯']);
  });

  it('clips text at the edge instead of spilling into the next row', () => {
    const canvas = new Canvas(6, 1);
    canvas.text(0, 0, 'abcdefghij');
    expect(canvas.toText()).toBe('abcdef');
  });

  it('fades colours towards the background', () => {
    const canvas = new Canvas(3, 1, { fg: PALETTE.ink, bg: PALETTE.canvas });
    canvas.text(0, 0, 'abc', { fg: PALETTE.accent, bg: PALETTE.canvas });
    const before = canvas.render();
    canvas.fade(PALETTE.canvas, 1);
    expect(canvas.render()).not.toBe(before);
    // Fully faded means the text colour is the background colour.
    expect(canvas.render()).toContain(
      `38;2;${PALETTE.canvas[0]};${PALETTE.canvas[1]};${PALETTE.canvas[2]}`,
    );
  });

  it('mixes colours proportionally', () => {
    expect(mix([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25]);
    expect(mix([0, 0, 0], [10, 10, 10], 2)).toEqual([10, 10, 10]);
  });
});

describe('widgets', () => {
  it('marks the focused button and leaves the others plain', () => {
    const canvas = new Canvas(40, 3);
    button(canvas, 0, 0, { label: 'Examples' }, { focused: true });
    expect(canvas.toText()).toContain('▸ Examples');

    const other = new Canvas(40, 3);
    button(other, 0, 0, { label: 'Examples' }, { focused: false });
    expect(other.toText()).toContain('Examples');
    expect(other.toText()).not.toContain('▸');
  });

  it('shows a scrollbar only when the rows do not fit', () => {
    const many = new Canvas(30, 3);
    list(
      many,
      { x: 0, y: 0, width: 30, height: 3 },
      Array.from({ length: 9 }, (_unused, index) => ({ label: `row ${String(index)}` })),
      8,
    );
    expect(many.toText()).toContain('█');

    const few = new Canvas(30, 3);
    list(few, { x: 0, y: 0, width: 30, height: 3 }, [{ label: 'only' }], 0);
    expect(few.toText()).not.toContain('█');
  });
});

describe('keyboard', () => {
  const home = initialState(examples, 'panel(two models)');

  it('moves along the buttons and wraps at both ends', () => {
    expect(press(home, RIGHT, RIGHT).state.focus).toBe(2);
    expect(press(home, LEFT).state.focus).toBe(4);
    expect(press(home, RIGHT, RIGHT, RIGHT, RIGHT, RIGHT).state.focus).toBe(0);
  });

  it('opens the examples list and analyzes the chosen log', () => {
    const opened = press(home, ENTER);
    expect(opened.state.view.name).toBe('examples');

    const chosen = press(opened.state, DOWN, ENTER);
    expect(chosen.state.view).toMatchObject({ name: 'working', label: 'microsoft/TypeScript' });
    expect(chosen.effects).toEqual([
      { kind: 'analyze', label: 'microsoft/TypeScript', source: { file: 'b.log' } },
    ]);
  });

  it('says so instead of opening an empty list', () => {
    const empty = initialState([], null);
    expect(press(empty, ENTER).state.view).toMatchObject({
      name: 'message',
      title: 'No bundled examples',
    });
  });

  it('toggles the model settings, and never skips rules with the models off', () => {
    const models = press(home, RIGHT, RIGHT, RIGHT, ENTER).state;
    expect(models.view.name).toBe('models');

    const skipping = press(models, DOWN, ENTER).state;
    expect(skipping.settings).toEqual({ useLlm: true, skipRules: true });

    const modelsOff = press(skipping, DOWN, ENTER).state;
    expect(modelsOff.settings).toEqual({ useLlm: false, skipRules: false });
  });

  it('types a path and analyzes it', () => {
    const typing = press(home, RIGHT, ENTER, 'c', 'i', '.', 'l', 'o', 'g');
    expect(typing.state.view).toEqual({ name: 'path', value: 'ci.log' });

    const submitted = press(typing.state, ENTER);
    expect(submitted.effects).toEqual([{ kind: 'openPath', path: 'ci.log' }]);
  });

  it('collects a pasted log until Ctrl+D', () => {
    const pasting = press(home, RIGHT, RIGHT, ENTER, 'a', ENTER, 'b');
    expect(pasting.state.view).toEqual({ name: 'paste', text: 'a\nb' });
    expect(press(pasting.state, '\u0004').effects).toEqual([
      { kind: 'analyze', label: 'pasted log', source: { text: 'a\nb' } },
    ]);
  });

  it('quits on q and on Ctrl+C from anywhere', () => {
    expect(press(home, 'q').state.quit).toBe(true);
    expect(press(home, ENTER, '\u0003').state.quit).toBe(true);
  });
});

describe('frames', () => {
  let result: LogAnalysis;

  beforeAll(async () => {
    result = await analyzeLog(
      [
        '##[group]Run npm ci',
        'npm ERR! code ERESOLVE',
        'npm ERR! ERESOLVE unable to resolve dependency tree',
        '##[error]Process completed with exit code 1.',
      ].join('\n'),
    );
  });

  const settled = (state: AppState): AppState => ({ ...state, tick: 40, entered: 40 });

  it('fills the terminal exactly, every view, every size', () => {
    const state = settled(initialState(examples, 'panel(two models)'));
    for (const [width, height] of [
      [92, 28],
      [60, 20],
      [140, 45],
    ] as const) {
      for (const view of [
        { name: 'home' } as const,
        { name: 'examples' } as const,
        { name: 'models' } as const,
        { name: 'working', label: 'x.log' } as const,
        { name: 'report', label: 'x.log', result, scroll: 0 } as const,
      ]) {
        const rows = draw({ ...state, view }, width, height)
          .toText()
          .split('\n');
        expect(rows).toHaveLength(height);
        for (const row of rows) expect(displayWidth(row)).toBe(width);
      }
    }
  });

  it('draws the home screen with its buttons and key hints', () => {
    const text = draw(settled(initialState(examples, 'two models')), WIDTH, HEIGHT).toText();
    expect(text).toContain('LOGSY');
    expect(text).toContain('▸ ◆ Examples');
    expect(text).toContain('Open file');
    expect(text).toContain('two models');
    expect(text).toContain('↵  select');
  });

  it('draws the report with the verdict, the gauge and the comment', () => {
    const state = settled(initialState(examples, null));
    const text = draw(
      { ...state, view: { name: 'report', label: 'ci.log', result, scroll: 0 } },
      WIDTH,
      HEIGHT,
    ).toText();

    expect(text).toContain('Dependency error');
    expect(text).toContain('▰▰▰▰▰▰▰▰▰▱');
    expect(text).toContain('rule npm-eresolve');
    expect(text).toContain('Pull request comment');
    expect(text).toContain('c  copy');
  });

  it('animates: the wordmark sweeps in and the spinner turns', () => {
    const state = initialState(examples, null);
    const first = draw({ ...state, tick: 0, entered: 40 }, WIDTH, HEIGHT).toText();
    const later = draw({ ...state, tick: 40, entered: 40 }, WIDTH, HEIGHT).toText();
    expect(first).not.toContain('LOGSY');
    expect(later).toContain('LOGSY');

    const working = { ...state, view: { name: 'working', label: 'x' } as const, entered: 40 };
    const frames = [0, 1, 2].map((tick) => draw({ ...working, tick }, WIDTH, HEIGHT).toText());
    expect(new Set(frames).size).toBe(3);
  });

  it('fades a view in over its first frames', () => {
    const state = initialState(examples, null);
    const entering = draw({ ...state, tick: 40, entered: 0 }, WIDTH, HEIGHT).render();
    const settledFrame = draw({ ...state, tick: 40, entered: 40 }, WIDTH, HEIGHT).render();
    expect(entering).not.toBe(settledFrame);
  });
});
