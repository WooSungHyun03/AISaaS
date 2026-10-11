import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";

type AdminClient = SupabaseClient<Database>;

export interface AdminAuditEvent {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, Json | undefined>;
}

export interface AdminAuditActor {
  id: string;
  email?: string | null;
}

/** Append one security event. Metadata must contain identifiers/state only, never content or credentials. */
export async function recordAdminAudit(admin: AdminClient, actor: AdminAuditActor | null, event: AdminAuditEvent) {
  const metadata = Object.fromEntries(Object.entries(event.metadata ?? {}).filter((entry): entry is [string, Json] => entry[1] !== undefined));
  const { error } = await admin.from("admin_audit_log").insert({
    actor_user_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    action: event.action,
    target_type: event.targetType ?? null,
    target_id: event.targetId ?? null,
    metadata,
  });
  if (error) throw error;
}

