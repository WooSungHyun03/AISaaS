import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.types";
import type { Business, BusinessFaq } from "@/types/domain";

const { answerSupportQuestionMock, logSupportConversationMock } = vi.hoisted(() => ({
  answerSupportQuestionMock: vi.fn(),
  logSupportConversationMock: vi.fn(),
}));

vi.mock("./answer", async () => {
  const actual = await vi.importActual<typeof import("./answer")>("./answer");
  return { ...actual, answerSupportQuestion: answerSupportQuestionMock };
});

// Mocked so the "ok"-path tests don't need createFakeAdmin to also
// understand a support_conversations table — logging is tested on its own
// in conversations.test.ts; here we only care whether its failure leaks
// into the chat response.
vi.mock("./conversations", () => ({
  logSupportConversation: logSupportConversationMock,
}));

const { describeWidgetChatError, handleWidgetChatRequest, getWidgetDisplayInfo, buildWidgetEmbedUrl, buildWidgetEmbedSnippet } =
  await import("./widget");

const REAL_WIDGET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET_BUSINESS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET_FAQ_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: SECRET_BUSINESS_ID,
    owner_id: "owner-1",
    name: "테스트 카페",
    industry: "카페",
    description: null,
    location: null,
    target_customer: null,
    brand_tone: null,
    keywords: [],
    website: null,
    public_widget_id: REAL_WIDGET_ID,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeFaq(overrides: Partial<BusinessFaq> = {}): BusinessFaq {
  return {
    id: SECRET_FAQ_ID,
    business_id: SECRET_BUSINESS_ID,
    question: "영업시간이 어떻게 되나요?",
    answer: "평일 9시부터 6시까지입니다.",
    is_enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

interface ExistingRequest {
  business_id: string;
  requester_hash: string | null;
  requested_at: string;
}

function createFakeAdmin(options: {
  business: Business | null;
  existingRequests?: ExistingRequest[];
  faqs?: BusinessFaq[];
}) {
  const requests = [...(options.existingRequests ?? [])];
  const inserted: Record<string, unknown>[] = [];
  const faqs = options.faqs ?? [];

  const from = vi.fn((table: string) => {
    if (table === "businesses") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_col: string, value: string) => ({
            maybeSingle: vi.fn(async () => ({
              data: options.business && options.business.public_widget_id === value ? options.business : null,
              error: null,
            })),
          })),
        })),
      };
    }

    if (table === "support_widget_requests") {
      return {
        select: vi.fn(() => {
          let businessId: string | undefined;
          let requesterHash: string | undefined;
          let since: string | undefined;
          const builder = {
            eq: vi.fn((col: string, value: string) => {
              if (col === "business_id") businessId = value;
              if (col === "requester_hash") requesterHash = value;
              return builder;
            }),
            gte: vi.fn((_col: string, value: string) => {
              since = value;
              return builder;
            }),
            then: (resolve: (v: { count: number; error: null }) => void) => {
              const matching = requests.filter((r) => {
                if (businessId && r.business_id !== businessId) return false;
                if (requesterHash && r.requester_hash !== requesterHash) return false;
                if (since && r.requested_at < since) return false;
                return true;
              });
              resolve({ count: matching.length, error: null });
            },
          };
          return builder;
        }),
        insert: vi.fn(async (row: Record<string, unknown>) => {
          inserted.push(row);
          requests.push({
            business_id: row.business_id as string,
            requester_hash: (row.requester_hash as string | null) ?? null,
            requested_at: new Date().toISOString(),
          });
          return { error: null };
        }),
        delete: vi.fn(() => ({
          lt: vi.fn(async () => ({ error: null })),
        })),
      };
    }

    if (table === "business_faqs") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({ data: faqs, error: null })),
            })),
          })),
        })),
      };
    }

    throw new Error(`unexpected table: ${table}`);
  });

  return { client: { from } as unknown as SupabaseClient<Database>, inserted, from };
}

