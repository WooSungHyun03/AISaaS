import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";
import type { SetupRequestStatus } from "@/types/domain";
import { canTransition, updateSetupRequestStatus } from "./setup-request-transitions";
import { isCustomerSupportError } from "./errors";

const ALL_STATUSES: SetupRequestStatus[] = ["REQUESTED", "CONTACTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

/**
 * `rows` stands in for "whatever RLS already lets this session see" — see
 * setup-requests.test.ts's original note (same limitation: this can only
 * prove the code reacts correctly to what RLS would produce, not that RLS
 * itself enforces it; docs/dev3/SETUP_REQUESTS_OPERATIONS.md has the SQL
 * procedure for that half).
 */
function createFakeSupabase(
  rows: { id: string; status: SetupRequestStatus }[],
  options: { raceStatusAfterRead?: SetupRequestStatus } = {},
) {
  const state = rows.map((r) => ({ ...r }));
  const updates: { id: string; status: string }[] = [];

  const from = vi.fn((table: string) => {
    if (table !== "setup_requests") throw new Error(`unexpected table: ${table}`);

    return {
      select: vi.fn(() => ({
        eq: vi.fn((_col: string, id: string) => ({
          maybeSingle: vi.fn(async () => {
            const row = state.find((r) => r.id === id) ?? null;
            const result = row ? { status: row.status } : null;
            if (row && options.raceStatusAfterRead) row.status = options.raceStatusAfterRead;
            return { data: result, error: null };
          }),
        })),
      })),
      update: vi.fn((patch: Record<string, unknown>) => ({
        eq: vi.fn((_col1: string, id: string) => ({
          eq: vi.fn((_col2: string, expectedStatus: string) => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => {
                const row = state.find((r) => r.id === id);
                if (!row || row.status !== expectedStatus) return { data: null, error: null };
                Object.assign(row, patch);
                updates.push({ id, status: patch.status as string });
                return { data: row, error: null };
              }),
            })),
          })),
        })),
      })),
    };
  });

  return { client: { from } as unknown as SupabaseClient<Database>, updates };
}

describe("canTransition", () => {
  const ALLOWED = new Set([
    "REQUESTED->CONTACTED",
    "REQUESTED->CANCELLED",
    "CONTACTED->IN_PROGRESS",
    "CONTACTED->CANCELLED",
    "IN_PROGRESS->COMPLETED",
    "IN_PROGRESS->CANCELLED",
  ]);

  it.each(ALL_STATUSES.flatMap((from) => ALL_STATUSES.map((to) => [from, to] as const)))(
    "%s -> %s",
    (from, to) => {
      expect(canTransition(from, to)).toBe(ALLOWED.has(`${from}->${to}`));
    },
  );
});

describe("updateSetupRequestStatus", () => {
  it("cancels a REQUESTED request", async () => {
    const { client, updates } = createFakeSupabase([{ id: "a", status: "REQUESTED" }]);

    const updated = await updateSetupRequestStatus(client, "a", "CANCELLED");

    expect(updated.status).toBe("CANCELLED");
    expect(updates).toEqual([{ id: "a", status: "CANCELLED" }]);
  });

  it("cancels a CONTACTED request", async () => {
    const { client, updates } = createFakeSupabase([{ id: "a", status: "CONTACTED" }]);

    await updateSetupRequestStatus(client, "a", "CANCELLED");

    expect(updates).toEqual([{ id: "a", status: "CANCELLED" }]);
  });

  it("rejects a transition the state machine doesn't recognize at all, before ever calling update", async () => {
    const { client, updates } = createFakeSupabase([{ id: "a", status: "COMPLETED" }]);

    const error = await updateSetupRequestStatus(client, "a", "CANCELLED").catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(true);
    expect(error.code).toBe("INVALID_TRANSITION");
    expect(updates).toEqual([]);
  });

  it("rejects cancelling an IN_PROGRESS request with INVALID_TRANSITION, not a concurrent-change error, and never calls update", async () => {
    // canTransition("IN_PROGRESS", "CANCELLED") is true in the abstract
    // state machine — this specifically tests that the RLS-shaped
    // USER_CANCELLABLE_FROM guard still catches it before the DB call,
    // instead of reaching the update and getting back a misleading
    // "changed before this update landed" race message.
    const { client, updates } = createFakeSupabase([{ id: "a", status: "IN_PROGRESS" }]);

    const error = await updateSetupRequestStatus(client, "a", "CANCELLED").catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(true);
    expect(error.code).toBe("INVALID_TRANSITION");
    expect(error.message).not.toContain("changed status before this update landed");
    expect(error.message).toContain("already IN_PROGRESS");
    expect(updates).toEqual([]);
  });

  it("throws NOT_FOUND for an id that doesn't exist (or isn't visible to this session via RLS)", async () => {
    const { client } = createFakeSupabase([]);

    const error = await updateSetupRequestStatus(client, "missing-id", "CANCELLED").catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(true);
    expect(error.code).toBe("NOT_FOUND");
  });

  it("detects a genuine concurrent status change between read and write (distinct from the IN_PROGRESS case above)", async () => {
    const { client, updates } = createFakeSupabase([{ id: "a", status: "REQUESTED" }], {
      raceStatusAfterRead: "COMPLETED", // someone else finished it right after we read REQUESTED
    });

    const error = await updateSetupRequestStatus(client, "a", "CANCELLED").catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(true);
    expect(error.code).toBe("INVALID_TRANSITION");
    expect(error.message).toContain("changed status before this update landed");
    expect(updates).toEqual([]);
  });
});
