/**
 * Accepts only same-site absolute paths for post-login redirects. Rejects
 * protocol-relative ("//host"), backslash tricks and — importantly — control
 * characters: browsers strip tabs/newlines from URLs, so "/\t/evil.com" would
 * otherwise become "//evil.com".
 */
export function safeRedirectPath(value: string, fallback = "/dashboard"): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