beforeEach(() => {
  answerSupportQuestionMock.mockReset();
  logSupportConversationMock.mockReset();
});

describe("handleWidgetChatRequest", () => {
  it("returns a grounded answer for a valid widget + valid question", async () => {
    const { client } = createFakeAdmin({ business: makeBusiness(), faqs: [makeFaq()] });
    answerSupportQuestionMock.mockResolvedValue({
      answer: "평일 9시부터 6시까지 영업합니다.",
      isFallback: false,
      usedFaqIds: [SECRET_FAQ_ID],
    });

    const outcome = await handleWidgetChatRequest(client, REAL_WIDGET_ID, { question: "몇 시에 여나요?" }, "1.2.3.4");

    expect(outcome).toEqual({ status: "ok", answer: "평일 9시부터 6시까지 영업합니다.", isFallback: false });
  });

  it("still returns the answer even when logging the conversation fails", async () => {
    const { client } = createFakeAdmin({ business: makeBusiness(), faqs: [makeFaq()] });
    answerSupportQuestionMock.mockResolvedValue({ answer: "답변", isFallback: false, usedFaqIds: [SECRET_FAQ_ID] });
    logSupportConversationMock.mockRejectedValue(new Error("log db down"));

    const outcome = await handleWidgetChatRequest(client, REAL_WIDGET_ID, { question: "질문" }, null);

    expect(outcome).toEqual({ status: "ok", answer: "답변", isFallback: false });
  });

  it("never leaks businesses.id or a FAQ id into the outcome", async () => {
    const { client } = createFakeAdmin({ business: makeBusiness(), faqs: [makeFaq()] });
    answerSupportQuestionMock.mockResolvedValue({
      answer: "답변",
      isFallback: false,
      usedFaqIds: [SECRET_FAQ_ID],
    });

    const outcome = await handleWidgetChatRequest(client, REAL_WIDGET_ID, { question: "질문" }, null);

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(SECRET_BUSINESS_ID);
    expect(serialized).not.toContain(SECRET_FAQ_ID);
  });

  it("returns widget_not_found for an unknown widget id, without calling the AI or recording a rate-limit row", async () => {
    const { client, inserted } = createFakeAdmin({ business: null });

    const outcome = await handleWidgetChatRequest(client, REAL_WIDGET_ID, { question: "질문" }, null);

    expect(outcome).toEqual({ status: "widget_not_found" });
    expect(answerSupportQuestionMock).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("returns invalid_input for an empty question without ever querying the database", async () => {
    const { client, from } = createFakeAdmin({ business: makeBusiness() });

    const outcome = await handleWidgetChatRequest(client, REAL_WIDGET_ID, { question: "" }, null);

    expect(outcome).toEqual({ status: "invalid_input" });
    expect(from).not.toHaveBeenCalled();
    expect(answerSupportQuestionMock).not.toHaveBeenCalled();
  });

  it("returns invalid_input for a question over the length limit", async () => {
    const { client } = createFakeAdmin({ business: makeBusiness() });

    const outcome = await handleWidgetChatRequest(client, REAL_WIDGET_ID, { question: "a".repeat(1000) }, null);

    expect(outcome).toEqual({ status: "invalid_input" });
  });

  it("returns rate_limited and never calls the AI once the widget-level limit is hit", async () => {
    const now = new Date().toISOString();
    const existingRequests: ExistingRequest[] = Array.from({ length: 60 }, () => ({
      business_id: SECRET_BUSINESS_ID,
      requester_hash: null,
      requested_at: now,
    }));
    const { client, inserted } = createFakeAdmin({ business: makeBusiness(), existingRequests });

    const outcome = await handleWidgetChatRequest(client, REAL_WIDGET_ID, { question: "질문" }, null);

    expect(outcome).toEqual({ status: "rate_limited" });
    expect(answerSupportQuestionMock).not.toHaveBeenCalled();
    // A rejected request must not itself consume another slot.
    expect(inserted).toHaveLength(0);
  });

  it("returns ai_unavailable (not the raw error) when answerSupportQuestion throws", async () => {
    const { client } = createFakeAdmin({ business: makeBusiness(), faqs: [makeFaq()] });
    answerSupportQuestionMock.mockRejectedValue(new Error("provider rate limited: sk-secret-key-12345"));

    const outcome = await handleWidgetChatRequest(client, REAL_WIDGET_ID, { question: "질문" }, null);

    expect(outcome).toEqual({ status: "ai_unavailable" });
    expect(JSON.stringify(outcome)).not.toContain("sk-secret-key-12345");
  });

  it("returns internal_error (not a thrown exception) on an unexpected DB failure", async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error("connection refused");
      }),
    } as unknown as SupabaseClient<Database>;

    const outcome = await handleWidgetChatRequest(client, REAL_WIDGET_ID, { question: "질문" }, null);

    expect(outcome).toEqual({ status: "internal_error" });
  });
});

