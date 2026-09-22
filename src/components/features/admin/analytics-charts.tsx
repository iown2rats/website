import { cn } from "@/lib/cn";

/*
 * Charts for Admin → Analytics (docs/DESIGN_SYSTEM.md §42).
 *
 * Plain server-rendered HTML and one <svg>: no chart library, no client JavaScript, and therefore nothing to
 * hydrate on a screen that is read far more often than it is interacted with.
 *
 * TWO SINGLE-SERIES CHARTS, NEVER ONE WITH TWO AXES. Visitors and page views are different measures on different
 * scales; drawing them against a shared axis would make one of them a decoration, and giving them separate axes
 * in one frame is the classic way to imply a relationship the data does not contain. Two small multiples over the
 * same x-axis let them be compared honestly and need no legend at all — each title names its own series.
 *
 * Colour carries no meaning here: a single series does not need to be told apart from anything, so the bars wear
 * the brand accent and every number stays in ordinary text ink.
 */

export interface SeriesPoint {
  startsAt: string;
  value: number;
}

/**
 * A bar per time bucket, including empty ones — the gaps are part of the answer, and a chart drawn only from the
 * buckets that exist would quietly compress a quiet night out of the axis.
 */
export function TimeSeries({ title, points, formatLabel }: { title: string; points: SeriesPoint[]; formatLabel: (iso: string) => string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((sum, p) => sum + p.value, 0);

  return (
    <figure className="flex flex-col gap-2 m-0">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-label uppercase text-text-secondary">{title}</span>
        <span className="text-caption text-text-secondary tabular-nums">{total.toLocaleString()} total</span>
      </figcaption>
      {/* The bars are decorative once the table below exists, so they are hidden from assistive tech rather than
          announced as a meaningless list of numbers. */}
      <div className="flex h-28 items-end gap-[2px]" aria-hidden="true">
        {points.map((p) => {
          const height = p.value === 0 ? 0 : Math.max(3, Math.round((p.value / max) * 100));
          return (
            <div key={p.startsAt} className="group relative flex-1 min-w-[2px]" title={`${formatLabel(p.startsAt)} · ${p.value.toLocaleString()}`}>
              <div
                className={cn("w-full rounded-t-[4px] bg-primary/80 transition-[height]", p.value === 0 && "bg-border")}
                style={{ height: p.value === 0 ? "2px" : `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-micro text-text-secondary tabular-nums">
        <span>{points.length > 0 ? formatLabel(points[0]!.startsAt) : ""}</span>
        <span>{points.length > 0 ? formatLabel(points[points.length - 1]!.startsAt) : ""}</span>
      </div>
      {/* The accessible form of the same data. A chart nobody can read with a screen reader is half a chart. */}
      <details className="text-caption text-text-secondary">
        <summary className="cursor-pointer select-none py-1">View as table</summary>
        <table className="mt-1 w-full border-collapse text-caption">
          <thead>
            <tr className="text-left text-text-secondary">
              <th scope="col" className="py-1 font-medium">Time</th>
              <th scope="col" className="py-1 text-right font-medium">{title}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.startsAt} className="border-t border-border">
                <td className="py-1">{formatLabel(p.startsAt)}</td>
                <td className="py-1 text-right tabular-nums">{p.value.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/**
 * A ranked breakdown: label, proportional bar, count. A horizontal bar is the right form for comparing magnitudes
 * across named categories — the labels get room to be read, and the eye compares lengths from a shared baseline.
 */
export function BreakdownBars({ rows, empty, formatKey }: { rows: { key: string; count: number }[]; empty: string; formatKey?: (key: string) => string }) {
  if (rows.length === 0) return <p className="text-caption text-text-secondary">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const label = formatKey ? formatKey(row.key) : row.key;
        const share = total > 0 ? Math.round((row.count / total) * 100) : 0;
        return (
          <li key={row.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-body-sm text-text" title={label}>
                {label}
              </span>
              <span className="shrink-0 text-caption text-text-secondary tabular-nums">
                {row.count.toLocaleString()} · {share}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, Math.round((row.count / max) * 100))}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
