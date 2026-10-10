import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadWith(nodeEnv: string, provider?: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  if (provider === undefined) vi.stubEnv("CHANNEL_DATA_PROVIDER", "");
  else vi.stubEnv("CHANNEL_DATA_PROVIDER", provider);
  if (provider === undefined) delete process.env.CHANNEL_DATA_PROVIDER;
  return (await import("./server")).serverEnv;
}

describe("CHANNEL_DATA_PROVIDER default", () => {
  it("defaults to the real collectors in production so a forgotten variable cannot take the site down", async () => {
    expect((await loadWith("production")).CHANNEL_DATA_PROVIDER).toBe("live");
  });

  it("defaults to the mock collectors outside production", async () => {
    expect((await loadWith("development")).CHANNEL_DATA_PROVIDER).toBe("mock");
    expect((await loadWith("test")).CHANNEL_DATA_PROVIDER).toBe("mock");
  });

  it("keeps an explicit value (the boot guard still refuses mock in production)", async () => {
    expect((await loadWith("production", "mock")).CHANNEL_DATA_PROVIDER).toBe("mock");
    expect((await loadWith("development", "live")).CHANNEL_DATA_PROVIDER).toBe("live");
  });
});
