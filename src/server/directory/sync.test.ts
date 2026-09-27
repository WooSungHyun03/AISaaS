import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";
import { DirectoryError } from "./errors";
import type { CuratedRepo } from "./curated-repos";

const { fetchRepoStatsMock, shouldStopForRateLimitMock } = vi.hoisted(() => ({
  fetchRepoStatsMock: vi.fn(),
  shouldStopForRateLimitMock: vi.fn().mockReturnValue(false),
}));

vi.mock("./github", () => ({
  fetchRepoStats: fetchRepoStatsMock,
  shouldStopForRateLimit: shouldStopForRateLimitMock,
}));

const { syncDirectoryTools } = await import("./sync");

interface FakeAdminOptions {
  /** slug -> current description. Omit a slug entirely to mean "row doesn't exist yet". */
  existingDescriptions?: Record<string, string | null>;
  failWriteFor?: Set<string>;
}

function fakeStats(overrides: Partial<{ description: string | null }> = {}) {
  return {
    stars: 10,
    forks: 2,
    language: "TypeScript",
    license: "MIT",
    description: "github description",
    ...overrides,
  };
}

function fakeRateLimit(remaining = 100) {
  return { remaining, resetAt: new Date("2026-01-01T00:00:00.000Z") };
}

function createFakeAdmin(options: FakeAdminOptions = {}) {
  const existing = options.existingDescriptions ?? {};
  const failWriteFor = options.failWriteFor ?? new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  const updates: { slug: string; row: Record<string, unknown> }[] = [];

  const from = vi.fn((table: string) => {
    if (table !== "directory_tools") throw new Error(`unexpected table: ${table}`);

    return {
      select: vi.fn(() => ({
        eq: vi.fn((_col: string, slug: string) => ({
          maybeSingle: vi.fn(async () => {
            if (!(slug in existing)) return { data: null, error: null };
            return { data: { description: existing[slug] }, error: null };
          }),
        })),
      })),
      insert: vi.fn(async (row: Record<string, unknown>) => {
        inserts.push(row);
        if (failWriteFor.has(row.slug as string)) return { error: new Error("insert failed") };
        return { error: null };
      }),
      update: vi.fn((row: Record<string, unknown>) => ({
        eq: vi.fn(async (_col: string, slug: string) => {
          updates.push({ slug, row });
          if (failWriteFor.has(slug)) return { error: new Error("update failed") };
          return { error: null };
        }),
      })),
    };
  });

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    inserts,
    updates,
  };
}

const REPO_A: CuratedRepo = { owner: "a-owner", repo: "a-repo", slug: "a", name: "A Tool" };
const REPO_B: CuratedRepo = { owner: "b-owner", repo: "b-repo", slug: "b" };
const REPO_C: CuratedRepo = { owner: "c-owner", repo: "c-repo", slug: "c" };

beforeEach(() => {
  fetchRepoStatsMock.mockReset();
  shouldStopForRateLimitMock.mockReset().mockReturnValue(false);
});

