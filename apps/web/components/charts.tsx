import type { CategoryCount, DailyCount } from '@logsy/db';
import { categoryLabel } from '@logsy/core';

/**
 * One series, one ink colour, thin marks, rounded data-ends, recessive axes.
 * Values are labelled selectively (the peak only) rather than on every bar.
 */
export function FailuresPerDay({ days }: { days: DailyCount[] }) {
  const max = Math.max(1, ...days.map((day) => day.failures));
  const width = 660;
  const height = 140;
  const slot = width / Math.max(days.length, 1);
  const barWidth = Math.min(18, slot * 0.45);
  const peak = days.reduce<DailyCount | undefined>(
    (best, day) => (best === undefined || day.failures > best.failures ? day : best),
    undefined,
  );

  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height + 26)}`}
      className="block w-full"
      role="img"
      aria-label={`Failed runs per day: ${days.map((day) => `${day.day}: ${String(day.failures)}`).join(', ')}`}
    >
      <line x1="0" y1={height} x2={width} y2={height} stroke="var(--color-hairline)" />
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--color-track)" />

      {days.map((day, index) => {
        const barHeight = day.failures === 0 ? 1.5 : (day.failures / max) * (height - 18);
        const x = index * slot + (slot - barWidth) / 2;
        return (
          <rect
            key={day.day}
            x={x}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={day.failures === 0 ? 0.75 : 5}
            fill={day.failures === 0 ? 'var(--color-hairline)' : 'var(--color-mark)'}
          >
            <title>{`${day.day}: ${String(day.failures)} failed`}</title>
          </rect>
        );
      })}

      {peak && peak.failures > 0 ? (
        <text
          x={days.indexOf(peak) * slot + slot / 2}
          y={height - (peak.failures / max) * (height - 18) - 7}
          textAnchor="middle"
          fontSize="11"
          fontWeight="500"
          fill="var(--color-ink)"
        >
          {peak.failures}
        </text>
      ) : null}

      <text x="0" y={height + 18} fontSize="11" fill="var(--color-tertiary)">
        {days[0]?.day.slice(5)}
      </text>
      <text x={width} y={height + 18} textAnchor="end" fontSize="11" fill="var(--color-tertiary)">
        {days.at(-1)?.day.slice(5)}
      </text>
    </svg>
  );
}

export function CategoryBars({ categories }: { categories: CategoryCount[] }) {
  const max = Math.max(1, ...categories.map((entry) => entry.total));

  return (
    <div className="flex flex-col gap-4">
      {categories.map((entry) => (
        <div key={entry.category}>
          <div className="mb-1.5 flex justify-between text-[13px] text-ink">
            <span>{categoryLabel(entry.category)}</span>
            <span className="font-semibold">{entry.total}</span>
          </div>
          <div className="h-1.5 rounded-full bg-track">
            <div
              className="h-1.5 rounded-full bg-mark"
              style={{ width: `${String(Math.round((entry.total / max) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
