import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock, diagnoseWebsiteMock, revalidatePathMock, registerAndDiagnoseChannelMock, diagnoseChannelMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  diagnoseWebsiteMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  registerAndDiagnoseChannelMock: vi.fn(),
  diagnoseChannelMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/server/marketing/diagnosis", async () => {
  const actual = await vi.importActual<typeof import("@/server/marketing/diagnosis")>("@/server/marketing/diagnosis");
  return { ...actual, diagnoseWebsite: diagnoseWebsiteMock };
});
vi.mock("@/server/channels", async () => {
  const actual = await vi.importActual<typeof import("@/server/channels")>("@/server/channels");
  return { ...actual, registerAndDiagnoseChannel: registerAndDiagnoseChannelMock, diagnoseChannel: diagnoseChannelMock };
});

const { runDiagnosis, addChannel, rediagnoseChannel } = await import("./actions");
const { DiagnosisError } = await import("@/server/marketing/diagnosis");
const { ChannelsError, DiagnosisRateLimitError } = await import("@/server/channels");

type QueryResult = { data: unknown; error: unknown };

function makeClient(options: { business?: QueryResult; insert?: QueryResult; recentCount?: number; connections?: Array<{ provider: string }> } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const businessResult = options.business ?? { data: { id: "business-1", name: "우리가게", industry: "카페", sns_links: { naver_blog: "https://blog.naver.com/x" } }, error: null };
  const insertResult = options.insert ?? { data: { id: "diagnosis-1", created_at: "2026-10-01T00:00:00.000Z" }, error: null };

  const from = vi.fn((table: string) => {
    if (table === "businesses") {
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(businessResult) })) })) })),
      };
    }
    if (table === "integration_connections") {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) builder[method] = vi.fn(() => builder);
      builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: options.connections ?? [], error: null });
      return builder;
    }
    if (table === "marketing_diagnoses") {
      return {
        select: vi.fn(() => {
          const builder: Record<string, unknown> = {};
          for (const method of ["eq", "gte"]) builder[method] = vi.fn(() => builder);
          builder.then = (resolve: (value: unknown) => unknown) => resolve({ count: options.recentCount ?? 0, error: null });
          return builder;
        }),
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
      scoreBreakdown: [{ key: "https", group: "website", label: "보안 연결(HTTPS)", points: 5, max: 5, detail: "HTTPS로 접속돼요." }],
      evidence: { mainOffering: "핸드드립 커피를 내립니다" },
      aiUsed: true,
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
    expect(diagnoseWebsiteMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "business-1", name: "우리가게" }),
      "https://example.com",
      { profileSnsLinks: { naver_blog: "https://blog.naver.com/x" }, connectedProviders: [] },
    );
    expect(inserted[0]).toMatchObject({
      business_id: "business-1",
      source_type: "website",
      score: 70,
      score_breakdown: [expect.objectContaining({ key: "https", points: 5 })],
      evidence: { mainOffering: "핸드드립 커피를 내립니다" },
    });
    expect(result.result?.scoreBreakdown).toHaveLength(1);
    expect(inserted[0]).not.toHaveProperty("main_offering");
    expect(revalidatePathMock).toHaveBeenCalledWith("/business");
    expect(revalidatePathMock).toHaveBeenCalledWith("/calendar");
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

  it("passes connected integrations to the scorer so connected channels count", async () => {
    const { client } = makeClient({ connections: [{ provider: "instagram" }] });
    createClientMock.mockResolvedValue(client);
    diagnoseWebsiteMock.mockResolvedValue({
      score: 50, scoreBreakdown: [], evidence: {}, aiUsed: false, missingChannels: [], contentStatus: "ok", snsActivity: "ok", recommendations: [],
      sourceUrl: "https://example.com/", rawSummary: null, mainOffering: null, strengths: null, marketingGoal: null, snsLinks: {},
    });

    await runDiagnosis({}, formData({ businessId: "business-1", url: "https://example.com" }));

    expect(diagnoseWebsiteMock.mock.calls[0][2]).toMatchObject({ connectedProviders: ["instagram"] });
  });

  it("rate-limits repeated diagnoses of the same business before fetching or calling the AI", async () => {
    const { client, inserted } = makeClient({ recentCount: 5 });
    createClientMock.mockResolvedValue(client);

    const result = await runDiagnosis({}, formData({ businessId: "business-1", url: "https://example.com" }));

    expect(result.error).toContain("너무 자주");
    expect(diagnoseWebsiteMock).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("still saves the diagnosis when the 0032 columns don't exist yet (code deployed before the migration)", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    let call = 0;
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: vi.fn((table: string) => {
        if (table === "businesses") return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: "business-1", name: "우리가게", industry: "카페", sns_links: {} }, error: null }) })) })) })) };
        if (table === "integration_connections") {
          const builder: Record<string, unknown> = {};
          for (const method of ["select", "eq"]) builder[method] = vi.fn(() => builder);
          builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
          return builder;
        }
        return {
          select: vi.fn(() => {
            const builder: Record<string, unknown> = {};
            for (const method of ["eq", "gte"]) builder[method] = vi.fn(() => builder);
            builder.then = (resolve: (value: unknown) => unknown) => resolve({ count: 0, error: null });
            return builder;
          }),
          insert: vi.fn((payload: Record<string, unknown>) => {
            inserted.push(payload);
            const result = call++ === 0 ? { data: null, error: { code: "PGRST204" } } : { data: { id: "diagnosis-1", created_at: "2026-10-01T00:00:00.000Z" }, error: null };
            return { select: vi.fn(() => ({ single: vi.fn().mockResolvedValue(result) })) };
          }),
        };
      }),
    };
    createClientMock.mockResolvedValue(client);
    diagnoseWebsiteMock.mockResolvedValue({
      score: 50, scoreBreakdown: [], evidence: {}, aiUsed: false, missingChannels: [], contentStatus: "ok", snsActivity: "ok", recommendations: [],
      sourceUrl: "https://example.com/", rawSummary: null, mainOffering: null, strengths: null, marketingGoal: null, snsLinks: {},
    });

    const result = await runDiagnosis({}, formData({ businessId: "business-1", url: "https://example.com" }));

    expect(result.error).toBeUndefined();
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toHaveProperty("score_breakdown");
    expect(inserted[1]).not.toHaveProperty("score_breakdown");
  });

  it("requires both a businessId and a url before calling diagnoseWebsite", async () => {
    const { client } = makeClient();
    createClientMock.mockResolvedValue(client);

    const result = await runDiagnosis({}, formData({ businessId: "business-1", url: "" }));

    expect(result.error).toBe("사업체와 홈페이지 주소를 확인해주세요.");
    expect(diagnoseWebsiteMock).not.toHaveBeenCalled();
  });
});

