import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";
import type { DirectoryTool } from "@/types/domain";
import { getDirectoryToolBySlug, markDirectoryToolInactive } from "./detail";
import { isDirectoryError } from "./errors";

function makeRow(overrides: Partial<DirectoryTool>): DirectoryTool {
  return {
    id: "id",
    name: "Tool",
    slug: "tool",
    description: null,
    github_url: null,
    stars: 0,
    forks: 0,
    language: null,
    license: null,
    category: null,
    tags: [],
    status: "ACTIVE",
    classification_source: null,
    last_github_sync_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createFakeSupabase(rows: DirectoryTool[]) {
  const updates: { slug: string; row: Record<string, unknown> }[] = [];

  const from = vi.fn((table: string) => {
    if (table !== "directory_tools") throw new Error(`unexpected table: ${table}`);

    return {
      select: vi.fn(() => ({
        eq: vi.fn((_col: string, slug: string) => ({
          maybeSingle: vi.fn(async () => ({ data: rows.find((r) => r.slug === slug) ?? null, error: null })),
        })),
      })),
      update: vi.fn((row: Record<string, unknown>) => ({
        eq: vi.fn(async (_col: string, slug: string) => {
          updates.push({ slug, row });
          return { error: null };
        }),
      })),
    };
  });

  return { client: { from } as unknown as SupabaseClient<Database>, updates };
}

describe("getDirectoryToolBySlug", () => {
  it("returns the tool when the slug exists", async () => {
    const { client } = createFakeSupabase([makeRow({ slug: "langchain", name: "LangChain" })]);

    const tool = await getDirectoryToolBySlug(client, "langchain");

    expect(tool.name).toBe("LangChain");
  });

  it("throws a DirectoryError NOT_FOUND when the slug doesn't exist", async () => {
    const { client } = createFakeSupabase([]);

    const error = await getDirectoryToolBySlug(client, "nonexistent").catch((e) => e);

    expect(isDirectoryError(error)).toBe(true);
    expect(error.code).toBe("NOT_FOUND");
  });

  it("returns an INACTIVE tool instead of throwing — it's a real (if dead) answer, not a missing slug", async () => {
    const { client } = createFakeSupabase([makeRow({ slug: "gone-tool", status: "INACTIVE" })]);

    const tool = await getDirectoryToolBySlug(client, "gone-tool");

    expect(tool.status).toBe("INACTIVE");
  });
});

describe("markDirectoryToolInactive", () => {
  it("sets status to INACTIVE and touches no other field", async () => {
    const { client, updates } = createFakeSupabase([makeRow({ slug: "langchain" })]);

    await markDirectoryToolInactive(client, "langchain");

    expect(updates).toEqual([{ slug: "langchain", row: { status: "INACTIVE" } }]);
  });
});
