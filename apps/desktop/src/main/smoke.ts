/**
 * Development entry point: starts the real app, clicks the first example, prints what
 * the window ends up showing and saves a screenshot. Used to check the app actually
 * works without a person watching it: `pnpm --filter @logsy/desktop smoke`.
 */
import { app, type BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import './main.js';

const out = process.env.LOGSY_SMOKE_OUT ?? 'smoke.png';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.on('browser-window-created', (_event, window: BrowserWindow) => {
  window.webContents.once('did-finish-load', () => {
    void (async () => {
      try {
        await wait(1_500);
        const clicked: unknown = await window.webContents.executeJavaScript(
          `(() => {
             const button = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('vitest'));
             if (!button) return null;
             button.click();
             return button.textContent;
           })()`,
        );
        process.stdout.write(`clicked example: ${String(clicked)}\n`);
        await wait(Number(process.env.LOGSY_SMOKE_WAIT ?? 12_000));
        const text: unknown = await window.webContents.executeJavaScript(
          'document.body.innerText.slice(0, 1400)',
        );
        process.stdout.write(`--- window text ---\n${String(text)}\n--- end ---\n`);
        await writeFile(out, (await window.webContents.capturePage()).toPNG());
        process.stdout.write(`screenshot: ${out}\n`);
      } catch (error) {
        process.stderr.write(`smoke failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      app.quit();
    })();
  });
});
