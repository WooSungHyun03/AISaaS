import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/server", () => ({
  requireEnv: () => Buffer.alloc(32, 7).toString("base64"),
}));

const { encryptWordPressPassword, decryptWordPressPassword } = await import("./credentials");

describe("WordPress credential storage", () => {
  it("encrypts passwords with a fresh nonce and detects tampering", () => {
    const first = encryptWordPressPassword("my-app-password");
    const second = encryptWordPressPassword("my-app-password");

    expect(first).not.toBe(second);
    expect(first).not.toContain("my-app-password");
    expect(decryptWordPressPassword(first)).toBe("my-app-password");
    expect(() => decryptWordPressPassword(`${first}tampered`)).toThrow();
  });
});
