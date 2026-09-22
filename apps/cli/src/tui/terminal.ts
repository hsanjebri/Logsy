import { parseKey, type Key } from './keys.js';

/**
 * The bits of a terminal the interactive mode needs. A narrow interface so the
 * menus can be driven by a script in tests.
 */
export interface Terminal {
  write(text: string): void;
  readKey(): Promise<Key>;
  /** Erases the given number of lines above the cursor. */
  eraseLines(count: number): void;
  columns: number;
}

export interface RealTerminal extends Terminal {
  close(): void;
}

export function openTerminal(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): RealTerminal {
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  output.write('\u001b[?25l'); // hide the cursor while menus are drawn

  return {
    columns: output.columns,
    write: (text) => {
      output.write(text);
    },
    eraseLines: (count) => {
      if (count > 0) output.write(`\u001b[${String(count)}F\u001b[0J`);
    },
    readKey: () =>
      new Promise<Key>((resolve) => {
        const onData = (chunk: string) => {
          input.off('data', onData);
          resolve(parseKey(chunk));
        };
        input.on('data', onData);
      }),
    close: () => {
      output.write('\u001b[?25h');
      input.setRawMode(wasRaw);
      input.pause();
    },
  };
}
