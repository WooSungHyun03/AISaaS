import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock, revalidatePathMock, removeShortsFilesMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  removeShortsFilesMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/server/account/delete-account", () => ({ removeShortsFiles: removeShortsFilesMock }));

const { createBusiness, deleteBusiness, updateBusiness } = await import("./actions");

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

describe("createBusiness — promotion target", () => {
  it("saves the chosen type with its extra answers, trimmed and without empty ones", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);

    const result = await createBusiness({}, formData({ ...BASE_FIELDS, promotionType: "PRODUCT", problem: " 눅눅해요 ", priceInfo: "", actionUrl: "https://shop.example/p/1", flow: "" }));

    expect(result.error).toBeUndefined();
    expect(inserted[0]).toMatchObject({ promotion_type: "PRODUCT", promotion_details: { problem: "눅눅해요", actionUrl: "https://shop.example/p/1" } });
    expect(inserted[0].promotion_details).not.toHaveProperty("priceInfo");
  });

  it("rejects an unknown type and a purchase address that is not http(s)", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);

    expect((await createBusiness({}, formData({ ...BASE_FIELDS, promotionType: "COMPANY" }))).error).toContain("홍보 대상");
    expect((await createBusiness({}, formData({ ...BASE_FIELDS, promotionType: "PRODUCT", actionUrl: "javascript:alert(1)" }))).error).toContain("주소");
    expect(inserted).toHaveLength(0);
  });

  it("leaves the type alone when the form does not ask for it", async () => {
    const { client, inserted } = makeClient();
    createClientMock.mockResolvedValue(client);

    await createBusiness({}, formData(BASE_FIELDS));

    expect(inserted[0]).not.toHaveProperty("promotion_type");
    expect(inserted[0]).not.toHaveProperty("promotion_details");
  });
});

describe("updateBusiness", () => {
  function makeUpdateClient(user: { id: string } | null, row: { id: string } | null) {
    const filters: Array<[string, unknown]> = [];
    const chain = {
      eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return chain; }),
      select: vi.fn(() => chain),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    const update = vi.fn(() => chain);
    return {
      client: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, from: vi.fn(() => ({ update })) },
      update,
      filters,
    };
  }

  it("scopes the update to the caller's own business and reports success", async () => {
    const { client, filters } = makeUpdateClient({ id: "user-1" }, { id: "biz-1" });
    createClientMock.mockResolvedValue(client);

    const result = await updateBusiness("biz-1", {}, formData(BASE_FIELDS));

    expect(result).toEqual({ success: true });
    expect(filters).toEqual([["id", "biz-1"], ["owner_id", "user-1"]]);
  });

  it("does not claim success when no row was updated", async () => {
    const { client } = makeUpdateClient({ id: "user-1" }, null);
    createClientMock.mockResolvedValue(client);

    const result = await updateBusiness("someone-elses", {}, formData(BASE_FIELDS));

    expect(result.success).toBeUndefined();
    expect(result.error).toContain("찾을 수 없습니다");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    const { client, update } = makeUpdateClient(null, null);
    createClientMock.mockResolvedValue(client);

    expect((await updateBusiness("biz-1", {}, formData(BASE_FIELDS))).error).toBe("로그인이 필요합니다.");
    expect(update).not.toHaveBeenCalled();
  });
});

describe("deleteBusiness", () => {
  /** A chainable query stub: every filter returns itself, awaiting it (or .maybeSingle()) yields `result`. */
  function query(result: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "limit", "delete"]) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => Promise.resolve(result));
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  }

  function client({ automations, inFlight, deleteError = null }: { automations: Array<{ id: string }>; inFlight: { id: string } | null; deleteError?: unknown }) {
    const deleted = query(deleteError ? { data: null, error: deleteError } : { data: { id: "biz-1" }, error: null });
    const tables: Record<string, Array<Record<string, unknown>>> = {
      automations: [query({ data: automations, error: null })],
      automation_runs: [query({ data: inFlight, error: null })],
      businesses: [deleted],
    };
    return {
      client: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }, from: vi.fn((table: string) => tables[table].shift()) },
      deleted,
    };
  }

  it("refuses while one of the business's automations has a run in flight (its credit reservation would be stranded)", async () => {
    const { client: supabase, deleted } = client({ automations: [{ id: "auto-1" }], inFlight: { id: "run-1" } });
    createClientMock.mockResolvedValue(supabase);

    const result = await deleteBusiness("biz-1");

    expect(result.error).toContain("만드는 중");
    expect(deleted.delete).not.toHaveBeenCalled();
    expect(removeShortsFilesMock).not.toHaveBeenCalled();
  });

  it("says a run is in flight when the database refuses the delete (a run started after the check, migration 0078)", async () => {
    const { client: supabase } = client({ automations: [{ id: "auto-1" }], inFlight: null, deleteError: { code: "55006" } });
    createClientMock.mockResolvedValue(supabase);

    expect((await deleteBusiness("biz-1")).error).toContain("만드는 중");
    expect(removeShortsFilesMock).not.toHaveBeenCalled();
  });

  it("deletes an idle business and removes the stored Shorts files of each of its automations", async () => {
    const { client: supabase, deleted } = client({ automations: [{ id: "auto-1" }, { id: "auto-2" }], inFlight: null });
    createClientMock.mockResolvedValue(supabase);

    const result = await deleteBusiness("biz-1");

    expect(result).toEqual({ success: true });
    expect(deleted.delete).toHaveBeenCalled();
    expect(removeShortsFilesMock.mock.calls.map((call) => call[1])).toEqual(["user-1/auto-1", "user-1/auto-2"]);
  });
});
