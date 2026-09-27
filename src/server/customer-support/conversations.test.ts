import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";
import type { SupportConversation } from "@/types/domain";
import {
  deleteSupportConversation,
  listConversationsForBusiness,
  logSupportConversation,
} from "./conversations";
import { isCustomerSupportError } from "./errors";

function makeRow(overrides: Partial<SupportConversation> = {}): SupportConversation {
  return {
    id: "conv-1",
    business_id: "biz-1",
    question: "영업시간이 어떻게 되나요?",
    answer: "평일 9시부터 6시까지입니다.",
    used_faq_ids: ["faq-1"],
    is_fallback: false,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createFakeSupabase(rows: SupportConversation[]) {
  const state = [...rows];
  const inserted: Record<string, unknown>[] = [];

  const from = vi.fn((table: string) => {
    if (table !== "support_conversations") throw new Error(`unexpected table: ${table}`);

    return {
      select: vi.fn(() => {
        let businessId: string | undefined;
        let onlyFallback: boolean | undefined;
        const builder = {
          eq: vi.fn((col: string, value: unknown) => {
            if (col === "business_id") businessId = value as string;
            if (col === "is_fallback") onlyFallback = value as boolean;
            return builder;
          }),
          order: vi.fn(() => builder),
          range: vi.fn(async (from: number, to: number) => {
            const matching = state.filter((r) => {
              if (businessId && r.business_id !== businessId) return false;
              if (onlyFallback !== undefined && r.is_fallback !== onlyFallback) return false;
              return true;
            });
            const sorted = [...matching].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
            return { data: sorted.slice(from, to + 1), count: matching.length, error: null };
          }),
        };
        return builder;
      }),
      insert: vi.fn(async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: null };
      }),
      delete: vi.fn(() => ({
        eq: vi.fn((_col: string, id: string) => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => {
              const index = state.findIndex((r) => r.id === id);
              if (index === -1) return { data: null, error: null };
              const [removed] = state.splice(index, 1);
              return { data: removed, error: null };
            }),
          })),
        })),
      })),
    };
  });

  return { client: { from } as unknown as SupabaseClient<Database>, inserted, state };
}

describe("logSupportConversation", () => {
  it("inserts the exchange with business_id from the caller, not any client-supplied value", async () => {
    const { client, inserted } = createFakeSupabase([]);

    await logSupportConversation(client, "biz-1", "질문", {
      answer: "답변",
      isFallback: false,
      usedFaqIds: ["faq-1"],
    });

    expect(inserted).toEqual([
      { business_id: "biz-1", question: "질문", answer: "답변", used_faq_ids: ["faq-1"], is_fallback: false },
    ]);
  });

  it("throws (doesn't swallow) on a DB failure — the caller decides whether to ignore it", async () => {
    const { client } = createFakeSupabase([]);
    client.from = vi.fn(() => ({
      insert: vi.fn(async () => ({ error: new Error("insert failed") })),
    })) as unknown as typeof client.from;

    const error = await logSupportConversation(client, "biz-1", "질문", {
      answer: "답변",
      isFallback: false,
      usedFaqIds: [],
    }).catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(true);
  });
});

describe("listConversationsForBusiness", () => {
  it("returns only the requested business's conversations, newest first", async () => {
    const { client } = createFakeSupabase([
      makeRow({ id: "a1", business_id: "biz-1", created_at: "2026-01-01T00:00:00.000Z" }),
      makeRow({ id: "a2", business_id: "biz-1", created_at: "2026-01-02T00:00:00.000Z" }),
      makeRow({ id: "b1", business_id: "biz-2" }),
    ]);

    const result = await listConversationsForBusiness(client, "biz-1");

    expect(result.conversations.map((c) => c.id)).toEqual(["a2", "a1"]);
    expect(result.total).toBe(2);
  });

  it("filters to only fallback (unanswered) conversations when asked", async () => {
    const { client } = createFakeSupabase([
      makeRow({ id: "a1", business_id: "biz-1", is_fallback: false }),
      makeRow({ id: "a2", business_id: "biz-1", is_fallback: true }),
    ]);

    const result = await listConversationsForBusiness(client, "biz-1", { onlyFallback: true });

    expect(result.conversations.map((c) => c.id)).toEqual(["a2"]);
  });

  it("still returns rows whose used_faq_ids reference a FAQ that no longer exists — no join, nothing to fail", async () => {
    const { client } = createFakeSupabase([
      makeRow({ id: "a1", business_id: "biz-1", used_faq_ids: ["deleted-faq-id"] }),
    ]);

    const result = await listConversationsForBusiness(client, "biz-1");

    expect(result.conversations[0].used_faq_ids).toEqual(["deleted-faq-id"]);
  });

  it("paginates", async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      makeRow({ id: `a${i}`, business_id: "biz-1", created_at: `2026-01-0${i + 1}T00:00:00.000Z` }),
    );
    const { client } = createFakeSupabase(rows);

    const result = await listConversationsForBusiness(client, "biz-1", { page: 2, pageSize: 1 });

    expect(result.conversations.map((c) => c.id)).toEqual(["a1"]);
    expect(result.total).toBe(3);
  });
});

describe("deleteSupportConversation", () => {
  it("removes the row on success", async () => {
    const { client, state } = createFakeSupabase([makeRow({ id: "a1" })]);

    await deleteSupportConversation(client, "a1");

    expect(state).toHaveLength(0);
  });

  it("throws NOT_FOUND for an id that doesn't exist (or isn't owned by the caller)", async () => {
    const { client } = createFakeSupabase([]);

    const error = await deleteSupportConversation(client, "missing-id").catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(true);
    expect(error.code).toBe("NOT_FOUND");
  });
});
