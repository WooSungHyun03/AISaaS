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

  it("saves the 6-key SNS link set (naver_blog/naver_place/kakao_channel included), never the old generic 'blog' key", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);

    const result = await createBusiness(
      {},
      formData({
        ...BASE_FIELDS,
        "snsLinks.naver_blog": "https://blog.naver.com/ourcafe",
        "snsLinks.naver_place": "https://map.naver.com/p/entry/place/123456",
        "snsLinks.kakao_channel": "https://pf.kakao.com/_ourcafe",
      }),
    );

    expect(result.error).toBeUndefined();
    expect(inserted[0]).toMatchObject({
      sns_links: {
        naver_blog: "https://blog.naver.com/ourcafe",
        naver_place: "https://map.naver.com/p/entry/place/123456",
        kakao_channel: "https://pf.kakao.com/_ourcafe",
      },
    });
    expect(inserted[0].sns_links).not.toHaveProperty("blog");
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

    expect(result.error).toBe("인스타그램 링크는 http 또는 https 주소로 입력해주세요.");
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

describe("createBusiness — SNS link ownership", () => {
  it("rejects a link on the wrong site saved under a channel", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);

    const result = await createBusiness({}, formData({ name: "우리가게", "snsLinks.instagram": "https://example.com/ourcafe" }));

    expect(result.error).toContain("인스타그램 링크가 아니에요");
    expect(inserted).toHaveLength(0);
  });
});
