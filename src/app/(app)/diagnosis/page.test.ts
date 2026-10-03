import { afterEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const { default: DiagnosisPage } = await import("./page");

afterEach(() => vi.clearAllMocks());

describe("/diagnosis (merged into /marketing/diagnosis)", () => {
  it("redirects to /marketing/diagnosis", async () => {
    await DiagnosisPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).toHaveBeenCalledWith("/marketing/diagnosis");
  });

  it("forwards the ?business= query param", async () => {
    await DiagnosisPage({ searchParams: Promise.resolve({ business: "biz-1" }) });

    expect(redirectMock).toHaveBeenCalledWith("/marketing/diagnosis?business=biz-1");
  });
});
