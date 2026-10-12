import { describe, expect, it } from "vitest";
import type { ScoreItem } from "@/server/marketing/scoring";
import { summarizeGroups } from "./website-diagnosis-card";

const item = (key: string, group: ScoreItem["group"], points: number, max: number): ScoreItem => ({ key, group, label: key, points, max, detail: "" });

describe("summarizeGroups", () => {
  it("adds points per group in rubric order and skips empty groups", () => {
    const rows = summarizeGroups([item("a", "content", 3, 5), item("b", "website", 4, 4), item("c", "content", 2, 5)]);
    expect(rows.map((row) => [row.group, row.points, row.max])).toEqual([["website", 4, 4], ["content", 5, 10]]);
  });

  it("returns nothing when no breakdown was stored", () => {
    expect(summarizeGroups([])).toEqual([]);
  });
});
