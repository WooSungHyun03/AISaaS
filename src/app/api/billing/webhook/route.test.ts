import { afterEach, describe, expect, it, vi } from "vitest";

const { handleWebhookMock } = vi.hoisted(() => ({ handleWebhookMock: vi.fn() }));
vi.mock("@/server/billing", () => ({ getBillingProvider: () => ({ handleWebhook: handleWebhookMock }) }));

const { POST } = await import("./route");

afterEach(() => vi.clearAllMocks());

describe("POST /api/billing/webhook", () => {
  it("hands a normal payload to the provider", async () => {
    handleWebhookMock.mockResolvedValue(undefined);
    const response = await POST(new Request("http://localhost/api/billing/webhook", { method: "POST", body: '{"ok":true}' }));
    expect(response.status).toBe(200);
    expect(handleWebhookMock).toHaveBeenCalledOnce();
  });

  it("rejects oversized bodies before the provider sees them", async () => {
    const big = "x".repeat(300 * 1024);
    const response = await POST(new Request("http://localhost/api/billing/webhook", { method: "POST", body: big }));
    expect(response.status).toBe(413);
    expect(handleWebhookMock).not.toHaveBeenCalled();
  });

  it("does not leak internal error text to the caller", async () => {
    handleWebhookMock.mockRejectedValue(new Error("secret internal detail: table billing_checkout_sessions"));
    const response = await POST(new Request("http://localhost/api/billing/webhook", { method: "POST", body: "{}" }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("secret internal detail");
  });
});
