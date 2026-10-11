import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/server", () => ({ serverEnv: { ADMIN_EMAILS: undefined } }));

const { adminEmails, isAdminUser } = await import("./access");

describe("admin access", () => {
  it("reads a comma separated, case-insensitive list and ignores blanks", () => {
    expect(adminEmails(" Boss@Example.com, ops@example.com ,, ")).toEqual(["boss@example.com", "ops@example.com"]);
    expect(adminEmails(undefined)).toEqual([]);
  });

  it("is admin only with a confirmed email that is on the list", () => {
    const allowed = ["boss@example.com"];
    expect(isAdminUser({ email: "BOSS@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" }, allowed)).toBe(true);
    expect(isAdminUser({ email: "boss@example.com", email_confirmed_at: null }, allowed)).toBe(false);
    expect(isAdminUser({ email: "someone@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" }, allowed)).toBe(false);
    expect(isAdminUser(null, allowed)).toBe(false);
    expect(isAdminUser({ email: null, email_confirmed_at: "x" }, allowed)).toBe(false);
  });

  it("is nobody when the list is empty", () => {
    expect(isAdminUser({ email: "boss@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" }, [])).toBe(false);
  });
});
