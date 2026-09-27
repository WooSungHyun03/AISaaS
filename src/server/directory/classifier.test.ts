import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}));

vi.mock("@/server/ai/generate", () => ({
  generateStructured: generateStructuredMock,
}));

const { classifyDirectoryTool, classifyUnclassifiedDirectoryTools } = await import("./classifier");

interface FakeTool {
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  category: string | null;
  classification_source: string | null;
}

function makeTool(overrides: Partial<FakeTool> = {}): FakeTool {
  return {
    slug: "some-tool",
    name: "Some Tool",
    description: "a generic tool",
    tags: [],
    category: null,
    classification_source: null,
    ...overrides,
  };
}

function createFakeAdmin(tools: FakeTool[], options: { raceSlugsToSteal?: Set<string> } = {}) {
  const state = tools.map((t) => ({ ...t }));
  const updates: { slug: string; patch: Record<string, unknown> }[] = [];

  const from = vi.fn((table: string) => {
    if (table !== "directory_tools") throw new Error(`unexpected table: ${table}`);

    return {
      select: vi.fn(() => ({
        is: vi.fn((col: string, _value: null) => {
          if (col !== "category") throw new Error(`unexpected .is() column: ${col}`);
          return {
            limit: vi.fn(async (n: number) => {
              const matching = state.filter((t) => t.category === null).slice(0, n);
              // Simulate a concurrent writer classifying some rows AFTER this
              // select snapshot was taken but BEFORE the batch's update runs.
              for (const slug of options.raceSlugsToSteal ?? []) {
                const row = state.find((t) => t.slug === slug);
                if (row) row.category = "already-set-by-someone-else";
              }
              return { data: matching.map(({ slug, name, description, tags }) => ({ slug, name, description, tags })), error: null };
            }),
          };
        }),
      })),
      update: vi.fn((patch: Record<string, unknown>) => ({
        eq: vi.fn((_col: string, slug: string) => ({
          is: vi.fn((col: string, _value: null) => {
            if (col !== "category") throw new Error(`unexpected .is() column: ${col}`);
            return {
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => {
                  const row = state.find((t) => t.slug === slug);
                  if (!row || row.category !== null) return { data: null, error: null };
                  Object.assign(row, patch);
                  updates.push({ slug, patch });
                  return { data: row, error: null };
                }),
              })),
            };
          }),
        })),
      })),
    };
  });

  return { client: { from } as unknown as SupabaseClient<Database>, state, updates };
}

beforeEach(() => {
  generateStructuredMock.mockReset();
});

describe("classifyDirectoryTool", () => {
  it("uses the AI's category when the call succeeds", async () => {
    generateStructuredMock.mockResolvedValue({ category: "automation-platform" });

    const result = await classifyDirectoryTool("n8n", "workflow automation tool", ["workflow"]);

    expect(result).toEqual({ category: "automation-platform", source: "ai" });
  });

  it("falls back to keyword matching when the AI call fails outright (network/timeout)", async () => {
    generateStructuredMock.mockRejectedValue(new Error("network failure"));

    const result = await classifyDirectoryTool("n8n", "a no-code workflow automation tool", ["workflow"]);

    expect(result).toEqual({ category: "automation-platform", source: "keyword" });
  });

  it("falls back to keyword matching when the AI's category is outside the enum (generateStructured rejects after its own retry)", async () => {
    // generateStructured's own zod validation (directoryCategorySchema) is
    // what actually enforces the enum in production — an out-of-enum value
    // never reaches this function as a return value, only as a thrown
    // failure after generateStructured's internal retry is exhausted. This
    // mock simulates exactly that end state.
    generateStructuredMock.mockRejectedValue(new Error("INVALID_STRUCTURED_RESPONSE"));

    const result = await classifyDirectoryTool("Supabase", "a Postgres-backed BaaS", ["database", "auth"]);

    expect(result).toEqual({ category: "ai-infrastructure", source: "keyword" });
  });

  it("falls back to 'other' (never throws) when neither AI nor any keyword matches", async () => {
    generateStructuredMock.mockRejectedValue(new Error("down"));

    const result = await classifyDirectoryTool("Mystery Tool", "does something unrelated", []);

    expect(result).toEqual({ category: "other", source: "keyword" });
  });
});

describe("classifyUnclassifiedDirectoryTools", () => {
  it("only classifies tools with a null category — never calls the AI for an already-classified one", async () => {
    const { client, state } = createFakeAdmin([
      makeTool({ slug: "a", category: null }),
      makeTool({ slug: "b", category: "ai-infrastructure" }),
    ]);
    generateStructuredMock.mockResolvedValue({ category: "automation-platform" });

    const result = await classifyUnclassifiedDirectoryTools(client);

    expect(result.processed).toBe(1);
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
    expect(state.find((t) => t.slug === "b")?.category).toBe("ai-infrastructure"); // untouched
    expect(state.find((t) => t.slug === "a")?.category).toBe("automation-platform");
    expect(state.find((t) => t.slug === "a")?.classification_source).toBe("ai");
  });

  it("respects maxToProcess", async () => {
    const { client } = createFakeAdmin([makeTool({ slug: "a" }), makeTool({ slug: "b" }), makeTool({ slug: "c" })]);
    generateStructuredMock.mockResolvedValue({ category: "other" });

    const result = await classifyUnclassifiedDirectoryTools(client, 2);

    expect(result.processed).toBe(2);
  });

  it("never overwrites a row that got classified by something else between the select and the update", async () => {
    const { client, state, updates } = createFakeAdmin([makeTool({ slug: "a" }), makeTool({ slug: "b" })], {
      raceSlugsToSteal: new Set(["a"]),
    });
    generateStructuredMock.mockResolvedValue({ category: "productivity" });

    const result = await classifyUnclassifiedDirectoryTools(client);

    expect(result.skippedAlreadyClassified).toBe(1);
    expect(updates.map((u) => u.slug)).toEqual(["b"]);
    expect(state.find((t) => t.slug === "a")?.category).toBe("already-set-by-someone-else");
  });

  it("returns all-zero result and calls the AI zero times when nothing is unclassified", async () => {
    const { client } = createFakeAdmin([makeTool({ slug: "a", category: "other" })]);

    const result = await classifyUnclassifiedDirectoryTools(client);

    expect(result).toMatchObject({ processed: 0, classifiedByAi: 0, classifiedByKeyword: 0, failed: [] });
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });
});
