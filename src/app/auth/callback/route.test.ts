import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

const { GET } = await import("./route");

function mockAuth(error: unknown = null) {
  const auth = {
    exchangeCodeForSession: vi.fn().mockResolvedValue({ error }),
    verifyOtp: vi.fn().mockResolvedValue({ error }),
  };
  createClientMock.mockResolvedValue({ auth });
  return auth;
}

const call = (query: string) => GET(new NextRequest(`https://app.example.com/auth/callback${query}`));

afterEach(() => vi.clearAllMocks());

describe("GET /auth/callback", () => {
  it("exchanges the code and continues to a same-site path", async () => {
    const auth = mockAuth();
    const response = await call("?code=abc&next=%2Fonboarding");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.headers.get("location")).toBe("http://localhost:3000/onboarding");
    expect(response.cookies.get("em_pw_recovery")).toBeUndefined();
  });

  it("never redirects off-site", async () => {
    mockAuth();
    const response = await call("?code=abc&next=%2F%2Fevil.example");
    expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("marks a recovery session so the reset page will accept it", async () => {
    mockAuth();
    const response = await call("?code=abc&next=%2Freset-password");
    expect(response.headers.get("location")).toBe("http://localhost:3000/reset-password");
    const cookie = response.cookies.get("em_pw_recovery");
    expect(cookie?.value).toBe("1");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe("/reset-password");
  });

  it("sends an expired recovery link back to the forgot-password page without the marker", async () => {
    mockAuth({ code: "otp_expired" });
    const response = await call("?code=old&next=%2Freset-password");
    expect(response.headers.get("location")).toBe("http://localhost:3000/forgot-password?linkError=1");
    expect(response.cookies.get("em_pw_recovery")).toBeUndefined();
  });

  it("treats a request with no code as a failed link", async () => {
    const auth = mockAuth();
    const response = await call("?next=%2Freset-password");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("/forgot-password?linkError=1");
  });

  it("supports token_hash links from customised email templates", async () => {
    const auth = mockAuth();
    const response = await call("?token_hash=th&type=signup&next=%2Fonboarding");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "th", type: "signup" });
    expect(response.headers.get("location")).toBe("http://localhost:3000/onboarding");
  });
});