function makeOwnershipClient(options: { businessOwned?: boolean; trackedChannel?: { data: unknown; error: unknown }; businessName?: { data: unknown; error: unknown } } = {}) {
  const businessSelect = { eq: vi.fn(() => businessSelect), maybeSingle: vi.fn().mockResolvedValue(options.businessOwned === false ? { data: null, error: null } : { data: { id: "business-1", name: "우리가게" }, error: null }) };
  const trackedChannelsSelect = { eq: vi.fn(() => trackedChannelsSelect), maybeSingle: vi.fn().mockResolvedValue(options.trackedChannel ?? { data: null, error: null }) };
  const businessNameSelect = { eq: vi.fn(() => businessNameSelect), maybeSingle: vi.fn().mockResolvedValue(options.businessName ?? { data: { name: "우리가게" }, error: null }) };

  const from = vi.fn((table: string) => {
    if (table === "businesses") return { select: vi.fn(() => (options.businessName !== undefined ? businessNameSelect : businessSelect)) };
    if (table === "tracked_channels") return { select: vi.fn(() => trackedChannelsSelect) };
    throw new Error(`Unexpected table: ${table}`);
  });

  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }, from };
}

function withFormData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("addChannel", () => {
  it("registers and diagnoses the channel, then revalidates /diagnosis", async () => {
    createClientMock.mockResolvedValue(makeOwnershipClient());
    registerAndDiagnoseChannelMock.mockResolvedValue({ ok: true, channelId: "channel-1", diagnosis: { channel: "youtube" } });

    const result = await addChannel({}, withFormData({ businessId: "business-1", url: "https://youtube.com/@mychannel" }));

    expect(result).toEqual({ channelId: "channel-1" });
    expect(registerAndDiagnoseChannelMock).toHaveBeenCalledWith("business-1", "https://youtube.com/@mychannel", undefined);
    expect(revalidatePathMock).toHaveBeenCalledWith("/diagnosis");
  });

  it("passes an explicit platform hint through when one was chosen", async () => {
    createClientMock.mockResolvedValue(makeOwnershipClient());
    registerAndDiagnoseChannelMock.mockResolvedValue({ ok: true, channelId: "channel-1", diagnosis: { channel: "tistory" } });

    await addChannel({}, withFormData({ businessId: "business-1", url: "https://blog.mycustomdomain.com", platformHint: "tistory" }));

    expect(registerAndDiagnoseChannelMock).toHaveBeenCalledWith("business-1", "https://blog.mycustomdomain.com", "tistory");
  });

  it("surfaces the URL parser's message when registerAndDiagnoseChannel reports ok: false", async () => {
    createClientMock.mockResolvedValue(makeOwnershipClient());
    registerAndDiagnoseChannelMock.mockResolvedValue({ ok: false, message: "지원하지 않는 채널 URL 형식이에요." });

    const result = await addChannel({}, withFormData({ businessId: "business-1", url: "not a channel url" }));

    expect(result.error).toBe("지원하지 않는 채널 URL 형식이에요.");
  });

  it("refuses to run when the business doesn't belong to the caller", async () => {
    createClientMock.mockResolvedValue(makeOwnershipClient({ businessOwned: false }));

    const result = await addChannel({}, withFormData({ businessId: "someone-elses-business", url: "https://youtube.com/@mychannel" }));

    expect(result.error).toBe("본인의 사업체를 선택해주세요.");
    expect(registerAndDiagnoseChannelMock).not.toHaveBeenCalled();
  });

  it("maps a DiagnosisRateLimitError to its own message", async () => {
    createClientMock.mockResolvedValue(makeOwnershipClient());
    registerAndDiagnoseChannelMock.mockRejectedValue(new DiagnosisRateLimitError());

    const result = await addChannel({}, withFormData({ businessId: "business-1", url: "https://youtube.com/@mychannel" }));

    expect(result.error).toContain("한도");
  });

  it("maps a provider error code (e.g. quota exceeded) to a Korean message", async () => {
    createClientMock.mockResolvedValue(makeOwnershipClient());
    registerAndDiagnoseChannelMock.mockRejectedValue(Object.assign(new Error("quota"), { code: "QUOTA_EXCEEDED" }));

    const result = await addChannel({}, withFormData({ businessId: "business-1", url: "https://youtube.com/@mychannel" }));

    expect(result.error).toContain("할당량");
  });

  it("maps a ChannelsError to a generic Korean message", async () => {
    createClientMock.mockResolvedValue(makeOwnershipClient());
    registerAndDiagnoseChannelMock.mockRejectedValue(new ChannelsError("DATABASE_ERROR", "boom"));

    const result = await addChannel({}, withFormData({ businessId: "business-1", url: "https://youtube.com/@mychannel" }));

    expect(result.error).toBeTruthy();
  });
});

