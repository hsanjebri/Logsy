/** Small formatting helpers shared by the pages. */

export function relativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${String(days)}d ago`;
  return date.toISOString().slice(0, 10);
}

export function percent(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${String(Math.round((part / whole) * 100))}%`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function money(value: number): string {
  if (value === 0) return '$0.00';
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}
