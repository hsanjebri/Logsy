/**
 * Colour, chosen once per run. A terminal that cannot show colour, a pipe, or
 * NO_COLOR all get the same text without escape codes.
 */

export type Paint = (text: string) => string;

export interface Theme {
  bold: Paint;
  dim: Paint;
  ink: Paint;
  accent: Paint;
  success: Paint;
  warning: Paint;
  danger: Paint;
  /** Category badge: dark text on a coloured block. */
  badge: (text: string, tone: Tone) => string;
  link: (label: string, href: string) => string;
  /** True when the output is a terminal a person is watching. */
  interactive: boolean;
  width: number;
}

export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

export type ColorLevel = 'none' | 'ansi256' | 'truecolor';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Logsy's palette, the dashboard's colours adjusted for a dark terminal. */
const TONES: Record<Tone, Rgb> = {
  accent: { r: 124, g: 156, b: 255 },
  success: { r: 74, g: 222, b: 128 },
  warning: { r: 240, g: 180, b: 41 },
  danger: { r: 248, g: 113, b: 113 },
  neutral: { r: 161, g: 162, b: 169 },
};

/** Closest xterm-256 index, for terminals without 24-bit colour. */
function to256({ r, g, b }: Rgb): number {
  const level = (value: number) => Math.round((Math.max(0, Math.min(255, value)) / 255) * 5);
  return 16 + 36 * level(r) + 6 * level(g) + level(b);
}

export function colorLevel(env: NodeJS.ProcessEnv, isTty: boolean): ColorLevel {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 'none';
  if (env.FORCE_COLOR === '3') return 'truecolor';
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return 'ansi256';
  if (!isTty) return 'none';
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 'truecolor';
  // Windows Terminal, VS Code and modern xterms all do 24-bit colour.
  if (env.WT_SESSION !== undefined || env.TERM_PROGRAM === 'vscode') return 'truecolor';
  if (env.TERM === 'dumb' || env.TERM === undefined) return 'none';
  return 'ansi256';
}

export function createTheme(options: {
  level: ColorLevel;
  interactive: boolean;
  width: number;
}): Theme {
  const { level, interactive } = options;
  // Narrow enough for a split pane, capped so long lines stay readable.
  const width = Math.max(40, Math.min(options.width, 110));
  const plain: Paint = (text) => text;

  if (level === 'none') {
    return {
      bold: plain,
      dim: plain,
      ink: plain,
      accent: plain,
      success: plain,
      warning: plain,
      danger: plain,
      badge: (text) => text,
      link: (label, href) => (label === href ? label : `${label} (${href})`),
      interactive,
      width,
    };
  }

  const wrap =
    (open: string, close: string): Paint =>
    (text) =>
      `\u001b[${open}m${text}\u001b[${close}m`;
  const fg = (tone: Tone): Paint => {
    const rgb = TONES[tone];
    const code = level === 'truecolor' ? `38;2;${rgb.r};${rgb.g};${rgb.b}` : `38;5;${to256(rgb)}`;
    return wrap(code, '39');
  };

  return {
    bold: wrap('1', '22'),
    dim: wrap('2', '22'),
    ink: plain,
    accent: fg('accent'),
    success: fg('success'),
    warning: fg('warning'),
    danger: fg('danger'),
    badge: (text, tone) => {
      const rgb = TONES[tone];
      const background =
        level === 'truecolor' ? `48;2;${rgb.r};${rgb.g};${rgb.b}` : `48;5;${to256(rgb)}`;
      return `\u001b[${background};30m ${text} \u001b[49;39m`;
    },
    // OSC 8: terminals that understand it show a clickable label, the rest ignore it.
    link: (label, href) =>
      `\u001b]8;;${href}\u0007${wrap('4', '24')(fg('accent')(label))}\u001b]8;;\u0007`,
    interactive,
    width,
  };
}
