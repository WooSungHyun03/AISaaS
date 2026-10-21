import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/env/server", () => ({ serverEnv: new Proxy({}, { get: (_t, key: string) => env.value[key] }) }));

const { getVideoPipelineChecks, missingVideoRequirements } = await import("./video-readiness");

const READY = { AD_VIDEO_PROVIDER: "fal", FAL_KEY: "k", AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", POSTPROCESS_PROVIDER: "worker", POSTPROCESS_WORKER_URL: "https://w.example.com", POSTPROCESS_WORKER_TOKEN: "x".repeat(24), ALLOW_PAID_AI_CALLS: "true", BUDGET_PERIOD_START: "2026-10-01", BUDGET_PERIOD_END: "2026-10-31" };

beforeEach(() => { env.value = { ...READY }; });

describe("video pipeline readiness", () => {
  it("reports nothing missing when everything is configured (the voice service is optional)", () => {
    expect(missingVideoRequirements()).toEqual([]);
    expect(getVideoPipelineChecks().find((check) => check.name.startsWith("TTS_PROVIDER"))).toMatchObject({ ok: false, required: false });
  });

  it("names the one thing missing in production on 2026-10-21: the worker address", () => {
    delete env.value.POSTPROCESS_WORKER_URL;
    expect(missingVideoRequirements()).toEqual(["POSTPROCESS_WORKER_URL"]);
  });

  it("names every missing piece, and never a value", () => {
    env.value = { AD_VIDEO_PROVIDER: "mock", FAL_KEY: "secret-value" };
    const missing = missingVideoRequirements();
    expect(missing).toEqual(expect.arrayContaining(["AD_VIDEO_PROVIDER", "AI_PROVIDER", "POSTPROCESS_PROVIDER", "POSTPROCESS_WORKER_URL", "ALLOW_PAID_AI_CALLS", "BUDGET_PERIOD_START/END"]));
    expect(missing).not.toContain("FAL_KEY");
    expect(JSON.stringify(getVideoPipelineChecks())).not.toContain("secret-value");
  });
});
