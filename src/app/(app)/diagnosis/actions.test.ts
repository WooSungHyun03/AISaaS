import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock, diagnoseWebsiteMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  diagnoseWebsiteMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/server/marketing/diagnosis", async () => {
  const actual = await vi.importActual<typeof import("@/server/marketing/diagnosis")>("@/server/marketing/diagnosis");
  return { ...actual, diagnoseWebsite: diagnoseWebsiteMock };
});

const { runDiagnosis } = await import("./actions");
const { DiagnosisError } = await import("@/server/marketing/diagnosis");

type QueryResult = { data: unknown; error: unknown };

function makeClient(options: { business?: QueryResult; insert?: QueryResult } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const businessResult = options.business ?? { data: { id: "business-1", name: "우리가게", industry: "카페" }, error: null };
  const insertResult = options.insert ?? { data: { id: "diagnosis-1" }, error: null };

  const from = vi.fn((table: string) => {
    if (table === "businesses") {
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(businessResult) })) })) })),
      };
    }
    if (table === "marketing_diagnoses") {
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          inserted.push(payload);
          return { select: vi.fn(() => ({ single: vi.fn().mockResolvedValue(insertResult) })) };
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    client: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }, from },
    inserted,
  };
}

function formData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("runDiagnosis", () => {
  it("analyzes the URL and saves the result scoped to the caller's own business", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);
    diagnoseWebsiteMock.mockResolvedValue({
      score: 70,
      missingChannels: ["instagram"],
      contentStatus: "콘텐츠가 부족합니다.",
      snsActivity: "SNS 연동이 없습니다.",
      recommendations: ["인스타그램을 연결하세요."],
      sourceUrl: "https://example.com/",
      rawSummary: "우리가게 — 소개",
      mainOffering: "핸드드립 커피",
      strengths: null,
      marketingGoal: null,
      snsLinks: { instagram: "https://instagram.com/ourcafe" },
    });

    const result = await runDiagnosis({}, formData({ businessId: "business-1", url: "https://example.com" }));

    expect(result.error).toBeUndefined();
    expect(result.result).toMatchObject({ id: "diagnosis-1", score: 70, sourceUrl: "https://example.com/" });
    // Profile suggestions pass through for client-side prefill, but are not
    // among the columns written to marketing_diagnoses below — see the
    // next assertion and the "never writes to businesses" test.
    expect(result.result?.profileSuggestions).toEqual({
      mainOffering: "핸드드립 커피",
      strengths: null,
      marketingGoal: null,
      snsLinks: { instagram: "https://instagram.com/ourcafe" },
    });
    expect(diagnoseWebsiteMock).toHaveBeenCalledWith({ id: "business-1", name: "우리가게", industry: "카페" }, "https://example.com");
    expect(inserted[0]).toMatchObject({ business_id: "business-1", source_type: "website", score: 70 });
    expect(inserted[0]).not.toHaveProperty("main_offering");
    expect(revalidatePathMock).toHaveBeenCalledWith("/diagnosis");
  });

  it("never writes to the businesses table — the mocked client only exposes select() on it, so any write attempt would throw", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);
    diagnoseWebsiteMock.mockResolvedValue({
      score: 70,
      missingChannels: [],
      contentStatus: "ok",
      snsActivity: "ok",
      recommendations: [],
      sourceUrl: "https://example.com/",
      rawSummary: null,
      mainOffering: "핸드드립 커피",
      strengths: "직접 로스팅",
      marketingGoal: "신규 고객 유입",
      snsLinks: {},
    });

    const result = await runDiagnosis({}, formData({ businessId: "business-1", url: "https://example.com" }));

    expect(result.error).toBeUndefined();
    expect(inserted).toHaveLength(1); // only the marketing_diagnoses insert — businesses was never written to
  });

  it("refuses to run when the business doesn't belong to the caller, and never calls diagnoseWebsite", async () => {
    const { client } = makeClient({ business: { data: null, error: null } });
    createClientMock.mockResolvedValue(client);

    const result = await runDiagnosis({}, formData({ businessId: "someone-elses-business", url: "https://example.com" }));

    expect(result.error).toBe("본인의 사업체를 선택해주세요.");
    expect(diagnoseWebsiteMock).not.toHaveBeenCalled();
  });

  it("surfaces a Korean error and never writes to the DB when the URL targets a private/internal address", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);
    diagnoseWebsiteMock.mockRejectedValue(new DiagnosisError("BLOCKED_TARGET", "내부/사설 네트워크 주소는 진단할 수 없습니다."));

    const result = await runDiagnosis({}, formData({ businessId: "business-1", url: "http://169.254.169.254/" }));

    expect(result.error).toContain("내부/사설 네트워크");
    expect(inserted).toHaveLength(0);
  });

  it("requires both a businessId and a url before calling diagnoseWebsite", async () => {
    const { client } = makeClient();
    createClientMock.mockResolvedValue(client);

    const result = await runDiagnosis({}, formData({ businessId: "business-1", url: "" }));

    expect(result.error).toBe("사업체와 홈페이지 주소를 확인해주세요.");
    expect(diagnoseWebsiteMock).not.toHaveBeenCalled();
  });
});