describe("syncDirectoryTools", () => {
  it("inserts a brand-new repo and updates an existing one", async () => {
    fetchRepoStatsMock
      .mockResolvedValueOnce({ stats: fakeStats(), rateLimit: fakeRateLimit() }) // A: new
      .mockResolvedValueOnce({ stats: fakeStats(), rateLimit: fakeRateLimit() }); // B: existing

    const { client, inserts, updates } = createFakeAdmin({ existingDescriptions: { b: "human-written desc" } });

    const result = await syncDirectoryTools([REPO_A, REPO_B], client);

    expect(result).toMatchObject({ processed: 2, updated: 2, failed: [], skipped: [], stoppedEarly: false });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ name: "A Tool", slug: "a", github_url: "https://github.com/a-owner/a-repo" });
    expect(updates).toHaveLength(1);
    expect(updates[0].slug).toBe("b");
  });

  it("falls back to the raw GitHub repo name when curated.name is not set", async () => {
    fetchRepoStatsMock.mockResolvedValueOnce({ stats: fakeStats(), rateLimit: fakeRateLimit() });
    const { client, inserts } = createFakeAdmin({});

    await syncDirectoryTools([REPO_B], client);

    expect(inserts[0].name).toBe("b-repo");
  });

  it("never overwrites an existing row's name/category/tags, and leaves description alone once it's set", async () => {
    fetchRepoStatsMock.mockResolvedValueOnce({
      stats: fakeStats({ description: "fresh github description" }),
      rateLimit: fakeRateLimit(),
    });
    const { client, updates } = createFakeAdmin({ existingDescriptions: { a: "human-written desc" } });

    await syncDirectoryTools([REPO_A], client);

    expect(updates).toHaveLength(1);
    const row = updates[0].row;
    expect(row).not.toHaveProperty("name");
    expect(row).not.toHaveProperty("category");
    expect(row).not.toHaveProperty("tags");
    expect(row).not.toHaveProperty("github_url");
    // description was already set — must not appear in the update payload at all.
    expect(row).not.toHaveProperty("description");
    // GitHub-sourced fields still refresh normally.
    expect(row).toMatchObject({ stars: 10, forks: 2, language: "TypeScript", license: "MIT" });
  });

  it("fills description only when the existing row's description is null", async () => {
    fetchRepoStatsMock.mockResolvedValueOnce({
      stats: fakeStats({ description: "fresh github description" }),
      rateLimit: fakeRateLimit(),
    });
    const { client, updates } = createFakeAdmin({ existingDescriptions: { a: null } });

    await syncDirectoryTools([REPO_A], client);

    expect(updates[0].row).toMatchObject({ description: "fresh github description" });
  });

  it("records a per-repo failure and keeps processing the rest", async () => {
    fetchRepoStatsMock
      .mockResolvedValueOnce({ stats: fakeStats(), rateLimit: fakeRateLimit() })
      .mockRejectedValueOnce(new DirectoryError("NOT_FOUND", "b-owner/b-repo not found"))
      .mockResolvedValueOnce({ stats: fakeStats(), rateLimit: fakeRateLimit() });
    const { client } = createFakeAdmin({});

    const result = await syncDirectoryTools([REPO_A, REPO_B, REPO_C], client);

    expect(result.processed).toBe(3);
    expect(result.updated).toBe(2);
    expect(result.failed).toEqual([{ slug: "b", code: "NOT_FOUND", message: expect.stringContaining("not found") }]);
    expect(result.skipped).toEqual([]);
    expect(result.stoppedEarly).toBe(false);
  });

  it("records a DB write failure without stopping the batch", async () => {
    fetchRepoStatsMock
      .mockResolvedValueOnce({ stats: fakeStats(), rateLimit: fakeRateLimit() })
      .mockResolvedValueOnce({ stats: fakeStats(), rateLimit: fakeRateLimit() });
    const { client } = createFakeAdmin({ failWriteFor: new Set(["a"]) });

    const result = await syncDirectoryTools([REPO_A, REPO_B], client);

    expect(result.updated).toBe(1);
    expect(result.failed).toEqual([{ slug: "a", code: "UNKNOWN", message: expect.stringContaining("insert failed") }]);
  });

  it("stops the batch on RATE_LIMITED, skips the rest, and carries retryAfter", async () => {
    const retryAfter = new Date("2026-06-01T00:00:00.000Z");
    fetchRepoStatsMock
      .mockResolvedValueOnce({ stats: fakeStats(), rateLimit: fakeRateLimit() })
      .mockRejectedValueOnce(new DirectoryError("RATE_LIMITED", "rate limited", { retryAfter }));
    const { client } = createFakeAdmin({});

    const result = await syncDirectoryTools([REPO_A, REPO_B, REPO_C], client);

    expect(result.processed).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.stoppedEarly).toBe(true);
    expect(result.retryAfter).toEqual(retryAfter);
    expect(result.skipped).toEqual(["b", "c"]);
    expect(fetchRepoStatsMock).toHaveBeenCalledTimes(2);
  });

  it("stops before the next repo once shouldStopForRateLimit says quota is low, even on success", async () => {
    const resetAt = fakeRateLimit(3).resetAt;
    fetchRepoStatsMock.mockResolvedValueOnce({ stats: fakeStats(), rateLimit: { remaining: 3, resetAt } });
    shouldStopForRateLimitMock.mockReturnValueOnce(true);
    const { client } = createFakeAdmin({});

    const result = await syncDirectoryTools([REPO_A, REPO_B], client);

    expect(result.updated).toBe(1);
    expect(result.stoppedEarly).toBe(true);
    expect(result.retryAfter).toEqual(resetAt);
    expect(result.skipped).toEqual(["b"]);
    expect(fetchRepoStatsMock).toHaveBeenCalledTimes(1);
  });

  it("marks a repo INACTIVE when fetchRepoStats fails with NOT_FOUND", async () => {
    fetchRepoStatsMock.mockRejectedValueOnce(new DirectoryError("NOT_FOUND", "a-owner/a-repo not found"));
    const { client, updates } = createFakeAdmin({});

    await syncDirectoryTools([REPO_A], client);

    expect(updates).toEqual([{ slug: "a", row: { status: "INACTIVE" } }]);
  });

  it.each(["AUTH_FAILED", "NETWORK_FAILURE", "UNKNOWN"] as const)(
    "does not touch status for a %s failure",
    async (code) => {
      fetchRepoStatsMock.mockRejectedValueOnce(new DirectoryError(code, `failed: ${code}`));
      const { client, updates } = createFakeAdmin({});

      await syncDirectoryTools([REPO_A], client);

      expect(updates).toEqual([]);
    },
  );

  it("restores status to ACTIVE when a previously-INACTIVE repo syncs successfully again", async () => {
    fetchRepoStatsMock.mockResolvedValueOnce({ stats: fakeStats(), rateLimit: fakeRateLimit() });
    const { client, updates } = createFakeAdmin({ existingDescriptions: { a: "human-written desc" } });

    await syncDirectoryTools([REPO_A], client);

    expect(updates[0].row).toMatchObject({ status: "ACTIVE" });
  });

  it("returns all-zero result for an empty curated list", async () => {
    const { client } = createFakeAdmin({});

    const result = await syncDirectoryTools([], client);

    expect(result).toMatchObject({ processed: 0, updated: 0, failed: [], skipped: [], stoppedEarly: false });
    expect(fetchRepoStatsMock).not.toHaveBeenCalled();
  });
});
