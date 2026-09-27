import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { Database } from "@/types/database.types";
import type { SetupRequest } from "@/types/domain";
import { canTransition, listMySetupRequests, updateSetupRequestStatus } from "./setup-requests";
import { SETUP_REQUEST_STATUSES, type SetupRequestStatus } from "./setup-request-status";
import { isCustomerSupportError } from "./errors";

function makeRequest(overrides: Partial<SetupRequest> = {}): SetupRequest {
  return {
    id: "req-1",
    user_id: "user-1",
    business_id: null,
    automation_type: "blog-marketing",
    description: null,
    budget_range: null,
    status: "REQUESTED",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * `rows` stands in for "whatever RLS already lets this session see" — a
 * request belonging to another user simply isn't in this array, the same
 * way Postgres RLS silently filters rows this session's policy denies
 * (there's no way to unit-test RLS enforcement itself without a live
 * Postgres instance; this only proves this code reacts correctly to what
 * RLS would produce — see this ticket's report for the SQL-based
 * verification procedure that covers the rest).
 */
function createFakeSupabase(rows: SetupRequest[], options: { raceStatusAfterRead?: string } = {}) {
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
            // Simulates another request/session changing this row's status
            // the instant after this read resolves, before the caller's
            // subsequent update runs.
            if (row && options.raceStatusAfterRead) row.status = options.raceStatusAfterRead;
            return { data: result, error: null };
          }),
        })),
        order: vi.fn(() => ({
          limit: vi.fn(async () => ({ data: state, error: null })),
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

  return { client: { from } as unknown as SupabaseClient<Database>, state, updates };
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

  it.each(SETUP_REQUEST_STATUSES.flatMap((from) => SETUP_REQUEST_STATUSES.map((to) => [from, to] as const)))(
    "%s -> %s",
    (from: SetupRequestStatus, to: SetupRequestStatus) => {
      const expected = ALLOWED.has(`${from}->${to}`);
      expect(canTransition(from, to)).toBe(expected);
    },
  );

  it("never allows a self-transition", () => {
    for (const status of SETUP_REQUEST_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});

describe("listMySetupRequests", () => {
  it("returns whatever rows the (RLS-filtered) client provides, newest first per the query", async () => {
    const { client } = createFakeSupabase([makeRequest({ id: "a" }), makeRequest({ id: "b" })]);

    const result = await listMySetupRequests(client);

    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("updateSetupRequestStatus", () => {
  it("cancels a REQUESTED request", async () => {
    const { client, updates } = createFakeSupabase([makeRequest({ id: "a", status: "REQUESTED" })]);

    const updated = await updateSetupRequestStatus(client, "a", "CANCELLED");

    expect(updated.status).toBe("CANCELLED");
    expect(updates).toEqual([{ id: "a", status: "CANCELLED" }]);
  });

  it("rejects a disallowed transition before ever calling update", async () => {
    const { client, updates } = createFakeSupabase([makeRequest({ id: "a", status: "COMPLETED" })]);

    const error = await updateSetupRequestStatus(client, "a", "CANCELLED").catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(true);
    expect(error.code).toBe("INVALID_TRANSITION");
    expect(updates).toEqual([]);
  });

  it("throws NOT_FOUND for an id that doesn't exist (or isn't visible to this session via RLS)", async () => {
    const { client } = createFakeSupabase([]);

    const error = await updateSetupRequestStatus(client, "missing-id", "CANCELLED").catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(true);
    expect(error.code).toBe("NOT_FOUND");
  });

  it("detects a concurrent status change between read and write instead of overwriting it", async () => {
    const { client, updates } = createFakeSupabase([makeRequest({ id: "a", status: "REQUESTED" })], {
      raceStatusAfterRead: "COMPLETED", // someone else finished it right after we read REQUESTED
    });

    const error = await updateSetupRequestStatus(client, "a", "CANCELLED").catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(true);
    expect(error.code).toBe("INVALID_TRANSITION");
    expect(updates).toEqual([]);
  });
});
