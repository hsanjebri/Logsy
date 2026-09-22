import type { Theme } from './theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface Spinner {
  stop(): void;
}

/**
 * A spinner with the elapsed time, on stderr so piping the report stays clean.
 * Outside a terminal it prints one line and nothing moves.
 */
export function startSpinner(
  label: string,
  theme: Theme,
  stream: NodeJS.WritableStream = process.stderr,
): Spinner {
  if (!theme.interactive) {
    stream.write(`${label}\n`);
    return { stop: () => undefined };
  }

  const startedAt = Date.now();
  let frame = 0;
  const draw = () => {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const symbol = theme.accent(FRAMES[frame % FRAMES.length] ?? '⠋');
    stream.write(`\r\u001b[2K${symbol} ${label} ${theme.dim(`${seconds}s`)}`);
    frame += 1;
  };

  draw();
  const timer = setInterval(draw, 80);
  timer.unref();

  return {
    stop: () => {
      clearInterval(timer);
      stream.write('\r\u001b[2K');
    },
  };
}
