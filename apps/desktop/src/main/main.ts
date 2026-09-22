import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, models, type AnalyzeRequest } from './analysis.js';
import { listExamples, readExample } from './examples.js';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');

// Logsy keeps one .env at the repository root; set variables always win.
const rootEnv = resolve(appRoot, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f6f6f7',
    title: 'Logsy',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      // The window runs no Node: it reaches the analysis only through the preload bridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });
  // Links in a comment belong in the browser, never in this window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  void window.loadFile(join(here, '../renderer/index.html'));
  return window;
}

ipcMain.handle('logsy:status', () => models().status);
ipcMain.handle('logsy:examples', () => listExamples(appRoot));
ipcMain.handle('logsy:example', (_event, id: unknown) =>
  typeof id === 'string' ? readExample(appRoot, id) : null,
);
ipcMain.handle('logsy:analyze', (_event, request: AnalyzeRequest) => analyze(request));
ipcMain.handle('logsy:open', async () => {
  const chosen = await dialog.showOpenDialog({
    title: 'Open a CI log',
    filters: [{ name: 'Logs', extensions: ['log', 'txt'] }],
    properties: ['openFile'],
  });
  const file = chosen.filePaths[0];
  if (chosen.canceled || file === undefined) return null;
  return { name: basename(file), text: await readFile(file, 'utf8') };
});

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
