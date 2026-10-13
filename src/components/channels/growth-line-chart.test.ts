import { describe, expect, it } from "vitest";
import { buildChartModel, buildLinePath, formatMetricValue, scaleGrowthPoints, shortDate } from "./growth-line-chart";

const DIMENSIONS = { width: 300, height: 96 };

describe("scaleGrowthPoints", () => {
  it("returns an empty array when every point is null (no data collected yet)", () => {
    const points = [{ date: "2026-10-01", value: null }, { date: "2026-10-02", value: null }];
    expect(scaleGrowthPoints(points, DIMENSIONS)).toEqual([]);
  });

  it("places a single defined point using its position in the original (not filtered) array", () => {
    const points = [{ date: "2026-10-01", value: null }, { date: "2026-10-02", value: null }, { date: "2026-10-03", value: 100 }];
    const scaled = scaleGrowthPoints(points, DIMENSIONS);
    expect(scaled).toHaveLength(1);
    // index 2 of 3 (lastIndex=2) -> x = (2/2)*300 = 300 (right edge, matching "most recent day").
    expect(scaled[0].x).toBeCloseTo(300);
  });

  it("maps the minimum value to the bottom and the maximum to the top, within the y padding", () => {
    const points = [{ date: "d1", value: 0 }, { date: "d2", value: 50 }, { date: "d3", value: 100 }];
    const scaled = scaleGrowthPoints(points, { width: 300, height: 96, paddingY: 8 });
    const [minPoint, , maxPoint] = scaled;
    expect(minPoint.y).toBeCloseTo(96 - 8); // min value -> bottom
    expect(maxPoint.y).toBeCloseTo(8); // max value -> top
  });

  it("centers a flat line (all equal values) vertically instead of dividing by zero", () => {
    const points = [{ date: "d1", value: 42 }, { date: "d2", value: 42 }, { date: "d3", value: 42 }];
    const scaled = scaleGrowthPoints(points, { width: 300, height: 96 });
    expect(scaled.every((point) => point.y === 48)).toBe(true);
  });

  it("keeps x positions proportional to each point's original index, leaving a gap for a leading null run", () => {
    const points = [
      { date: "d1", value: null },
      { date: "d2", value: null },
      { date: "d3", value: 10 },
      { date: "d4", value: 20 },
    ];
    const scaled = scaleGrowthPoints(points, { width: 300, height: 96 });
    // lastIndex = 3; defined indices are 2 and 3 -> x = 200 and x = 300.
    expect(scaled[0].x).toBeCloseTo(200);
    expect(scaled[1].x).toBeCloseTo(300);
  });

  it("does not divide by zero when there is only a single point total", () => {
    const points = [{ date: "d1", value: 5 }];
    expect(() => scaleGrowthPoints(points, DIMENSIONS)).not.toThrow();
    expect(scaleGrowthPoints(points, DIMENSIONS)).toEqual([{ x: 0, y: 48 }]);
  });
});

describe("buildLinePath", () => {
  it("returns an empty string for no points", () => {
    expect(buildLinePath([])).toBe("");
  });

  it("starts with M for the first point and uses L for the rest", () => {
    const path = buildLinePath([{ x: 0, y: 10 }, { x: 50, y: 20 }, { x: 100, y: 5 }]);
    expect(path).toBe("M 0.00 10.00 L 50.00 20.00 L 100.00 5.00");
  });

  it("produces just a single M (no line segment) for one point", () => {
    expect(buildLinePath([{ x: 10, y: 20 }])).toBe("M 10.00 20.00");
  });
});

describe("chart model and labels", () => {
  const day = (date: string, value: number | null, measured = true) => ({ date, value, measured });

  it("has no model when nothing was ever collected (the card shows its empty state instead of an empty frame)", () => {
    expect(buildChartModel([day("2026-10-08", null), day("2026-10-09", null)])).toBeNull();
  });

  it("keeps every point inside the plot area, lowest value at the bottom and highest at the top", () => {
    const model = buildChartModel([day("2026-10-08", 100), day("2026-10-09", 150), day("2026-10-10", 200)])!;
    expect(model.min).toBe(100);
    expect(model.max).toBe(200);
    const ys = model.scaled.map((point) => point.y);
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBeGreaterThan(ys[2]);
    for (const point of model.scaled) {
      expect(point.x).toBeGreaterThanOrEqual(44);
      expect(point.x).toBeLessThanOrEqual(310);
      expect(point.y).toBeGreaterThanOrEqual(12);
      expect(point.y).toBeLessThanOrEqual(126);
    }
  });

  it("starts a late-collected metric partway across the chart and treats an unchanged value as a flat line", () => {
    const model = buildChartModel([day("2026-10-07", null), day("2026-10-08", null), day("2026-10-09", 40), day("2026-10-10", 40)])!;
    expect(model.flat).toBe(true);
    expect(model.indexes).toEqual([2, 3]);
    expect(model.scaled[0].x).toBeGreaterThan(44 + 100);
    expect(model.scaled[0].y).toBe(model.scaled[1].y);
  });

  it("formats dates and numbers the way an owner reads them", () => {
    expect(shortDate("2026-10-09")).toBe("10/9");
    expect(formatMetricValue(1234)).toBe("1,234");
    expect(formatMetricValue(12.34)).toBe("12.3");
    expect(formatMetricValue(250_000)).toBe("25만");
    expect(formatMetricValue(-5)).toBe("-5");
  });
});
