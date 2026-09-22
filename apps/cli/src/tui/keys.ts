/** Turns what a terminal sends on a keypress into something the menus can use. */

export interface Key {
  /** 'up', 'down', 'enter', 'escape', 'backspace', 'space', 'tab', or the character. */
  name: string;
  ctrl: boolean;
}

const SEQUENCES: Record<string, string> = {
  '\u001b[A': 'up',
  '\u001b[B': 'down',
  '\u001b[C': 'right',
  '\u001b[D': 'left',
  '\u001b[H': 'home',
  '\u001b[F': 'end',
  '\u001b[5~': 'pageup',
  '\u001b[6~': 'pagedown',
  '\u001bOA': 'up',
  '\u001bOB': 'down',
};

export function parseKey(data: string): Key {
  const mapped = SEQUENCES[data];
  if (mapped !== undefined) return { name: mapped, ctrl: false };

  switch (data) {
    case '\r':
    case '\n':
      return { name: 'enter', ctrl: false };
    case '\u001b':
      return { name: 'escape', ctrl: false };
    case '\u007f':
    case '\b':
      return { name: 'backspace', ctrl: false };
    case '\t':
      return { name: 'tab', ctrl: false };
    case ' ':
      return { name: 'space', ctrl: false };
    case '\u0003':
      return { name: 'c', ctrl: true };
    case '\u0004':
      return { name: 'd', ctrl: true };
    default:
      break;
  }

  // Ctrl+letter arrives as the control character at the same offset.
  const code = data.codePointAt(0) ?? 0;
  if (data.length === 1 && code > 0 && code < 27) {
    return { name: String.fromCharCode(code + 96), ctrl: true };
  }
  return { name: data, ctrl: false };
}
