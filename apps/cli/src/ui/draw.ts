import { categoryLabel, isConfident, parseCommentMarkdown } from '@logsy/core';
import type { LogAnalysis } from '@logsy/llm';
import { displayWidth, wrap } from '../text.js';
import { createTheme } from '../theme.js';
import { renderMarkdown } from '../markdown.js';
import { Canvas } from './canvas.js';
import { BASE, FAINT, MUTED, PALETTE } from './palette.js';
import {
  background,
  buttonRow,
  gaugeBar,
  header,
  keyBar,
  list,
  pill,
  shimmerBar,
  spinnerFrame,
} from './widgets.js';
import { HOME_BUTTONS, type AppState } from './state.js';

/** Draws the whole app for one frame. Pure: state in, canvas out. */
export function draw(state: AppState, width: number, height: number): Canvas {
  const canvas = new Canvas(width, height, BASE);
  background(canvas);

  const reveal = Math.min(1, state.tick / 12);
  header(canvas, {
    subtitle: 'why your CI failed, explained',
    reveal,
    right: modelChip(state),
  });

  const body = { x: 2, y: 6, width: canvas.width - 4, height: canvas.height - 8 };
  switch (state.view.name) {
    case 'home':
      drawHome(canvas, state, body);
      break;
    case 'examples':
      drawExamples(canvas, state, body);
      break;
    case 'models':
      drawModels(canvas, state, body);
      break;
    case 'path':
      drawInput(canvas, body, 'Open a log file', state.view.value, 'Type a path, ↵ to analyze');
      break;
    case 'paste':
      drawPaste(canvas, body, state.view.text, state.tick);
      break;
    case 'working':
      drawWorking(canvas, body, state);
      break;
    case 'report':
      drawReport(canvas, body, state.view.label, state.view.result, state.view.scroll);
      break;
    case 'message':
      drawMessage(canvas, body, state.view);
      break;
  }

  keyBar(canvas, canvas.height - 1, keysFor(state));
  fadeIn(canvas, state.entered);
  return canvas;
}

function modelChip(state: AppState): string {
  if (state.modelLabel === null) return 'rules only';
  if (!state.settings.useLlm) return 'models off';
  return state.settings.skipRules ? `${state.modelLabel} · rules skipped` : state.modelLabel;
}

/** The first frames of a view are dimmed towards the background, so it fades in. */
function fadeIn(canvas: Canvas, entered: number): void {
  const frames = 6;
  if (entered < frames) canvas.fade(PALETTE.canvas, 1 - entered / frames);
}

interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clears the texture behind the first `rows` of a view, so headings read cleanly. */
function clear(canvas: Canvas, area: Area, rows: number): void {
  canvas.fill(area.x - 2, area.y, area.width + 4, rows, { bg: PALETTE.canvas });
}

function drawHome(canvas: Canvas, state: AppState, area: Area): void {
  clear(canvas, area, 6);
  canvas.text(area.x, area.y, 'Analyze a failed CI run', { ...BASE, bold: true });
  canvas.text(
    area.x,
    area.y + 1,
    'Rules first, then the models. Secrets are redacted before anything leaves this machine.',
    MUTED,
  );

  const pulse = state.tick / 6;
  buttonRow(
    canvas,
    area.x,
    area.y + 3,
    HOME_BUTTONS.map((label) => ({
      label,
      ...(label === 'Examples' ? { icon: '◆' } : {}),
      ...(label === 'Quit' ? { icon: '✕' } : {}),
    })),
    state.focus,
    pulse,
  );

  const panelY = area.y + 7;
  const panelHeight = Math.max(5, area.height - 9);
  canvas.box(area.x, panelY, area.width, panelHeight, {
    style: { fg: PALETTE.hairline, bg: PALETTE.canvas },
    fill: { bg: PALETTE.surface },
    title: 'What happens',
    titleStyle: { fg: PALETTE.muted, bg: PALETTE.canvas, bold: true },
  });

  const steps = [
    ['1', 'Clean the log', 'strip colours and timestamps, find the failing step'],
    ['2', 'Redact secrets', 'tokens, keys and credentials never leave the machine'],
    ['3', 'Locate the error', 'the first root error, trimmed to a budget'],
    ['4', 'Explain it', 'a rule if one matches, otherwise the models vote'],
    ['5', 'Write the comment', 'exactly what Logsy would post on the pull request'],
  ];
  steps.slice(0, Math.max(0, panelHeight - 2)).forEach(([number, title, detail], index) => {
    const y = panelY + 1 + index;
    canvas.text(area.x + 2, y, number ?? '', {
      fg: PALETTE.accent,
      bg: PALETTE.surface,
      bold: true,
    });
    canvas.text(area.x + 5, y, title ?? '', { fg: PALETTE.ink, bg: PALETTE.surface });
    canvas.text(area.x + 24, y, detail ?? '', {
      fg: PALETTE.faint,
      bg: PALETTE.surface,
    });
  });
}

