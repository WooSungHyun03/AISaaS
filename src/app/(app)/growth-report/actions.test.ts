import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as { id: string } | null, from: vi.fn(), narrative: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: state.from }),
  getAuthUser: async () => ({ id: "stale-jwt-user", email: undefined }),
}));
vi.mock("@/server/channels", () => ({ getChannelGrowthSeries: vi.fn(), getOrCreateGrowthNarrative: state.narrative }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { loadGrowthNarrative } = await import("./actions");

describe("loadGrowthNarrative", () => {
  beforeEach(() => {
    state.user = null;
    state.from.mockReset();
    state.narrative.mockReset();
  });

  it("asks the Auth server, not the cached JWT: a session that is no longer valid gets no AI reading and reads nothing", async () => {
    const result = await loadGrowthNarrative("11111111-1111-1111-1111-111111111111", 30);
    expect(result).toEqual({ error: "로그인이 필요합니다." });
    expect(state.from).not.toHaveBeenCalled();
    expect(state.narrative).not.toHaveBeenCalled();
  });

  it("refuses a period that is not offered before touching anything", async () => {
    state.user = { id: "user-1" };
    expect(await loadGrowthNarrative("11111111-1111-1111-1111-111111111111", 365)).toEqual({ error: "기간을 확인해주세요." });
    expect(state.from).not.toHaveBeenCalled();
  });
});
