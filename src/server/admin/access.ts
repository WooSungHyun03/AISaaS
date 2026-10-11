import "server-only";
import { serverEnv } from "@/lib/env/server";

/** The service team's emails from ADMIN_EMAILS, lower-cased. Empty when unset: nobody is an admin. */
export function adminEmails(raw: string | undefined = serverEnv.ADMIN_EMAILS): string[] {
  return (raw ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
}

/**
 * Admin = a signed-in user whose confirmed email is on the ADMIN_EMAILS list. The check is on the server for every
 * admin page and action; being on a list a customer cannot edit is what makes the service-role writes behind it safe.
 */
export function isAdminUser(user: { email?: string | null; email_confirmed_at?: string | null } | null | undefined, allowed: string[] = adminEmails()): boolean {
  if (!user?.email || !user.email_confirmed_at) return false;
  return allowed.includes(user.email.trim().toLowerCase());
}
