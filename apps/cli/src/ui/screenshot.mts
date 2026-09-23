/**
 * Renders frames of the app to SVG, so the README shows the real thing rather than a
 * mock-up: `pnpm --filter @logsy/cli screenshots`.
 */
import { analyzeLog } from '@logsy/llm';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { draw } from './draw.js';
import { initialState, type AppState } from './state.js';
import type { Cell } from './canvas.js';

const root = new URL('../../../../', import.meta.url);
const fixtures = fileURLToPath(new URL('evals/fixtures/', root));
const assets = fileURLToPath(new URL('docs/assets/', root));

const CELL_WIDTH = 8.4;
const CELL_HEIGHT = 18;
const PADDING = 16;

function escapeXml(text: string): string {
  return text.replace(/[<>&]/g, (character) =>
    character === '<' ? '&lt;' : character === '>' ? '&gt;' : '&amp;',
  );
}

const rgb = (colour: readonly [number, number, number] | undefined, fallback: string) =>
  colour ? `rgb(${colour[0]},${colour[1]},${colour[2]})` : fallback;

/** One <rect> per background run and one <text> per foreground run keeps the file small. */
function toSvg(rows: readonly (readonly Cell[])[]): string {
  const width = (rows[0]?.length ?? 0) * CELL_WIDTH + PADDING * 2;
  const height = rows.length * CELL_HEIGHT + PADDING * 2;
  const parts: string[] = [];

  rows.forEach((row, y) => {
    let runStart = 0;
    let runColour = rgb(row[0]?.style.bg, '#0a0a0c');
    const flush = (end: number) => {
      if (end > runStart) {
        parts.push(
          `<rect x="${(PADDING + runStart * CELL_WIDTH).toFixed(1)}" y="${(PADDING + y * CELL_HEIGHT).toFixed(1)}" width="${((end - runStart) * CELL_WIDTH).toFixed(1)}" height="${CELL_HEIGHT}" fill="${runColour}"/>`,
        );
      }
    };
    row.forEach((cell, x) => {
      const colour = rgb(cell.style.bg, '#0a0a0c');
      if (colour !== runColour) {
        flush(x);
        runStart = x;
        runColour = colour;
      }
    });
    flush(row.length);

    // Runs of one colour become one <text>; textLength keeps the grid exact.
    let textStart = 0;
    let textRun = '';
    let textStyle = row[0]?.style;
    const flushText = () => {
      if (textRun.trim() !== '') {
        const weight = textStyle?.bold === true ? ' font-weight="600"' : '';
        const width = (textRun.length * CELL_WIDTH).toFixed(1);
        parts.push(
          `<text x="${(PADDING + textStart * CELL_WIDTH).toFixed(1)}" y="${(PADDING + y * CELL_HEIGHT + 13).toFixed(1)}" fill="${rgb(textStyle?.fg, '#fafafa')}"${weight} textLength="${width}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${escapeXml(textRun)}</text>`,
        );
      }
      textRun = '';
    };

    row.forEach((cell, x) => {
      if (cell.skip) return;
      const style = cell.style;
      const sameStyle =
        rgb(style.fg, '') === rgb(textStyle?.fg, '') && style.bold === textStyle?.bold;
      if (!sameStyle) {
        flushText();
        textStart = x;
        textStyle = style;
      }
      if (textRun === '') textStart = x;
      textRun += cell.ch === '' ? ' ' : cell.ch;
    });
    flushText();
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="13">`,
    `<rect width="100%" height="100%" rx="10" fill="#0a0a0c"/>`,
    ...parts,
    '</svg>',
  ].join('');
}

async function main(): Promise<void> {
  const log = await readFile(`${fixtures}vitest-dev-vitest-32539425329-96946672485.log`, 'utf8');
  const result = await analyzeLog(log);

  const base: AppState = {
    ...initialState(
      [
        { label: 'apache/maven', detail: 'Maven Verify (ubuntu, 21)', file: 'a.log' },
        { label: 'docker/compose', detail: 'test (1.23)', file: 'b.log' },
        { label: 'microsoft/TypeScript', detail: 'Baselines', file: 'c.log' },
        { label: 'pandas-dev/pandas', detail: 'Unit Tests (3.12)', file: 'd.log' },
        { label: 'pytest-dev/pytest', detail: 'test (3.12, ubuntu)', file: 'e.log' },
        { label: 'vitest-dev/vitest', detail: 'Test Browser (playwright)', file: 'f.log' },
      ],
      'panel(groq:gpt-oss-120b, gemini-flash, qwen3.8-27b)',
    ),
    tick: 40,
    entered: 40,
  };

  const frames: [string, AppState][] = [
    ['cli-home', base],
    ['cli-examples', { ...base, view: { name: 'examples' }, focus: 5 }],
    [
      'cli-report',
      { ...base, view: { name: 'report', label: 'vitest-dev/vitest', result, scroll: 0 } },
    ],
  ];

  await mkdir(assets, { recursive: true });
  for (const [name, state] of frames) {
    const svg = toSvg(draw(state, 96, 30).rows());
    await writeFile(`${assets}${name}.svg`, svg, 'utf8');
    process.stdout.write(`${name}.svg ${String(Math.round(svg.length / 1024))} KB\n`);
  }
}

await main();
