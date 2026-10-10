/** Routes that need a signed-in user. Matched on a path-segment boundary. */
export const PROTECTED_PREFIXES = [
  "/dashboard", "/diagnosis", "/calendar", "/marketing", "/blog", "/shorts", "/growth-report",
  "/usage", "/support", "/admin", "/automations", "/business", "/onboarding", "/billing", "/settings", "/setup-request",
  "/reset-password",
];

/** Pages a signed-in user is bounced away from (to the dashboard). */
export const AUTH_PREFIXES = ["/login", "/signup", "/forgot-password"];

/**
 * Set by /auth/callback after a password-recovery link is exchanged. Only then
 * may /reset-password change the password without the current one — a merely
 * stolen session cookie can't mint it.
 */
export const RECOVERY_COOKIE = "em_pw_recovery";
export const RECOVERY_PATH = "/reset-password";

/** "/settings" matches "/settings" and "/settings/x", but not "/settings-old". */
export function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
