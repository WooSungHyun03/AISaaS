import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ client: {} as Record<string, string | undefined>, server: {} as Record<string, string | undefined> }));
vi.mock("@/lib/env/client", () => ({ clientEnv: env.client }));
vi.mock("@/lib/env/server", () => ({ serverEnv: env.server }));

const { resolveTossTestKeys, tossClientKey, TossConfigError } = await import("./toss-keys");

beforeEach(() => {
  for (const record of [env.client, env.server]) for (const key of Object.keys(record)) delete record[key];
});

describe("Toss keys", () => {
  it("accepts a test key pair", () => {
    env.client.NEXT_PUBLIC_TOSS_CLIENT_KEY = "test_ck_abc";
    env.server.TOSS_SECRET_KEY = "test_sk_abc";
    expect(resolveTossTestKeys()).toEqual({ clientKey: "test_ck_abc", secretKey: "test_sk_abc" });
  });

  it("also reads the client key stored without the NEXT_PUBLIC_ prefix (the key is public anyway)", () => {
    env.server.TOSS_CLIENT_KEY = "test_ck_unprefixed";
    env.server.TOSS_SECRET_KEY = "test_sk_abc";
    expect(tossClientKey()).toBe("test_ck_unprefixed");
    expect(resolveTossTestKeys().clientKey).toBe("test_ck_unprefixed");
  });

  it("prefers the documented NEXT_PUBLIC_ name when both exist", () => {
    env.client.NEXT_PUBLIC_TOSS_CLIENT_KEY = "test_ck_public";
    env.server.TOSS_CLIENT_KEY = "test_ck_other";
    expect(tossClientKey()).toBe("test_ck_public");
  });

  it("names the exact problem: no client key, no secret key, or a live key", () => {
    env.server.TOSS_SECRET_KEY = "test_sk_abc";
    expect(() => resolveTossTestKeys()).toThrow(expect.objectContaining({ problem: "CLIENT_KEY_MISSING" }));
    env.client.NEXT_PUBLIC_TOSS_CLIENT_KEY = "test_ck_abc";
    delete env.server.TOSS_SECRET_KEY;
    expect(() => resolveTossTestKeys()).toThrow(expect.objectContaining({ problem: "SECRET_KEY_MISSING" }));
    env.server.TOSS_SECRET_KEY = "live_sk_abc";
    expect(() => resolveTossTestKeys()).toThrow(TossConfigError);
    expect(() => resolveTossTestKeys()).toThrow(expect.objectContaining({ problem: "KEYS_NOT_TEST" }));
  });

  it("never puts a key into an error message", () => {
    env.client.NEXT_PUBLIC_TOSS_CLIENT_KEY = "live_ck_SECRETVALUE";
    env.server.TOSS_SECRET_KEY = "live_sk_SECRETVALUE";
    try { resolveTossTestKeys(); } catch (error) { expect((error as Error).message).not.toContain("SECRETVALUE"); }
  });
});