function drawExamples(canvas: Canvas, state: AppState, area: Area): void {
  clear(canvas, area, 2);
  canvas.text(area.x, area.y, 'Example failures', { ...BASE, bold: true });
  canvas.text(area.x, area.y + 1, 'Real logs from public projects.', MUTED);

  const panelHeight = area.height - 3;
  canvas.box(area.x, area.y + 2, area.width, panelHeight, {
    style: { fg: PALETTE.hairline, bg: PALETTE.canvas },
    fill: { bg: PALETTE.surface },
  });
  list(
    canvas,
    { x: area.x + 1, y: area.y + 3, width: area.width - 2, height: panelHeight - 2 },
    state.examples.map((example) => ({
      label: example.label,
      ...(example.detail === null ? {} : { hint: example.detail }),
    })),
    state.focus,
  );
}

function drawModels(canvas: Canvas, state: AppState, area: Area): void {
  clear(canvas, area, 3);
  canvas.text(area.x, area.y, 'Models', { ...BASE, bold: true });
  canvas.text(area.x, area.y + 1, state.modelLabel ?? 'No model configured; see .env', MUTED);

  const rows = [
    ['Ask the models when no rule matches', state.settings.useLlm],
    ['Skip the rules entirely', state.settings.skipRules],
  ] as const;

  canvas.box(area.x, area.y + 3, area.width, 6, {
    style: { fg: PALETTE.hairline, bg: PALETTE.canvas },
    fill: { bg: PALETTE.surface },
  });
  rows.forEach(([label, on], index) => {
    const y = area.y + 4 + index * 2;
    const focused = state.focus === index;
    const enabled = state.modelLabel !== null && (index === 0 || state.settings.useLlm);
    const style = {
      bg: PALETTE.surface,
      fg: enabled ? PALETTE.ink : PALETTE.faint,
      bold: focused,
    };
    canvas.text(area.x + 2, y, focused ? '▸' : ' ', { ...style, fg: PALETTE.accent });
    canvas.text(area.x + 4, y, on ? '◉' : '○', {
      ...style,
      fg: on ? PALETTE.success : PALETTE.faint,
    });
    canvas.text(area.x + 6, y, label, style);
  });
}

function drawInput(canvas: Canvas, area: Area, title: string, value: string, hint: string): void {
  clear(canvas, area, 8);
  canvas.text(area.x, area.y, title, { ...BASE, bold: true });
  canvas.box(area.x, area.y + 2, area.width, 3, {
    style: { fg: PALETTE.accent, bg: PALETTE.canvas },
    fill: { bg: PALETTE.surface },
  });
  canvas.text(area.x + 2, area.y + 3, `${value}▏`, { fg: PALETTE.ink, bg: PALETTE.surface });
  canvas.text(area.x, area.y + 6, hint, FAINT);
}