describe("describeWidgetChatError", () => {
  it("maps every non-ok status to a safe message and the right HTTP status", () => {
    expect(describeWidgetChatError("invalid_input").httpStatus).toBe(400);
    expect(describeWidgetChatError("widget_not_found").httpStatus).toBe(404);
    expect(describeWidgetChatError("rate_limited").httpStatus).toBe(429);
    expect(describeWidgetChatError("ai_unavailable").httpStatus).toBe(503);
    expect(describeWidgetChatError("internal_error").httpStatus).toBe(500);
  });
});

describe("getWidgetDisplayInfo", () => {
  it("returns only the business name for a known widget", async () => {
    const { client } = createFakeAdmin({ business: makeBusiness({ name: "테스트 카페" }) });

    const info = await getWidgetDisplayInfo(client, REAL_WIDGET_ID);

    expect(info).toEqual({ businessName: "테스트 카페" });
  });

  it("never leaks businesses.id even indirectly", async () => {
    const { client } = createFakeAdmin({ business: makeBusiness() });

    const info = await getWidgetDisplayInfo(client, REAL_WIDGET_ID);

    expect(JSON.stringify(info)).not.toContain(SECRET_BUSINESS_ID);
  });

  it("returns null for an unknown widget", async () => {
    const { client } = createFakeAdmin({ business: null });

    const info = await getWidgetDisplayInfo(client, REAL_WIDGET_ID);

    expect(info).toBeNull();
  });
});

describe("buildWidgetEmbedUrl", () => {
  it("joins the site URL and widget id under /widget/", () => {
    expect(buildWidgetEmbedUrl("https://autobiz.app", REAL_WIDGET_ID)).toBe(
      `https://autobiz.app/widget/${REAL_WIDGET_ID}`,
    );
  });
});

describe("buildWidgetEmbedSnippet", () => {
  it("includes title, default width/height, and loading=lazy", () => {
    const snippet = buildWidgetEmbedSnippet("https://autobiz.app", REAL_WIDGET_ID, "테스트 카페");

    expect(snippet).toContain(`src="https://autobiz.app/widget/${REAL_WIDGET_ID}"`);
    expect(snippet).toContain('title="테스트 카페 고객 지원 챗봇"');
    expect(snippet).toContain('width="380"');
    expect(snippet).toContain('height="600"');
    expect(snippet).toContain('loading="lazy"');
  });

  it("HTML-escapes a business name containing quotes and angle brackets", () => {
    const snippet = buildWidgetEmbedSnippet("https://autobiz.app", REAL_WIDGET_ID, `<script>"alert('x')"</script>`);

    expect(snippet).not.toContain("<script>");
    expect(snippet).toContain("&lt;script&gt;&quot;alert(&#39;x&#39;)&quot;&lt;/script&gt;");
  });
});
