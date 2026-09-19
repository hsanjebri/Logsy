/** Fitting log text into a character budget without losing the interesting parts. */

export interface TrimOptions {
  /** Share of the budget kept from the start. The rest is kept from the end. */
  headRatio?: number;
}

export function omissionMarker(lineCount: number): string {
  return `... [${lineCount} ${lineCount === 1 ? 'line' : 'lines'} omitted] ...`;
}

/**
 * Keeps the head and the tail of `text`, dropping the middle and marking the cut.
 * Whole lines are kept, so nothing is chopped mid-line.
 */
export function trimToBudget(text: string, maxChars: number, options: TrimOptions = {}): string {
  if (text.length <= maxChars) return text;

  const headRatio = options.headRatio ?? 0.4;
  const lines = text.split('\n');
  // The marker itself has to fit inside the budget.
  const reserved = omissionMarker(lines.length).length + 1;
  if (maxChars <= reserved) return '';
  const usable = maxChars - reserved;
  const headBudget = Math.floor(usable * headRatio);
  const tailBudget = usable - headBudget;

  const head: string[] = [];
  let headChars = 0;
  for (const line of lines) {
    if (headChars + line.length + 1 > headBudget) break;
    head.push(line);
    headChars += line.length + 1;
  }

  const tail: string[] = [];
  let tailChars = 0;
  for (let index = lines.length - 1; index >= head.length; index -= 1) {
    const line = lines[index] ?? '';
    if (tailChars + line.length + 1 > tailBudget) break;
    tail.unshift(line);
    tailChars += line.length + 1;
  }

  const omitted = lines.length - head.length - tail.length;
  if (omitted <= 0) return [...head, ...tail].join('\n');

  let result = [...head, omissionMarker(omitted), ...tail].join('\n');
  // Dropping a line changes the marker's own length, so shrink until it fits.
  while (result.length > maxChars && (head.length > 0 || tail.length > 1)) {
    if (head.length > 0) head.pop();
    else tail.shift();
    result = [...head, omissionMarker(lines.length - head.length - tail.length), ...tail].join(
      '\n',
    );
  }
  return result;
}

export interface Section {
  lines: readonly string[];
  /** Sections with a higher weight keep more of the budget. */
  weight: number;
}

/**
 * Joins sections into one excerpt within `maxChars`, trimming each section in
 * proportion to its weight and marking every cut.
 */
export function joinWithinBudget(sections: readonly Section[], maxChars: number): string {
  const present = sections.filter((section) => section.lines.length > 0);
  if (present.length === 0) return '';

  const totalWeight = present.reduce((sum, section) => sum + section.weight, 0);
  const parts = present.map((section) => {
    const budget = Math.floor((maxChars * section.weight) / totalWeight);
    return trimToBudget(section.lines.join('\n'), budget);
  });

  return trimToBudget(parts.join('\n'), maxChars);
}