function drawPaste(canvas: Canvas, area: Area, text: string, tick: number): void {
  clear(canvas, area, 3);
  canvas.text(area.x, area.y, 'Paste a log', { ...BASE, bold: true });
  canvas.text(area.x, area.y + 1, 'Paste into this window, then press Ctrl+D.', MUTED);

  canvas.box(area.x, area.y + 3, area.width, 5, {
    style: { fg: PALETTE.hairline, bg: PALETTE.canvas },
    fill: { bg: PALETTE.surface },
  });
  const count = `${text.length.toLocaleString('en-US')} characters received`;
  canvas.text(area.x + 2, area.y + 5, count, { fg: PALETTE.ink, bg: PALETTE.surface });
  if (text.length > 0) {
    canvas.text(area.x + area.width - 4, area.y + 5, spinnerFrame(tick), {
      fg: PALETTE.accent,
      bg: PALETTE.surface,
    });
  }
}

function drawWorking(canvas: Canvas, area: Area, state: AppState): void {
  if (state.view.name !== 'working') return;
  const middle = area.y + Math.floor(area.height / 2) - 2;
  canvas.fill(area.x, middle - 1, area.width, 8, { bg: PALETTE.canvas });

  canvas.centered(area.x, middle, area.width, `${spinnerFrame(state.tick)}  Analyzing`, {
    ...BASE,
    bold: true,
  });
  canvas.centered(area.x, middle + 1, area.width, state.view.label, MUTED);
  const barWidth = Math.min(48, area.width - 4);
  shimmerBar(
    canvas,
    area.x + Math.floor((area.width - barWidth) / 2),
    middle + 3,
    barWidth,
    state.tick,
  );
  canvas.centered(
    area.x,
    middle + 5,
    area.width,
    state.settings.useLlm && state.modelLabel !== null
      ? 'Rules answer instantly; the models take a few seconds.'
      : 'Matching rules…',
    FAINT,
  );
}

function drawMessage(
  canvas: Canvas,
  area: Area,
  view: { title: string; body: string; tone: 'warning' | 'danger' | 'success' },
): void {
  const colour =
    view.tone === 'danger'
      ? PALETTE.danger
      : view.tone === 'success'
        ? PALETTE.success
        : PALETTE.warning;
  canvas.box(area.x, area.y + 1, area.width, 6, {
    style: { fg: colour, bg: PALETTE.canvas },
    fill: { bg: PALETTE.surface },
  });
  canvas.text(area.x + 2, area.y + 2, view.title, { fg: colour, bg: PALETTE.surface, bold: true });
  wrap(view.body, area.width - 4)
    .slice(0, 3)
    .forEach((line, index) => {
      canvas.text(area.x + 2, area.y + 4 + index, line, { fg: PALETTE.ink, bg: PALETTE.surface });
    });
}

