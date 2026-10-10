import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock, redirectMock, cookieStore } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  cookieStore: { get: vi.fn(), delete: vi.fn() },
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

const { signUp, requestPasswordReset, completePasswordReset, changePassword } = await import("./actions");

function formData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function makeAuth(overrides: Record<string, unknown> = {}) {
  const auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "owner@example.com" } } }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  };
  createClientMock.mockResolvedValue({ auth });
  return auth;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("signUp", () => {
  const fields = { displayName: "홍길동", email: "owner@example.com", password: "password123" };

  it("requires agreeing to the terms and privacy policy", async () => {
    const auth = makeAuth();
    expect(await signUp({}, formData(fields))).toEqual({ error: "이용약관과 개인정보처리방침에 동의해주세요." });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("sends the confirmation link through the auth callback back to onboarding", async () => {
    const auth = makeAuth();
    await expect(signUp({}, formData({ ...fields, agreeTerms: "on" }))).rejects.toThrow("REDIRECT:/login?");
    expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe("http://localhost:3000/auth/callback?next=%2Fonboarding");
  });

  it("shows a Korean message instead of the raw Supabase error", async () => {
    makeAuth({ signUp: vi.fn().mockResolvedValue({ data: {}, error: { code: "user_already_exists", message: "User already registered" } }) });
    const result = await signUp({}, formData({ ...fields, agreeTerms: "on" }));
    expect(result.error).toContain("이미 가입된 이메일");
    expect(result.error).not.toContain("User already");
  });
});

describe("requestPasswordReset", () => {
  it("answers the same way whether or not the account exists", async () => {
    const auth = makeAuth({ resetPasswordForEmail: vi.fn().mockResolvedValue({ error: { code: "user_not_found", message: "User not found" } }) });
    expect(await requestPasswordReset({}, formData({ email: "nobody@example.com" }))).toEqual({ success: true });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("nobody@example.com", {
      redirectTo: "http://localhost:3000/auth/callback?next=%2Freset-password",
    });
  });

  it("surfaces rate limiting so the user knows to wait", async () => {
    makeAuth({ resetPasswordForEmail: vi.fn().mockResolvedValue({ error: { code: "over_email_send_rate_limit", message: "rate limit" } }) });
    const result = await requestPasswordReset({}, formData({ email: "owner@example.com" }));
    expect(result.error).toContain("잠시 후");
  });

  it("rejects a malformed address without calling Supabase", async () => {
    const auth = makeAuth();
    expect((await requestPasswordReset({}, formData({ email: "not-an-email" }))).error).toBeDefined();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("completePasswordReset", () => {
  const fields = { password: "new-password-1", confirmPassword: "new-password-1" };

  it("refuses a session that did not come through a recovery link", async () => {
    const auth = makeAuth();
    cookieStore.get.mockReturnValue(undefined);
    const result = await completePasswordReset({}, formData(fields));
    expect(result.error).toContain("만료");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("updates the password and clears the recovery marker", async () => {
    const auth = makeAuth();
    cookieStore.get.mockReturnValue({ value: "1" });
    expect(await completePasswordReset({}, formData(fields))).toEqual({ success: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-password-1" });
    expect(cookieStore.delete).toHaveBeenCalledWith({ name: "em_pw_recovery", path: "/reset-password" });
  });

  it("rejects mismatched confirmation", async () => {
    makeAuth();
    cookieStore.get.mockReturnValue({ value: "1" });
    const result = await completePasswordReset({}, formData({ password: "new-password-1", confirmPassword: "different-1" }));
    expect(result.error).toContain("서로 달라요");
  });
});

describe("changePassword", () => {
  const fields = { currentPassword: "old-password", password: "new-password-1", confirmPassword: "new-password-1" };

  it("re-checks the current password before changing it", async () => {
    const auth = makeAuth({ signInWithPassword: vi.fn().mockResolvedValue({ error: { code: "invalid_credentials" } }) });
    expect(await changePassword({}, formData(fields))).toEqual({ error: "현재 비밀번호가 올바르지 않아요." });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("changes the password when the current one is right", async () => {
    const auth = makeAuth();
    expect(await changePassword({}, formData(fields))).toEqual({ success: true });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "owner@example.com", password: "old-password" });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-password-1" });
  });

  it("rejects reusing the current password", async () => {
    makeAuth();
    const result = await changePassword({}, formData({ ...fields, password: "old-password", confirmPassword: "old-password" }));
    expect(result.error).toContain("다른 비밀번호");
  });
});