describe("rediagnoseChannel", () => {
  it("re-diagnoses the channel (RLS already scopes it to the caller) and revalidates /diagnosis", async () => {
    createClientMock.mockResolvedValue(
      makeOwnershipClient({ trackedChannel: { data: { id: "channel-1", business_id: "business-1", external_id: "@mychannel", url: "https://youtube.com/@mychannel", platform: "youtube" }, error: null }, businessName: { data: { name: "우리가게" }, error: null } }),
    );
    diagnoseChannelMock.mockResolvedValue({ channel: "youtube" });

    const result = await rediagnoseChannel("channel-1");

    expect(result).toEqual({ channelId: "channel-1" });
    expect(diagnoseChannelMock).toHaveBeenCalledWith(
      { id: "channel-1", business_id: "business-1", external_id: "@mychannel", url: "https://youtube.com/@mychannel", platform: "youtube" },
      "우리가게",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/diagnosis");
  });

  it("returns an error when the channel doesn't exist (or isn't the caller's own, per RLS)", async () => {
    createClientMock.mockResolvedValue(makeOwnershipClient({ trackedChannel: { data: null, error: null } }));

    const result = await rediagnoseChannel("someone-elses-channel");

    expect(result.error).toBe("채널을 찾을 수 없습니다.");
    expect(diagnoseChannelMock).not.toHaveBeenCalled();
  });

  it("maps the hourly rate limit error to its own message", async () => {
    createClientMock.mockResolvedValue(
      makeOwnershipClient({ trackedChannel: { data: { id: "channel-1", business_id: "business-1", external_id: "@mychannel", url: "https://youtube.com/@mychannel", platform: "youtube" }, error: null } }),
    );
    diagnoseChannelMock.mockRejectedValue(new DiagnosisRateLimitError());

    const result = await rediagnoseChannel("channel-1");

    expect(result.error).toContain("한도");
  });
});
