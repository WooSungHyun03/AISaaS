import { cn } from "@/lib/utils";
import type { GrowthSeriesPoint } from "@/server/channels/growth-series";

export interface ChartPoint {
  x: number;
  y: number;
}

/**
 * Maps `points` (one per day, in order — may start with a run of nulls
 * before collection began) onto a `width` x `height` coordinate space.
 * `x` uses each point's position in the *original* array, not its
 * position among only the defined ones, so a metric that started
 * collecting partway through the period correctly starts its line
 * partway across the chart instead of being left-aligned.
 */
export function scaleGrowthPoints(points: GrowthSeriesPoint[], { width, height, paddingY = 8 }: { width: number; height: number; paddingY?: number }): ChartPoint[] {
  const defined = points.map((point, index) => ({ index, value: point.value })).filter((point): point is { index: number; value: number } => point.value !== null);
  if (defined.length === 0) return [];

  const values = defined.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const lastIndex = Math.max(points.length - 1, 1);

  return defined.map(({ index, value }) => ({
    x: (index / lastIndex) * width,
    y: range === 0 ? height / 2 : paddingY + (1 - (value - min) / range) * (height - paddingY * 2),
  }));
}

/** SVG path `d` for a polyline through `scaled` — empty string if there's nothing to draw. */
export function buildLinePath(scaled: ChartPoint[]): string {
  return scaled.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

const WIDTH = 300;
const HEIGHT = 96;

/**
 * Dependency-free, responsive (viewBox + `preserveAspectRatio="none"` lets
 * CSS stretch it, no JS measurement/ResizeObserver needed) SVG line chart
 * for one metric's growth-series points. Accessible via both an `aria-label`
 * summary on the `<svg>` itself and a redundant visually-hidden `<p>` (some
 * screen readers handle SVG labelling inconsistently — same belt-and-braces
 * pattern as the weekly bar chart on the old growth-report page).
 */
export function GrowthLineChart({ points, label, unit = "", className }: { points: GrowthSeriesPoint[]; label: string; unit?: string; className?: string }) {
  const defined = points.filter((point): point is { date: string; value: number } => point.value !== null);

  if (defined.length === 0) {
    return <p className={cn("flex h-24 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground", className)}>데이터 없음</p>;
  }

  const scaled = scaleGrowthPoints(points, { width: WIDTH, height: HEIGHT });
  const summary = `${label} 추이: ${defined.map((point) => `${point.date} ${point.value}${unit}`).join(", ")}`;
  const last = scaled[scaled.length - 1];

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label={summary}>
        {scaled.length > 1 ? <path d={buildLinePath(scaled)} fill="none" stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
        <circle cx={last.x} cy={last.y} r={3} fill="var(--primary)" />
      </svg>
      <p className="sr-only">{summary}</p>
    </div>
  );
}
