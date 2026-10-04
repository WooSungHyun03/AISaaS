/**
 * Shared SSRF address classification, used by every outbound fetch to a
 * user-supplied host (WordPress sites, website marketing diagnosis —
 * src/server/marketing/diagnosis.ts) so they all block the same
 * private/internal ranges instead of each re-deriving its own list.
 */

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true; // malformed -> refuse
  const [a, b, c] = parts;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || // link-local incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 192 && b === 0) || // 192.0.0.0/24 and 192.0.2.0/24
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) // documentation
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase().split("%")[0];
  if (lower === "::" || lower === "::1") return true;

  // IPv4-mapped / -compatible forms (::ffff:a.b.c.d, ::a.b.c.d): judge by the embedded IPv4.
  const embedded = lower.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded && (lower.startsWith("::") || lower.includes(":ffff:"))) return isPrivateIpv4(embedded[1]);
  // Hex form of a mapped address (::ffff:7f00:1) — refuse every mapped address rather than decode it.
  if (lower.startsWith("::ffff:")) return true;

  const firstHextet = parseInt(lower.split(":")[0] || "0", 16);
  if (Number.isNaN(firstHextet)) return true;
  return (
    (firstHextet & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (firstHextet & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (firstHextet & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated)
    (firstHextet & 0xff00) === 0xff00 || // multicast
    firstHextet === 0x0064 || // 64:ff9b::/96 NAT64 and 100::/64 discard
    firstHextet === 0x0100 ||
    firstHextet === 0x2002 || // 6to4 embeds an arbitrary IPv4
    (firstHextet === 0x2001 && (lower.startsWith("2001:0:") || lower.startsWith("2001:0000:") || lower.startsWith("2001:db8:"))) // Teredo, documentation
  );
}

export function isPrivateAddress(address: string): boolean {
  return address.includes(":") ? isPrivateIpv6(address) : isPrivateIpv4(address);
}

/**
 * A `lookup` for http(s).request that always answers with an address that was
 * already validated, so a second DNS lookup between "checked" and "connected"
 * (DNS rebinding) can never reach a private host.
 *
 * Node 20+ calls `lookup` with `{ all: true }` (happy-eyeballs / autoSelectFamily)
 * and then requires the array form of the callback; answering with the
 * single-address form there fails every request with ERR_INVALID_IP_ADDRESS.
 * Both forms are therefore handled.
 */
export function pinnedLookup(address: string, family: number) {
  return (
    _hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: (error: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void,
  ): void => {
    if (typeof options === "object" && options !== null && options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}
