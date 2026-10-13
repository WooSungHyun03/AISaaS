"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
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

/** "2026-10-09" -> "10/9": what fits under a small chart. */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

export type ChartGranularity = "day" | "week" | "month";

/** What a point's date means on the axis and in the tooltip: a day, the week starting that Monday, or a month. */
export function pointDateLabel(date: string, granularity: ChartGranularity = "day"): string {
  if (granularity === "month") {
    const [year, month] = date.split("-");
    return month ? `${year}.${Number(month)}월` : date;
  }
  return granularity === "week" ? `${shortDate(date)} 주` : shortDate(date);
}

/** Numbers as a Korean owner reads them: 1,234 / 1.2만, never an unlabelled raw float. */
export function formatMetricValue(value: number): string {
  if (Math.abs(value) >= 100_000) return `${(Math.round(value / 1_000) / 10).toLocaleString("ko-KR")}만`;
  return (Math.round(value * 10) / 10).toLocaleString("ko-KR");
}

const WIDTH = 320;
const HEIGHT = 150;
const PLOT = { left: 44, right: 10, top: 12, bottom: 24 };

/** Chart geometry for one metric: the plot box, the scaled points and where the value labels go. Pure, so it is tested without a browser. */
export function buildChartModel(points: GrowthSeriesPoint[]) {
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const defined = points.filter((point): point is GrowthSeriesPoint & { value: number } => point.value !== null);
  if (defined.length === 0) return null;
  const values = defined.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const scaled = scaleGrowthPoints(points, { width: plotWidth, height: plotHeight, paddingY: 6 }).map((point) => ({ x: point.x + PLOT.left, y: point.y + PLOT.top }));
  const indexes = points.map((point, index) => (point.value === null ? -1 : index)).filter((index) => index >= 0);
  const byIndex = new Map(indexes.map((index, position) => [index, scaled[position]]));
  return { plotWidth, plotHeight, min, max, flat: min === max, scaled, byIndex, indexes };
}

/**
 * A dependency-free SVG line chart for one metric of a channel: a labelled value axis (low / middle / high), dates
 * under the first, middle and last day, dots on the days a snapshot was really taken, and a tooltip that follows the
 * pointer or the arrow keys. The drawing keeps its aspect ratio (no stretched dots) and scales with its container,
 * so it is the same chart on a phone and on a desktop.
 */
export function GrowthLineChart({ points, label, unit = "", granularity = "day", className }: { points: GrowthSeriesPoint[]; label: string; unit?: string; granularity?: ChartGranularity; className?: string }) {
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);
  const model = buildChartModel(points);

  if (!model) {
    return <p className={cn("flex h-28 items-center justify-center rounded-lg bg-muted px-3 text-center text-sm text-muted-foreground", className)}>아직 그래프로 보여드릴 데이터가 없어요</p>;
  }

  const { scaled, byIndex, indexes, min, max, flat } = model;
  const defined = points.filter((point) => point.value !== null);
  const summary = `${label} 추이: ${defined.map((point) => `${pointDateLabel(point.date, granularity)} ${formatMetricValue(point.value!)}${unit}`).join(", ")}`;
  const last = scaled[scaled.length - 1];
  const middleValue = (min + max) / 2;
  const yFor = (value: number) => (flat ? PLOT.top + model.plotHeight / 2 : PLOT.top + 6 + (1 - (value - min) / (max - min)) * (model.plotHeight - 12));
  const activePoint = active !== null ? points[active] : null;
  const activeXY = active !== null ? byIndex.get(active) : undefined;

  const nearestIndex = (clientX: number, rect: DOMRect): number => {
    const x = ((clientX - rect.left) / rect.width) * WIDTH;
    let best = indexes[0];
    let bestDistance = Infinity;
    for (const index of indexes) {
      const point = byIndex.get(index)!;
      const distance = Math.abs(point.x - x);
      if (distance < bestDistance) { best = index; bestDistance = distance; }
    }
    return best;
  };
  const onPointer = (event: PointerEvent<SVGSVGElement>) => setActive(nearestIndex(event.clientX, event.currentTarget.getBoundingClientRect()));
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "Escape") return setActive(null);
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const position = active === null ? indexes.length - 1 : indexes.indexOf(active);
    const next = event.key === "Home" ? 0 : event.key === "End" ? indexes.length - 1 : Math.min(indexes.length - 1, Math.max(0, position + (event.key === "ArrowRight" ? 1 : -1)));
    setActive(indexes[next]);
  };

  const midIndex = Math.floor((points.length - 1) / 2);
  const xLabels = [{ index: 0, anchor: "start" as const }, { index: midIndex, anchor: "middle" as const }, { index: points.length - 1, anchor: "end" as const }];
  const xFor = (index: number) => PLOT.left + (index / Math.max(points.length - 1, 1)) * model.plotWidth;
  const ticks = flat ? [{ value: min, y: yFor(min) }] : [{ value: max, y: yFor(max) }, { value: middleValue, y: yFor(middleValue) }, { value: min, y: yFor(min) }];

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-pan-y select-none"
        role="img"
        aria-labelledby={titleId}
        tabIndex={0}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onFocus={() => setActive((current) => current ?? indexes[indexes.length - 1])}
        onBlur={() => setActive(null)}
      >
        <title id={titleId}>{summary}</title>
        {ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={PLOT.left} x2={WIDTH - PLOT.right} y1={tick.y} y2={tick.y} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3" />
            <text x={PLOT.left - 6} y={tick.y + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{formatMetricValue(tick.value)}</text>
          </g>
        ))}
        {xLabels.map(({ index, anchor }) => (
          <text key={index} x={xFor(index)} y={HEIGHT - 6} textAnchor={anchor} fontSize={10} fill="var(--muted-foreground)">{pointDateLabel(points[index].date, granularity)}</text>
        ))}
        {scaled.length > 1 ? <path d={buildLinePath(scaled)} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {indexes.map((index) => {
          const point = byIndex.get(index)!;
          return points[index].measured === false ? null : <circle key={index} cx={point.x} cy={point.y} r={indexes.length > 40 ? 1.6 : 2.6} fill="var(--primary)" />;
        })}
        <circle cx={last.x} cy={last.y} r={4} fill="var(--primary)" stroke="var(--card)" strokeWidth={1.5} />
        {activeXY ? (
          <g pointerEvents="none">
            <line x1={activeXY.x} x2={activeXY.x} y1={PLOT.top} y2={HEIGHT - PLOT.bottom} stroke="var(--primary)" strokeWidth={1} opacity={0.4} />
            <circle cx={activeXY.x} cy={activeXY.y} r={5} fill="var(--card)" stroke="var(--primary)" strokeWidth={2} />
          </g>
        ) : null}
      </svg>
      {activePoint && activeXY ? (
        <div
          role="status"
          className="pointer-events-none absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${Math.min(Math.max((activeXY.x / WIDTH) * 100, 14), 86)}%`, transform: "translate(-50%, -100%)" }}
        >
          <p className="font-semibold">{pointDateLabel(activePoint.date, granularity)}</p>
          <p className="tabular">{label} {formatMetricValue(activePoint.value!)}{unit}</p>
          {activePoint.measured === false ? <p className="text-muted-foreground">이날은 측정이 없어 이전 값이에요</p> : null}
        </div>
      ) : null}
      <p className="sr-only">{summary}</p>
    </div>
  );
}
