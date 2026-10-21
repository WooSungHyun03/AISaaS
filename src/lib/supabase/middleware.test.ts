import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  accountStatus: "ACTIVE",
  refreshed: [] as CookieToSet[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: CookieToSet[]) => void } }) => ({
    auth: {
      getClaims: async () => {
        // Simulates @supabase/ssr refreshing an expired access token while the claims are read.
        if (state.refreshed.length > 0) opts.cookies.setAll(state.refreshed);
        return { data: state.user ? { claims: { sub: state.user.id } } : null };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { account_status: state.accountStatus } }) }),
      }),
    }),
  }),
}));

const { updateSession } = await import("./middleware");

const REFRESHED = { name: "sb-test-auth-token", value: "rotated", options: { path: "/", maxAge: 3600 } };

beforeEach(() => {
  state.user = { id: "user-1" };
  state.accountStatus = "ACTIVE";
  state.refreshed = [REFRESHED];
});

function req(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("updateSession", () => {
  it("keeps the refreshed session cookie when bouncing a signed-in user off /login", async () => {
    const res = await updateSession(req("/login"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
    expect(res.cookies.get(REFRESHED.name)?.value).toBe("rotated");
  });

  it("keeps the refreshed session cookie on the suspended-account redirect", async () => {
    state.accountStatus = "SUSPENDED";
    const res = await updateSession(req("/dashboard"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/account-suspended");
    expect(res.cookies.get(REFRESHED.name)?.value).toBe("rotated");
  });

  it("sends a signed-out visitor of a protected page to /login with only redirectTo", async () => {
    state.user = null;
    state.refreshed = [];
    const res = await updateSession(req("/billing?session=abc"));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect([...location.searchParams.keys()]).toEqual(["redirectTo"]);
    expect(location.searchParams.get("redirectTo")).toBe("/billing");
  });

  it("passes through with the refreshed cookie when no redirect is needed", async () => {
    const res = await updateSession(req("/dashboard"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(REFRESHED.name)?.value).toBe("rotated");
  });
});
