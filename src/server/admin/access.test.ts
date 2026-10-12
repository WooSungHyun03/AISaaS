import type { User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { isAdminUser, requireAdmin } from "./access";

const adminUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.com",
} as User;

function sessionClient(user: User | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  } as never;
}

function adminClient(isMember: boolean) {
  const auditRows: Array<Record<string, unknown>> = [];
  const from = vi.fn((table: string) => {
    if (table === "admin_users") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: isMember ? { user_id: adminUser.id } : null, error: null }),
          }),
        }),
      };
    }
    if (table === "admin_audit_log") {
      return {
        insert: async (row: Record<string, unknown>) => {
          auditRows.push(row);
          return { error: null };
        },
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return { client: { from } as never, auditRows };
}

describe("database-backed admin access", () => {
  it("rejects an unauthenticated direct call before privileged work", async () => {
    await expect(requireAdmin(
      { action: "TEST_ACTION" },
      { sessionClient: sessionClient(null) },
    )).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("reports a membership lookup failure as a server error instead of answering as a non-admin", async () => {
    const failing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error("relation admin_users does not exist") }) }) }) }) } as never;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(requireAdmin({ action: "TEST_ACTION" }, { sessionClient: sessionClient(adminUser), adminClient: failing })).rejects.toThrow("admin_users");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("rejects a signed-in non-admin and records the denied action", async () => {
    const fakeAdmin = adminClient(false);
    await expect(requireAdmin(
      { action: "REFUND_UPDATE", targetType: "refund", targetId: "refund-1" },
      { sessionClient: sessionClient(adminUser), adminClient: fakeAdmin.client },
    )).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(fakeAdmin.auditRows).toEqual([
      expect.objectContaining({
        actor_user_id: adminUser.id,
        action: "ADMIN_ACCESS_DENIED",
        target_type: "refund",
        target_id: "refund-1",
        metadata: { requestedAction: "REFUND_UPDATE" },
      }),
    ]);
  });

  it("returns the server client for a member and audits successful access", async () => {
    const fakeAdmin = adminClient(true);
    const result = await requireAdmin(
      { action: "ADMIN_DASHBOARD_VIEW", targetType: "route", targetId: "/admin" },
      { sessionClient: sessionClient(adminUser), adminClient: fakeAdmin.client },
    );

    expect(result.user).toBe(adminUser);
    expect(result.admin).toBe(fakeAdmin.client);
    expect(fakeAdmin.auditRows[0]).toEqual(expect.objectContaining({ action: "ADMIN_DASHBOARD_VIEW" }));
  });

  it("checks membership by user id", async () => {
    expect(await isAdminUser(adminUser.id, adminClient(true).client)).toBe(true);
    expect(await isAdminUser(adminUser.id, adminClient(false).client)).toBe(false);
    expect(await isAdminUser(null, adminClient(true).client)).toBe(false);
  });
});
