/** Prints frames of the app as plain text, to check layout without a terminal. */
import { analyzeLog } from '@logsy/llm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { draw } from './draw.js';
import { initialState, type AppState } from './state.js';

const fixtures = fileURLToPath(new URL('../../../../evals/fixtures/', import.meta.url));
const log = await readFile(`${fixtures}vitest-dev-vitest-32539425329-96946672485.log`, 'utf8');
const result = await analyzeLog(log);

const base = initialState(
  [
    { label: 'vitest-dev/vitest', detail: 'Test Browser (playwright)', file: 'a.log' },
    { label: 'microsoft/TypeScript', detail: 'Baselines', file: 'b.log' },
    { label: 'pytest-dev/pytest', detail: 'test (3.12)', file: 'c.log' },
  ],
  'panel(groq:openai/gpt-oss-120b, gemini:gemini-flash-latest)',
);
const settled = { ...base, tick: 40, entered: 40 };

const frames: [string, AppState][] = [
  ['HOME', settled],
  ['HOME · Models focused', { ...settled, focus: 3 }],
  ['EXAMPLES', { ...settled, view: { name: 'examples' }, focus: 1 }],
  ['WORKING', { ...settled, view: { name: 'working', label: 'vitest-dev/vitest' } }],
  [
    'REPORT',
    { ...settled, view: { name: 'report', label: 'vitest-dev/vitest', result, scroll: 0 } },
  ],
];

for (const [title, state] of frames) {
  process.stdout.write(`\n=== ${title} ===\n`);
  process.stdout.write(`${draw(state, 92, 28).toText()}\n`);
}
