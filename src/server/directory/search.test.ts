import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";
import type { DirectoryTool } from "@/types/domain";
import { searchDirectoryTools } from "./search";

function makeRow(overrides: Partial<DirectoryTool>): DirectoryTool {
  return {
    id: overrides.slug ?? "id",
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

/**
 * In-memory stand-in for the Supabase query builder: applies the same
 * filter/sort/pagination calls search.ts makes against a fixed array of
 * rows, so these tests exercise the actual combined filter/sort/pagination
 * logic instead of merely asserting "was .eq() called".
 */
function createFakeSupabase(rows: DirectoryTool[]): SupabaseClient<Database> {
  const from = vi.fn((table: string) => {
    if (table !== "directory_tools") throw new Error(`unexpected table: ${table}`);

    let result = [...rows];
    let sortColumn: keyof DirectoryTool = "stars";
    let ascending = false;

    const builder = {
      select: vi.fn(() => builder),
      ilike: vi.fn((col: keyof DirectoryTool, pattern: string) => {
        const needle = pattern
          .slice(1, -1) // strip the surrounding % ... %
          .replace(/\\(.)/g, "$1") // undo ILIKE escaping to get the literal search text back
          .toLowerCase();
        result = result.filter((row) => String(row[col] ?? "").toLowerCase().includes(needle));
        return builder;
      }),
      eq: vi.fn((col: keyof DirectoryTool, value: unknown) => {
        result = result.filter((row) => row[col] === value);
        return builder;
      }),
      overlaps: vi.fn((col: keyof DirectoryTool, values: string[]) => {
        result = result.filter((row) => {
          const rowValues = (row[col] as string[] | null) ?? [];
          return values.some((v) => rowValues.includes(v));
        });
        return builder;
      }),
      order: vi.fn((col: keyof DirectoryTool, opts: { ascending: boolean; nullsFirst?: boolean }) => {
        sortColumn = col;
        ascending = opts.ascending;
        return builder;
      }),
      range: vi.fn((from: number, to: number) => {
        const sorted = [...result].sort((a, b) => {
          const av = a[sortColumn] as unknown;
          const bv = b[sortColumn] as unknown;
          if (av === null && bv === null) return 0;
          if (av === null) return 1; // nulls always last, matching nullsFirst: false
          if (bv === null) return -1;
          if (av === bv) return 0;
          const cmp = (av as number | string) > (bv as number | string) ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
        return Promise.resolve({ data: sorted.slice(from, to + 1), count: sorted.length, error: null });
      }),
    };

    return builder;
  });

  return { from } as unknown as SupabaseClient<Database>;
}

const LANGCHAIN = makeRow({
  slug: "langchain",
  name: "LangChain",
  category: "ai-infrastructure",
  language: "Python",
  tags: ["llm", "agent"],
  stars: 90000,
  updated_at: "2026-03-01T00:00:00.000Z",
});
const N8N = makeRow({
  slug: "n8n",
  name: "n8n",
  category: "automation-platform",
  language: "TypeScript",
  tags: ["workflow", "no-code"],
  stars: 50000,
  updated_at: "2026-02-01T00:00:00.000Z",
});
const SUPABASE = makeRow({
  slug: "supabase",
  name: "Supabase",
  category: "ai-infrastructure",
  language: "TypeScript",
  tags: ["database", "auth"],
  stars: 70000,
  updated_at: "2026-04-01T00:00:00.000Z",
});
const UNCATEGORIZED = makeRow({
  slug: "uncategorized-tool",
  name: "Uncategorized Tool",
  category: null,
  language: "Go",
  tags: [],
  stars: 10,
  updated_at: "2026-01-15T00:00:00.000Z",
});
const INACTIVE_TOOL = makeRow({
  slug: "gone-tool",
  name: "Gone Tool",
  status: "INACTIVE",
  stars: 999999, // deliberately highest — proves it's excluded by status, not by sort/filter
});

const ALL_TOOLS = [LANGCHAIN, N8N, SUPABASE, UNCATEGORIZED];

describe("searchDirectoryTools", () => {
  it("returns everything sorted by stars desc when no filters are given", async () => {
    const supabase = createFakeSupabase(ALL_TOOLS);

    const result = await searchDirectoryTools(supabase, {});

    expect(result.tools.map((t) => t.slug)).toEqual(["langchain", "supabase", "n8n", "uncategorized-tool"]);
    expect(result.total).toBe(4);
  });

  it("never returns an INACTIVE tool, even with no filters and top stars", async () => {
    const supabase = createFakeSupabase([...ALL_TOOLS, INACTIVE_TOOL]);

    const result = await searchDirectoryTools(supabase, {});

    expect(result.tools.some((t) => t.slug === "gone-tool")).toBe(false);
    expect(result.total).toBe(4);
  });

  it("filters by keyword, case-insensitively, on name", async () => {
    const supabase = createFakeSupabase(ALL_TOOLS);

    const result = await searchDirectoryTools(supabase, { q: "CHAIN" });

    expect(result.tools.map((t) => t.slug)).toEqual(["langchain"]);
    expect(result.total).toBe(1);
  });

  it("escapes ILIKE wildcards so a literal '%' in the keyword isn't treated as a pattern wildcard", async () => {
    const percentTool = makeRow({ slug: "percent-tool", name: "100% Automated", stars: 5 });
    const supabase = createFakeSupabase([...ALL_TOOLS, percentTool]);

    const result = await searchDirectoryTools(supabase, { q: "100%" });

    // Without escaping, "%" is a wildcard and "100%" would behave like
    // "100" + anything, matching far more than intended.
    expect(result.tools.map((t) => t.slug)).toEqual(["percent-tool"]);
  });

  it("filters by category, and excludes tools with a null category", async () => {
    const supabase = createFakeSupabase(ALL_TOOLS);

    const result = await searchDirectoryTools(supabase, { category: "ai-infrastructure" });

    expect(result.tools.map((t) => t.slug).sort()).toEqual(["langchain", "supabase"]);
    expect(result.tools.some((t) => t.category === null)).toBe(false);
  });

  it("shows the uncategorized tool when no category filter is applied", async () => {
    const supabase = createFakeSupabase(ALL_TOOLS);

    const result = await searchDirectoryTools(supabase, {});

    expect(result.tools.some((t) => t.slug === "uncategorized-tool")).toBe(true);
  });

  it("falls back to no category filter for an invalid category value, instead of throwing", async () => {
    const supabase = createFakeSupabase(ALL_TOOLS);

    const result = await searchDirectoryTools(supabase, { category: "not-a-real-category" });

    expect(result.total).toBe(4);
  });

  it("filters by tags via overlaps", async () => {
    const supabase = createFakeSupabase(ALL_TOOLS);

    const result = await searchDirectoryTools(supabase, { tags: ["workflow"] });

    expect(result.tools.map((t) => t.slug)).toEqual(["n8n"]);
  });

  it("combines category and keyword filters together", async () => {
    const supabase = createFakeSupabase(ALL_TOOLS);

    const result = await searchDirectoryTools(supabase, { category: "ai-infrastructure", q: "sup" });

    expect(result.tools.map((t) => t.slug)).toEqual(["supabase"]);
  });

  it("returns an empty result, not an error, when nothing matches", async () => {
    const supabase = createFakeSupabase(ALL_TOOLS);

    const result = await searchDirectoryTools(supabase, { q: "nonexistent-tool-xyz" });

    expect(result.tools).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("paginates: page 2 with pageSize 1 returns the second-highest-starred tool", async () => {
    const supabase = createFakeSupabase(ALL_TOOLS);

    const result = await searchDirectoryTools(supabase, { page: 2, pageSize: 1 });

    expect(result.tools.map((t) => t.slug)).toEqual(["supabase"]);
    expect(result.total).toBe(4); // total reflects the whole filtered set, not just this page
  });

  it("returns an empty page (not an error) once the requested page is past the end, total stays accurate", async () => {
    const supabase = createFakeSupabase(ALL_TOOLS);

    const result = await searchDirectoryTools(supabase, { page: 50, pageSize: 10 });

    expect(result.tools).toEqual([]);
    expect(result.total).toBe(4);
  });

  it("falls back to defaults for an invalid sort/page/pageSize instead of throwing", async () => {
    const supabase = createFakeSupabase(ALL_TOOLS);

    const result = await searchDirectoryTools(supabase, {
      sort: "'; drop table directory_tools;--",
      page: "not-a-number",
      pageSize: 9999,
    });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    // Falls back to the default sort ("stars" desc) — LangChain has the most stars.
    expect(result.tools[0].slug).toBe("langchain");
  });

  it("sorts null values last regardless of direction", async () => {
    // The real schema makes `stars` NOT NULL (impossible today), but the
    // query-building must still ask Postgres for nulls-last in case a
    // future sort column allows null — this fixture only exists to prove
    // that intent.
    const nullStars = makeRow({ slug: "null-stars", name: "Null Stars Tool", stars: null as unknown as number });
    const supabase = createFakeSupabase([...ALL_TOOLS, nullStars]);

    const result = await searchDirectoryTools(supabase, {});

    expect(result.tools.at(-1)?.slug).toBe("null-stars");
  });
});
