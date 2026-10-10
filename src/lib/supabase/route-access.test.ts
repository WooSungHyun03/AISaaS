import { describe, expect, it } from "vitest";
import { AUTH_PREFIXES, PROTECTED_PREFIXES, matchesPrefix } from "./route-access";

describe("matchesPrefix", () => {
  it("protects a route and its children", () => {
    expect(matchesPrefix("/settings", PROTECTED_PREFIXES)).toBe(true);
    expect(matchesPrefix("/usage", PROTECTED_PREFIXES)).toBe(true);
    expect(matchesPrefix("/automations/abc/runs/1", PROTECTED_PREFIXES)).toBe(true);
    expect(matchesPrefix("/reset-password", PROTECTED_PREFIXES)).toBe(true);
  });

  it("does not match lookalike paths across a segment boundary", () => {
    expect(matchesPrefix("/settings-old", PROTECTED_PREFIXES)).toBe(false);
    expect(matchesPrefix("/supporters", PROTECTED_PREFIXES)).toBe(false);
    expect(matchesPrefix("/login-help", AUTH_PREFIXES)).toBe(false);
  });

  it("keeps public pages and the auth callback open", () => {
    for (const path of ["/", "/pricing", "/terms", "/privacy", "/auth/callback", "/forgot-password"]) {
      expect(matchesPrefix(path, PROTECTED_PREFIXES)).toBe(false);
    }
  });
});
