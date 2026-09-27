import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";
import type { BusinessFaq } from "@/types/domain";
import {
  createBusinessFaq,
  deleteBusinessFaq,
  listFaqsForBusiness,
  updateBusinessFaq,
} from "./faq";
import { isCustomerSupportError } from "./errors";

function makeFaq(overrides: Partial<BusinessFaq>): BusinessFaq {
  return {
    id: "faq-id",
    business_id: "11111111-1111-1111-1111-111111111111",
    question: "영업시간이 어떻게 되나요?",
    answer: "평일 오전 9시부터 오후 6시까지입니다.",
    is_enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Fake RLS-scoped client for business_faqs. This can only ever prove that
 * *this code* reacts correctly to "0 rows returned" (NOT_FOUND) or a
 * populated insert/select — it cannot prove RLS itself actually blocks a
 * cross-business request, since that enforcement only exists inside a real
 * Postgres instance. See the SQL verification steps in the ticket report
 * for that half of the check.
 */
function createFakeSupabase(initialRows: BusinessFaq[]) {
  const rows = [...initialRows];
  const insertedPayloads: Record<string, unknown>[] = [];

  const from = vi.fn((table: string) => {
    if (table !== "business_faqs") throw new Error(`unexpected table: ${table}`);

    return {
      select: vi.fn(() => ({
        eq: vi.fn((_col: string, businessId: string) => ({
          order: vi.fn(async () => ({
            data: rows.filter((r) => r.business_id === businessId),
            error: null,
          })),
        })),
      })),
      insert: vi.fn((payload: Record<string, unknown>) => {
        insertedPayloads.push(payload);
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => {
              const row = makeFaq({
                id: `new-${rows.length}`,
                business_id: payload.business_id as string,
                question: payload.question as string,
                answer: payload.answer as string,
              });
              rows.push(row);
              return { data: row, error: null };
            }),
          })),
        };
      }),
      update: vi.fn((patch: Record<string, unknown>) => ({
        eq: vi.fn((_col: string, id: string) => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => {
              const row = rows.find((r) => r.id === id);
              if (!row) return { data: null, error: null };
              Object.assign(row, patch);
              return { data: row, error: null };
            }),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn((_col: string, id: string) => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => {
              const index = rows.findIndex((r) => r.id === id);
              if (index === -1) return { data: null, error: null };
              const [removed] = rows.splice(index, 1);
              return { data: removed, error: null };
            }),
          })),
        })),
      })),
    };
  });

  return { client: { from } as unknown as SupabaseClient<Database>, insertedPayloads, rows };
}

const BUSINESS_A = "11111111-1111-4111-8111-111111111111";
const BUSINESS_B = "22222222-2222-4222-8222-222222222222";

describe("listFaqsForBusiness", () => {
  it("returns only the requested business's FAQs, enabled or not", async () => {
    const { client } = createFakeSupabase([
      makeFaq({ id: "a1", business_id: BUSINESS_A, is_enabled: true }),
      makeFaq({ id: "a2", business_id: BUSINESS_A, is_enabled: false }),
      makeFaq({ id: "b1", business_id: BUSINESS_B }),
    ]);

    const result = await listFaqsForBusiness(client, BUSINESS_A);

    expect(result.map((f) => f.id).sort()).toEqual(["a1", "a2"]);
  });
});

describe("createBusinessFaq", () => {
  it("creates a FAQ under the given businessId", async () => {
    const { client, insertedPayloads } = createFakeSupabase([]);

    const created = await createBusinessFaq(client, {
      businessId: BUSINESS_A,
      question: "주차 가능한가요?",
      answer: "2시간 무료 주차 가능합니다.",
    });

    expect(created.question).toBe("주차 가능한가요?");
    expect(insertedPayloads).toEqual([
      { business_id: BUSINESS_A, question: "주차 가능한가요?", answer: "2시간 무료 주차 가능합니다." },
    ]);
  });

  it("rejects a question/answer over the length limit before ever calling Supabase", async () => {
    const { client } = createFakeSupabase([]);
    const tooLong = "a".repeat(3000);

    const error = await createBusinessFaq(client, { businessId: BUSINESS_A, question: tooLong, answer: "ok" }).catch(
      (e) => e,
    );

    // A ZodError (input validation), not our domain CustomerSupportError.
    expect(isCustomerSupportError(error)).toBe(false);
    expect(error.name).toBe("ZodError");
  });

  it("rejects a non-uuid businessId", async () => {
    const { client } = createFakeSupabase([]);

    const error = await createBusinessFaq(client, {
      businessId: "not-a-uuid",
      question: "q",
      answer: "a",
    }).catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(false); // zod validation error, not our AppError
  });
});

describe("updateBusinessFaq", () => {
  it("updates only the provided fields", async () => {
    const { client } = createFakeSupabase([makeFaq({ id: "a1" })]);

    const updated = await updateBusinessFaq(client, "a1", { isEnabled: false });

    expect(updated.is_enabled).toBe(false);
    expect(updated.question).toBe("영업시간이 어떻게 되나요?"); // untouched
  });

  it("never lets business_id through, even if a caller sneaks it into the input", async () => {
    const { client } = createFakeSupabase([makeFaq({ id: "a1", business_id: BUSINESS_A })]);

    const updated = await updateBusinessFaq(client, "a1", { question: "새 질문", businessId: BUSINESS_B } as never);

    // If business_id had leaked through the schema, this would now be BUSINESS_B.
    expect(updated.business_id).toBe(BUSINESS_A);
  });

  it("throws NOT_FOUND for an id that doesn't exist (or isn't owned by the caller)", async () => {
    const { client } = createFakeSupabase([]);

    const error = await updateBusinessFaq(client, "missing-id", { isEnabled: false }).catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(true);
    expect(error.code).toBe("NOT_FOUND");
  });
});

describe("deleteBusinessFaq", () => {
  it("removes the row on success", async () => {
    const { client, rows } = createFakeSupabase([makeFaq({ id: "a1" })]);

    await deleteBusinessFaq(client, "a1");

    expect(rows).toHaveLength(0);
  });

  it("throws NOT_FOUND for an id that doesn't exist (or isn't owned by the caller)", async () => {
    const { client } = createFakeSupabase([]);

    const error = await deleteBusinessFaq(client, "missing-id").catch((e) => e);

    expect(isCustomerSupportError(error)).toBe(true);
    expect(error.code).toBe("NOT_FOUND");
  });
});
