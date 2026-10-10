import { afterEach, describe, expect, it, vi } from "vitest";

const { permanentRedirectMock } = vi.hoisted(() => ({ permanentRedirectMock: vi.fn() }));
vi.mock("next/navigation", () => ({ permanentRedirect: permanentRedirectMock }));

const { default: MarketingDiagnosisRedirectPage } = await import("./page");

afterEach(() => vi.clearAllMocks());

describe("/marketing/diagnosis (moved to /diagnosis, ticket 1-5)", () => {
  it("permanently redirects to /diagnosis", async () => {
    await MarketingDiagnosisRedirectPage({ searchParams: Promise.resolve({}) });
    expect(permanentRedirectMock).toHaveBeenCalledWith("/diagnosis");
  });

  it("preserves a single querystring value", async () => {
    await MarketingDiagnosisRedirectPage({ searchParams: Promise.resolve({ business: "biz-1" }) });
    expect(permanentRedirectMock).toHaveBeenCalledWith("/diagnosis?business=biz-1");
  });

  it("preserves a repeated querystring key as multiple values", async () => {
    await MarketingDiagnosisRedirectPage({ searchParams: Promise.resolve({ tag: ["a", "b"] }) });
    expect(permanentRedirectMock).toHaveBeenCalledWith("/diagnosis?tag=a&tag=b");
  });
});
