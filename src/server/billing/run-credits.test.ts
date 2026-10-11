import { describe, expect, it, vi } from "vitest";
import { getCreditBalances, getUsableCredits } from "./run-credits";

function client(rows: Array<{ kind: "BLOG" | "SHORTS"; remaining: number; expires_at: string }>, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gt", "order"]) builder[method] = vi.fn(() => builder);
  builder.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => resolve({ data: error ? null : rows, error });
  return { from: vi.fn(() => builder), builder };
}

describe("credit balances", () => {
  it("adds up each kind separately and reports the earliest expiry", async () => {
    const supabase = client([
      { kind: "BLOG", remaining: 2, expires_at: "2026-11-01T00:00:00Z" },
      { kind: "BLOG", remaining: 3, expires_at: "2026-12-01T00:00:00Z" },
      { kind: "SHORTS", remaining: 1, expires_at: "2026-11-15T00:00:00Z" },
    ]);

    expect(await getCreditBalances(supabase as never, "user-1")).toEqual({
      BLOG: { remaining: 5, nextExpiry: "2026-11-01T00:00:00Z" },
      SHORTS: { remaining: 1, nextExpiry: "2026-11-15T00:00:00Z" },
    });
    expect(await getUsableCredits(supabase as never, "user-1", "SHORTS")).toEqual({ remaining: 1, nextExpiry: "2026-11-15T00:00:00Z" });
  });

  it("asks only for unexpired grants that still have something left", async () => {
    const supabase = client([]);
    await getCreditBalances(supabase as never, "user-1");
    expect((supabase.builder.gt as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])).toEqual(["remaining", "expires_at"]);
  });

  it("shows nothing (not a made-up balance) when there are no grants", async () => {
    expect(await getCreditBalances(client([]) as never, "user-1")).toEqual({ BLOG: { remaining: 0, nextExpiry: null }, SHORTS: { remaining: 0, nextExpiry: null } });
  });

  it("lets a read error through instead of pretending the balance is empty", async () => {
    await expect(getCreditBalances(client([], { message: "db down" }) as never, "user-1")).rejects.toMatchObject({ message: "db down" });
  });
});
