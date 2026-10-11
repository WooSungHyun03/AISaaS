import "server-only";

import { notFound, redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";
import { recordAdminAudit, type AdminAuditEvent } from "./audit";

type AdminClient = SupabaseClient<Database>;
type SessionClient = Pick<SupabaseClient<Database>, "auth">;

export class AdminAccessError extends Error {
  constructor(public readonly code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code === "UNAUTHENTICATED" ? "로그인이 필요합니다." : "관리자 권한이 없습니다.");
    this.name = "AdminAccessError";
  }
}

interface RequireAdminOptions extends AdminAuditEvent {
  onDenied?: "throw" | "navigate";
  redirectTo?: string;
}

interface RequireAdminDependencies {
  sessionClient?: SessionClient;
  adminClient?: AdminClient;
}

export async function isAdminUser(userId: string | null | undefined, admin: AdminClient = createAdminClient()) {
  if (!userId) return false;
  const { data, error } = await admin.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

function deny(error: AdminAccessError, options: RequireAdminOptions): never {
  if (options.onDenied !== "navigate") throw error;
  if (error.code === "UNAUTHENTICATED") {
    redirect(`/login?${new URLSearchParams({ redirectTo: options.redirectTo ?? "/admin" })}`);
  }
  notFound();
}

/**
 * Mandatory server-side administrator gate. Successful access and signed-in
 * denials are audited. Call this before privileged reads or parsing a Server
 * Action payload.
 */
export async function requireAdmin(
  options: RequireAdminOptions = { action: "ADMIN_ACCESS" },
  dependencies: RequireAdminDependencies = {},
): Promise<{ user: User; admin: AdminClient }> {
  const sessionClient = dependencies.sessionClient ?? await createClient();
  const { data: { user }, error: authError } = await sessionClient.auth.getUser();
  if (authError || !user) return deny(new AdminAccessError("UNAUTHENTICATED"), options);

  const admin = dependencies.adminClient ?? createAdminClient();
  const allowed = await isAdminUser(user.id, admin);
  if (!allowed) {
    await recordAdminAudit(admin, user, {
      action: "ADMIN_ACCESS_DENIED",
      targetType: options.targetType,
      targetId: options.targetId,
      metadata: { requestedAction: options.action },
    });
    return deny(new AdminAccessError("FORBIDDEN"), options);
  }

  await recordAdminAudit(admin, user, options);
  return { user, admin };
}
