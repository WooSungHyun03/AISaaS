import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock, createAdminClientMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

const { updateContentHistory } = await import("./actions");

const CONTENT_ID = "11111111-1111-4111-8111-111111111111";

function userClient(options: { user?: boolean; row?: { id: string; business_id: string } | null } = {}) {
  const row = options.row === undefined ? { id: CONTENT_ID, business_id: "biz-1" } : options.row;
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user === false ? null : { id: "user-1" } } }) },
    from: vi.fn(() => builder),
  };
}

function adminClient(result: { data: unknown; error: unknown } = { data: { id: CONTENT_ID }, error: null }) {
  const updates: unknown[] = [];
  const eqs: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  builder.update = vi.fn((payload: unknown) => (updates.push(payload), builder));
  builder.eq = vi.fn((...args: unknown[]) => (eqs.push(args), builder));
  builder.select = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  return { client: { from: vi.fn(() => builder) }, updates, eqs };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

afterEach(() => vi.clearAllMocks());

describe("updateContentHistory", () => {
  it("requires login", async () => {
    createClientMock.mockResolvedValue(userClient({ user: false }));
    expect(await updateContentHistory(CONTENT_ID, form({ title: "t", content: "c" }))).toEqual({ error: "로그인이 필요합니다." });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("validates input before touching the database", async () => {
    createClientMock.mockResolvedValue(userClient());
    expect((await updateContentHistory(CONTENT_ID, form({ title: " ", content: "본문" }))).error).toContain("제목");
    expect((await updateContentHistory(CONTENT_ID, form({ title: "제목", content: "" }))).error).toContain("본문");
    expect((await updateContentHistory("not-a-uuid", form({ title: "제목", content: "본문" }))).error).toBeTruthy();
    expect((await updateContentHistory(CONTENT_ID, form({ title: "제목", content: "가".repeat(30_001) }))).error).toContain("30,000");
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("refuses a row the caller cannot see under RLS (someone else's post) — the service-role write never happens", async () => {
    createClientMock.mockResolvedValue(userClient({ row: null }));

    const result = await updateContentHistory(CONTENT_ID, form({ title: "제목", content: "본문" }));

    expect(result.error).toContain("찾을 수 없");
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("writes only title/content/edited_at, scoped to the verified row and its business", async () => {
    createClientMock.mockResolvedValue(userClient());
    const admin = adminClient();
    createAdminClientMock.mockReturnValue(admin.client);

    const result = await updateContentHistory(CONTENT_ID, form({ title: " 새 제목 ", content: " 고친 본문 ", run_id: "injected", external_url: "https://evil.example" }));

    expect(result).toMatchObject({ success: true });
    expect(Object.keys(admin.updates[0] as object).sort()).toEqual(["content", "edited_at", "title"]);
    expect(admin.updates[0]).toMatchObject({ title: "새 제목", content: "고친 본문" });
    expect(admin.eqs).toEqual([["id", CONTENT_ID], ["business_id", "biz-1"]]);
    expect(revalidatePathMock).toHaveBeenCalledWith("/blog");
  });

  it("reports a failed write", async () => {
    createClientMock.mockResolvedValue(userClient());
    createAdminClientMock.mockReturnValue(adminClient({ data: null, error: new Error("db") }).client);
    expect((await updateContentHistory(CONTENT_ID, form({ title: "제목", content: "본문" }))).error).toContain("저장하지 못했어요");
  });
});
