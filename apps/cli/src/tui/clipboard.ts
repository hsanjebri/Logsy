import { spawn } from 'node:child_process';

/** The clipboard tool each platform ships with; Linux may have neither. */
function command(): { file: string; args: string[] } | null {
  if (process.platform === 'win32') return { file: 'clip', args: [] };
  if (process.platform === 'darwin') return { file: 'pbcopy', args: [] };
  return { file: 'xclip', args: ['-selection', 'clipboard'] };
}

/** Copies text, reporting failure instead of throwing: this is never essential. */
export async function copyToClipboard(text: string): Promise<boolean> {
  const tool = command();
  if (!tool) return false;

  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(tool.file, tool.args, { stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', () => {
        resolve(false);
      });
      child.on('close', (code) => {
        resolve(code === 0);
      });
      child.stdin.end(text, 'utf8');
    } catch {
      resolve(false);
    }
  });
}
