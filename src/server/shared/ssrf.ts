/**
 * Shared SSRF address classification, extracted from the WordPress connector
 * (src/server/connectors/wordpress/index.ts) so every outbound fetch to a
 * user-supplied host (WordPress sites, website marketing diagnosis —
 * src/server/marketing/diagnosis.ts) blocks the same private/internal
 * ranges instead of each caller re-deriving its own list. Moved verbatim —
 * WordPress's behavior is unchanged by this extraction.
 */
export function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    const lower = address.toLowerCase();
    return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") ||
      lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") ||
      lower.startsWith("feb") || lower.startsWith("::ffff:");
  }
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}