function drawReport(
  canvas: Canvas,
  area: Area,
  label: string,
  result: LogAnalysis,
  scroll: number,
): void {
  const { analysis, context } = result;
  const confident = isConfident(analysis);
  const tone = confident ? PALETTE.success : PALETTE.warning;

  // The verdict card.
  canvas.box(area.x, area.y, area.width, 8, {
    style: { fg: PALETTE.hairline, bg: PALETTE.canvas },
    fill: { bg: PALETTE.surface },
    title: label,
    titleStyle: { fg: PALETTE.muted, bg: PALETTE.canvas, bold: true },
  });

  const badgeWidth = pill(canvas, area.x + 2, area.y + 1, categoryLabel(analysis.category), tone);
  gaugeBar(canvas, area.x + badgeWidth + 4, area.y + 1, 10, analysis.confidence, tone);
  canvas.text(
    area.x + badgeWidth + 16,
    area.y + 1,
    `${String(Math.round(analysis.confidence * 100))}%`,
    { fg: PALETTE.muted, bg: PALETTE.surface },
  );

  canvas.text(
    area.x + 2,
    area.y + 3,
    confident ? analysis.title : 'Not sure enough to explain it',
    { fg: confident ? PALETTE.ink : PALETTE.warning, bg: PALETTE.surface, bold: true },
  );

  const rows: [string, string][] = [
    ['Decided by', decidedBy(result)],
    [
      'Log',
      `${context.charsOriginal.toLocaleString('en-US')} chars → ${context.charsExcerpt.toLocaleString('en-US')} kept · ${
        result.redactions === 0 ? 'no secrets' : `${String(result.redactions)} redacted`
      }`,
    ],
    ['Step', context.stepName ?? 'not identified'],
  ];
  rows.forEach(([name, value], index) => {
    const y = area.y + 4 + index;
    canvas.text(area.x + 2, y, name, { fg: PALETTE.faint, bg: PALETTE.surface });
    canvas.text(area.x + 15, y, value, { fg: PALETTE.ink, bg: PALETTE.surface }, area.width - 18);
  });

  // The comment, scrollable.
  const commentY = area.y + 9;
  const commentHeight = area.height - 10;
  if (commentHeight < 3) return;
  canvas.box(area.x, commentY, area.width, commentHeight, {
    style: { fg: PALETTE.hairline, bg: PALETTE.canvas },
    fill: { bg: PALETTE.surface },
    title: 'Pull request comment',
    titleStyle: { fg: PALETTE.muted, bg: PALETTE.canvas, bold: true },
  });

  const theme = createTheme({ level: 'none', interactive: false, width: area.width - 4 });
  const lines = renderMarkdown(parseCommentMarkdown(result.comment), theme, area.width - 6);
  const visible = commentHeight - 2;
  const maxScroll = Math.max(0, lines.length - visible);
  const top = Math.min(scroll, maxScroll);

  lines.slice(top, top + visible).forEach((line, index) => {
    canvas.text(
      area.x + 2,
      commentY + 1 + index,
      line,
      { fg: PALETTE.ink, bg: PALETTE.surface },
      area.width - 4,
    );
  });

  if (lines.length > visible) {
    const thumb = Math.round((top / Math.max(1, maxScroll)) * (visible - 1));
    for (let index = 0; index < visible; index += 1) {
      canvas.set(area.x + area.width - 2, commentY + 1 + index, index === thumb ? '█' : '│', {
        fg: index === thumb ? PALETTE.accent : PALETTE.hairline,
        bg: PALETTE.surface,
      });
    }
  }
}

function decidedBy(result: LogAnalysis): string {
  if (result.source === 'rule') return `rule ${result.ruleId ?? '?'} · no model call`;
  if (result.llm) {
    const tokens = result.llm.usage.inputTokens + result.llm.usage.outputTokens;
    return `${result.llm.model} · ${(result.llm.latencyMs / 1000).toFixed(1)}s · ${tokens.toLocaleString('en-US')} tokens`;
  }
  return 'nothing: no rule matched and no model was asked';
}

function keysFor(state: AppState): [string, string][] {
  switch (state.view.name) {
    case 'home':
      return [
        ['←→', 'move'],
        ['↵', 'select'],
        ['q', 'quit'],
      ];
    case 'examples':
      return [
        ['↑↓', 'move'],
        ['↵', 'analyze'],
        ['esc', 'back'],
      ];
    case 'models':
      return [
        ['↑↓', 'move'],
        ['↵', 'toggle'],
        ['esc', 'back'],
      ];
    case 'path':
      return [
        ['↵', 'analyze'],
        ['esc', 'back'],
      ];
    case 'paste':
      return [
        ['ctrl+d', 'analyze'],
        ['esc', 'back'],
      ];
    case 'working':
      return [['ctrl+c', 'stop']];
    case 'report':
      return [
        ['↑↓', 'scroll'],
        ['c', 'copy'],
        ['esc', 'back'],
        ['q', 'quit'],
      ];
    case 'message':
      return [['↵', 'back']];
  }
}

/** Exported for the tests, which assert on the plain text of a frame. */
export function frameText(state: AppState, width: number, height: number): string {
  return draw(state, width, height).toText();
}

export function frameWidthOf(text: string): number {
  return Math.max(...text.split('\n').map((line) => displayWidth(line)));
}
