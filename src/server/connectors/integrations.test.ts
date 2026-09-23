import { describe, expect, it, vi } from "vitest";
import {
  createConnection,
  disconnectConnection,
  getConnection,
  getConnectionSecret,
  updateConnectionStatus,
} from "./integrations";

/**
 * A minimal stand-in for the Supabase query builder: every builder method
 * returns the same chainable object, and the object itself is awaitable
 * (thenable) so a chain that never calls `.single()`/`.maybeSingle()`
 * (e.g. `.update(...).eq(...)`) still resolves like the real client does.
 */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  };
  return builder;
}

function makeAdmin() {
  return { from: vi.fn(), rpc: vi.fn() };
}

const CONNECTION_ROW = {
  id: "conn-1",
  user_id: "user-1",
  business_id: "biz-1",
  provider: "wordpress" as const,
  account_identifier: "https://example.com",
  status: "CONNECTED" as const,
  secret_reference: "secret-1",
  metadata: {},
  connected_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("createConnection", () => {
  it("stores the secret in Vault and only writes its reference id to the row", async () => {
    const admin = makeAdmin();
    const noExisting = makeBuilder({ data: null, error: null });
    const savedRow = { ...CONNECTION_ROW, secret_reference: "new-secret-id" };
    const upserted = makeBuilder({ data: savedRow, error: null });
    admin.from.mockReturnValueOnce(noExisting).mockReturnValueOnce(upserted);
    admin.rpc.mockResolvedValueOnce({ data: "new-secret-id", error: null });

    const result = await createConnection(
      {
        userId: "user-1",
        businessId: "biz-1",
        provider: "wordpress",
        accountIdentifier: "https://example.com",
        secret: "app-password-in-plaintext",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin as any,
    );

    expect(admin.rpc).toHaveBeenCalledWith("integration_secret_create", {
      p_secret: "app-password-in-plaintext",
      p_name: "wordpress:biz-1",
    });
    const upsertedRow = (upserted.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upsertedRow.secret_reference).toBe("new-secret-id");
    expect(JSON.stringify(upsertedRow)).not.toContain("app-password-in-plaintext");
    expect(result).toEqual(savedRow);
  });

  it("rotates the existing Vault secret instead of creating a new one when reconnecting", async () => {
    const admin = makeAdmin();
    const existing = makeBuilder({ data: CONNECTION_ROW, error: null });
    const upserted = makeBuilder({ data: CONNECTION_ROW, error: null });
    admin.from.mockReturnValueOnce(existing).mockReturnValueOnce(upserted);
    admin.rpc.mockResolvedValueOnce({ data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createConnection({ userId: "user-1", businessId: "biz-1", provider: "wordpress", secret: "rotated" }, admin as any);

    expect(admin.rpc).toHaveBeenCalledWith("integration_secret_update", { p_id: "secret-1", p_secret: "rotated" });
    expect(admin.rpc).not.toHaveBeenCalledWith("integration_secret_create", expect.anything());
  });

  it("never calls Vault for a provider connection created without a secret", async () => {
    const admin = makeAdmin();
    const noExisting = makeBuilder({ data: null, error: null });
    const savedRow = { ...CONNECTION_ROW, secret_reference: null };
    const upserted = makeBuilder({ data: savedRow, error: null });
    admin.from.mockReturnValueOnce(noExisting).mockReturnValueOnce(upserted);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createConnection({ userId: "user-1", businessId: "biz-1", provider: "instagram" }, admin as any);

    expect(admin.rpc).not.toHaveBeenCalled();
    const upsertedRow = (upserted.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upsertedRow.secret_reference).toBeNull();
  });

  it("propagates the underlying error instead of returning a connection when Vault storage fails", async () => {
    const admin = makeAdmin();
    admin.from.mockReturnValueOnce(makeBuilder({ data: null, error: null }));
    admin.rpc.mockResolvedValueOnce({ data: null, error: { message: "vault unavailable" } });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createConnection({ userId: "user-1", businessId: "biz-1", provider: "wordpress", secret: "x" }, admin as any),
    ).rejects.toThrow(/vault unavailable/);
  });
});

describe("getConnection", () => {
  it("scopes the lookup to user, business, and provider", async () => {
    const admin = makeAdmin();
    const builder = makeBuilder({ data: CONNECTION_ROW, error: null });
    admin.from.mockReturnValueOnce(builder);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getConnection(admin as any, "user-1", "biz-1", "wordpress");

    expect(admin.from).toHaveBeenCalledWith("integration_connections");
    expect(builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(builder.eq).toHaveBeenCalledWith("business_id", "biz-1");
    expect(builder.eq).toHaveBeenCalledWith("provider", "wordpress");
    expect(result).toEqual(CONNECTION_ROW);
  });

  it("returns null when no connection exists, without throwing", async () => {
    const admin = makeAdmin();
    admin.from.mockReturnValueOnce(makeBuilder({ data: null, error: null }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getConnection(admin as any, "user-1", "biz-1", "wordpress");
    expect(result).toBeNull();
  });
});

describe("getConnectionSecret", () => {
  it("returns null without calling Vault when the connection has no secret", async () => {
    const admin = makeAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getConnectionSecret(admin as any, { secret_reference: null });
    expect(result).toBeNull();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("decrypts through the Vault-backed RPC when a secret reference exists", async () => {
    const admin = makeAdmin();
    admin.rpc.mockResolvedValueOnce({ data: "decrypted-app-password", error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getConnectionSecret(admin as any, { secret_reference: "secret-1" });

    expect(admin.rpc).toHaveBeenCalledWith("integration_secret_read", { p_id: "secret-1" });
    expect(result).toBe("decrypted-app-password");
  });
});

describe("updateConnectionStatus", () => {
  it("writes the new status (and metadata, when given) scoped by connection id", async () => {
    const admin = makeAdmin();
    const builder = makeBuilder({ data: null, error: null });
    admin.from.mockReturnValueOnce(builder);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateConnectionStatus(admin as any, "conn-1", "ERROR", { lastError: "401" });

    expect(builder.update).toHaveBeenCalledWith({ status: "ERROR", metadata: { lastError: "401" } });
    expect(builder.eq).toHaveBeenCalledWith("id", "conn-1");
  });
});

describe("disconnectConnection", () => {
  it("deletes the paired Vault secret and marks the row DISCONNECTED", async () => {
    const admin = makeAdmin();
    const fetch = makeBuilder({ data: { secret_reference: "secret-1" }, error: null });
    const update = makeBuilder({ data: null, error: null });
    admin.from.mockReturnValueOnce(fetch).mockReturnValueOnce(update);
    admin.rpc.mockResolvedValueOnce({ data: null, error: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await disconnectConnection(admin as any, "conn-1");

    expect(admin.rpc).toHaveBeenCalledWith("integration_secret_delete", { p_id: "secret-1" });
    expect(update.update).toHaveBeenCalledWith({ status: "DISCONNECTED", secret_reference: null });
  });

  it("skips the Vault call for a connection that never had a secret", async () => {
    const admin = makeAdmin();
    const fetch = makeBuilder({ data: { secret_reference: null }, error: null });
    const update = makeBuilder({ data: null, error: null });
    admin.from.mockReturnValueOnce(fetch).mockReturnValueOnce(update);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await disconnectConnection(admin as any, "conn-1");

    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("no-ops when the connection doesn't exist", async () => {
    const admin = makeAdmin();
    admin.from.mockReturnValueOnce(makeBuilder({ data: null, error: null }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await disconnectConnection(admin as any, "missing");

    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.from).toHaveBeenCalledTimes(1);
  });
});
