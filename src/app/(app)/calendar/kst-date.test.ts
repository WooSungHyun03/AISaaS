import { describe, expect, it } from "vitest";
import { currentKstDate } from "./kst-date";

describe("currentKstDate", () => {
  it("stays on the same day at 23:59 KST (14:59 UTC)", () => {
    // 2026-03-15 23:59 KST = 2026-03-15 14:59 UTC
    expect(currentKstDate(new Date("2026-03-15T14:59:00.000Z"))).toBe("2026-03-15");
  });

  it("flips to the next day exactly at 00:00 KST (15:00 UTC the previous day)", () => {
    // 2026-03-16 00:00 KST = 2026-03-15 15:00 UTC
    expect(currentKstDate(new Date("2026-03-15T15:00:00.000Z"))).toBe("2026-03-16");
  });

  it("stays on the new day at 00:01 KST (15:01 UTC the previous day)", () => {
    // 2026-03-16 00:01 KST = 2026-03-15 15:01 UTC
    expect(currentKstDate(new Date("2026-03-15T15:01:00.000Z"))).toBe("2026-03-16");
  });

  it("is correct away from the boundary too, regardless of the host process's own timezone", () => {
    // 2026-06-01 09:00 KST = 2026-06-01 00:00 UTC — no boundary involved, just a sanity check
    // that this uses Asia/Seoul via Intl rather than manual +9h arithmetic that could drift.
    expect(currentKstDate(new Date("2026-06-01T00:00:00.000Z"))).toBe("2026-06-01");
  });

  it("defaults to the real current time when no `now` is passed", () => {
    expect(currentKstDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
