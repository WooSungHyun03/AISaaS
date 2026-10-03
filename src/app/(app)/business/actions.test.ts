import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

const { createBusiness } = await import("./actions");

function formData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function makeClient() {
  const inserted: Array<Record<string, unknown>> = [];
  const from = vi.fn((table: string) => {
    if (table !== "businesses") throw new Error(`Unexpected table: ${table}`);
    return {
      insert: vi.fn((payload: Record<string, unknown>) => {
        inserted.push(payload);
        return Promise.resolve({ data: null, error: null });
      }),
    };
  });
  return {
    client: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }, from },
    inserted,
  };
}

const BASE_FIELDS = { name: "우리가게" };

afterEach(() => {
  vi.clearAllMocks();
});

describe("createBusiness — marketing profile fields (ticket 2)", () => {
  it("saves main offering/strengths/marketing goal and only the SNS links that were filled in", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);

    const result = await createBusiness(
      {},
      formData({
        ...BASE_FIELDS,
        mainOffering: "핸드드립 커피",
        strengths: "직접 로스팅한 원두",
        marketingGoal: "신규 고객 유입",
        "snsLinks.instagram": "https://instagram.com/ourcafe",
        "snsLinks.facebook": "",
      }),
    );

    expect(result.error).toBeUndefined();
    expect(inserted[0]).toMatchObject({
      main_offering: "핸드드립 커피",
      strengths: "직접 로스팅한 원두",
      marketing_goal: "신규 고객 유입",
      sns_links: { instagram: "https://instagram.com/ourcafe" },
    });
    expect(inserted[0].sns_links).not.toHaveProperty("facebook");
  });

  it("defaults the new profile fields to null/empty when left blank", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);

    const result = await createBusiness({}, formData(BASE_FIELDS));

    expect(result.error).toBeUndefined();
    expect(inserted[0]).toMatchObject({ main_offering: null, strengths: null, marketing_goal: null, sns_links: {} });
  });

  it("rejects a non-http(s) SNS link instead of saving it", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);

    const result = await createBusiness({}, formData({ ...BASE_FIELDS, "snsLinks.instagram": "javascript:alert(1)" }));

    expect(result.error).toBe("SNS 링크는 http 또는 https 주소로 입력해주세요.");
    expect(inserted).toHaveLength(0);
  });

  it("rejects a main offering over the length cap", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);

    const result = await createBusiness({}, formData({ ...BASE_FIELDS, mainOffering: "a".repeat(301) }));

    expect(result.error).toBe("주요 상품/서비스, 강점, 마케팅 목표 입력 길이를 확인해주세요.");
    expect(inserted).toHaveLength(0);
  });
});
