import { describe, expect, it } from "vitest";
import { COLLECTION_HOUR_KST, currentCollectionSlot, kstDateString, nextDailyCollectionAt } from "./schedule";

describe("daily collection schedule (06:00 KST)", () => {
  it("06:00 KST is 21:00 UTC of the previous day", () => {
    expect(COLLECTION_HOUR_KST).toBe(6);
    expect(nextDailyCollectionAt(new Date("2026-10-12T20:59:00Z")).toISOString()).toBe("2026-10-12T21:00:00.000Z");
  });

  it("before 06:00 KST the next slot is today's, after it tomorrow's", () => {
    // 2026-10-13 05:30 KST = 2026-10-12 20:30 UTC
    expect(nextDailyCollectionAt(new Date("2026-10-12T20:30:00Z")).toISOString()).toBe("2026-10-12T21:00:00.000Z");
    // 2026-10-13 06:05 KST
    expect(nextDailyCollectionAt(new Date("2026-10-12T21:05:00Z")).toISOString()).toBe("2026-10-13T21:00:00.000Z");
  });

  it("exactly 06:00 KST belongs to the slot that just started, so the next one is a day later", () => {
    expect(nextDailyCollectionAt(new Date("2026-10-12T21:00:00Z")).toISOString()).toBe("2026-10-13T21:00:00.000Z");
    expect(currentCollectionSlot(new Date("2026-10-12T21:00:00Z")).toISOString()).toBe("2026-10-12T21:00:00.000Z");
  });

  it("the KST date flips at 15:00 UTC, not at UTC midnight", () => {
    expect(kstDateString(new Date("2026-10-12T14:59:59Z"))).toBe("2026-10-12");
    expect(kstDateString(new Date("2026-10-12T15:00:00Z"))).toBe("2026-10-13");
  });

  it("handles month and year boundaries", () => {
    expect(nextDailyCollectionAt(new Date("2026-12-31T22:00:00Z")).toISOString()).toBe("2027-01-01T21:00:00.000Z");
    expect(kstDateString(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});
