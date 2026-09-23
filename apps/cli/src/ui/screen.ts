import { parseKey, type Key } from '../tui/keys.js';

/**
 * Owns the terminal while the app runs: the alternate screen buffer, raw input and
 * the frame loop. Everything it touches is put back on close, including after a crash.
 */
export interface Screen {
  readonly width: number;
  readonly height: number;
  paint(frame: string): void;
  onKey(handler: (key: Key) => void): void;
  onResize(handler: () => void): void;
  close(): void;
}

const ALT_SCREEN_ON = '\u001b[?1049h';
const ALT_SCREEN_OFF = '\u001b[?1049l';
const HIDE_CURSOR = '\u001b[?25l';
const SHOW_CURSOR = '\u001b[?25h';
const HOME = '\u001b[H';

export function openScreen(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Screen {
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  output.write(ALT_SCREEN_ON + HIDE_CURSOR);

  let keyHandler: (key: Key) => void = () => undefined;
  let resizeHandler: () => void = () => undefined;

  const onData = (chunk: string) => {
    keyHandler(parseKey(chunk));
  };
  const onResize = () => {
    resizeHandler();
  };
  input.on('data', onData);
  output.on('resize', onResize);

  let closed = false;
  const screen: Screen = {
    get width() {
      return output.columns;
    },
    get height() {
      return output.rows;
    },
    // A whole frame at once, from the home position: no flicker, no scrollback.
    paint: (frame) => {
      if (!closed) output.write(HOME + frame);
    },
    onKey: (handler) => {
      keyHandler = handler;
    },
    onResize: (handler) => {
      resizeHandler = handler;
    },
    close: () => {
      if (closed) return;
      closed = true;
      input.off('data', onData);
      output.off('resize', onResize);
      output.write(SHOW_CURSOR + ALT_SCREEN_OFF);
      input.setRawMode(wasRaw);
      input.pause();
    },
  };
  return screen;
}

/** ~20 frames a second: smooth enough for the animations, cheap on a laptop. */
export const FRAME_MS = 50;
