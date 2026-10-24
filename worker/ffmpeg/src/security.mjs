import dns from "node:dns/promises";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { pipeline } from "node:stream/promises";
import { timingSafeEqual } from "node:crypto";

/** True for loopback, private, link-local, carrier-grade NAT, multicast, reserved and unique-local addresses. */
export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    if (value === "::" || value === "::1") return true;
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^f[cd]/.test(value) || /^fe[89ab]/.test(value) || value.startsWith("ff");
  }
  return true;
}

export function hostAllowed(hostname, config) {
  const host = hostname.toLowerCase();
  return config.allowedHosts.some((rule) => (rule.startsWith(".") ? host.endsWith(rule) && host.length > rule.length : host === rule));
}

export function tokenMatches(header, token) {
  const given = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Checks a URL the worker is asked to download from or upload to and resolves it ONCE. The returned address is the one
 * the connection is pinned to, so a DNS answer that changes between the check and the connection (DNS rebinding) cannot
 * redirect the worker to an internal address. Throws a plain Error with a safe message.
 */
export async function resolveSafeUrl(rawUrl, config) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid url");
  }
  const local = config.allowLocal && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("only https urls are allowed");
  if (url.username || url.password) throw new Error("urls with credentials are not allowed");
  if (!local && !hostAllowed(url.hostname, config)) throw new Error("host is not allowed");
  if (local) return { url, address: "127.0.0.1", family: 4 };
  if (net.isIP(url.hostname)) throw new Error("ip addresses are not allowed");
  const records = await dns.lookup(url.hostname, { all: true });
  if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) throw new Error("host resolves to a private address");
  return { url, address: records[0].address, family: records[0].family };
}

/**
 * A `lookup` for net.connect that always answers with the one address that passed the safety check. Node 20+ connects
 * with `autoSelectFamily` and calls lookup with `{ all: true }`, which wants an ARRAY of addresses: answering with a plain
 * string fails with "Invalid IP address: undefined", so every https download and upload failed on a hosted worker (a
 * local http test never reaches this path). Both call styles are answered.
 */
export function pinnedLookup(address, family) {
  return (_host, options, callback) => {
    if (options && typeof options === "object" && options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function requestOptions(target, method, extraHeaders = {}) {
  const lib = target.url.protocol === "https:" ? https : http;
  return {
    lib,
    options: {
      method,
      hostname: target.url.hostname,
      port: target.url.port || (target.url.protocol === "https:" ? 443 : 80),
      path: `${target.url.pathname}${target.url.search}`,
      headers: extraHeaders,
      // Pin the connection to the address that passed the check.
      lookup: pinnedLookup(target.address, target.family),
      servername: net.isIP(target.url.hostname) ? undefined : target.url.hostname,
    },
  };
}

/** Streams a url to a file. No redirects, size and time limits. */
export async function downloadToFile(rawUrl, destination, config) {
  const target = await resolveSafeUrl(rawUrl, config);
  const { lib, options } = requestOptions(target, "GET");
  await new Promise((resolve, reject) => {
    const request = lib.request(options, async (response) => {
      try {
        if (response.statusCode !== 200) throw new Error(`download failed with status ${response.statusCode}`);
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > config.maxDownloadBytes) throw new Error("file is too large");
        let received = 0;
        response.on("data", (chunk) => {
          received += chunk.length;
          if (received > config.maxDownloadBytes) response.destroy(new Error("file is too large"));
        });
        await pipeline(response, fs.createWriteStream(destination, { mode: 0o600 }));
        resolve(received);
      } catch (error) {
        response.resume();
        reject(error);
      }
    });
    request.setTimeout(config.downloadTimeoutMs, () => request.destroy(new Error("download timed out")));
    request.on("error", reject);
    request.end();
  });
}

/** PUTs a file to a signed upload url. */
export async function uploadFile(rawUrl, filePath, contentType, config) {
  const target = await resolveSafeUrl(rawUrl, config);
  const size = fs.statSync(filePath).size;
  if (size > config.maxUploadBytes) throw new Error("output is too large");
  const { lib, options } = requestOptions(target, "PUT", { "content-type": contentType, "content-length": size, "x-upsert": "true" });
  await new Promise((resolve, reject) => {
    const request = lib.request(options, (response) => {
      response.resume();
      response.on("end", () => (response.statusCode >= 200 && response.statusCode < 300 ? resolve() : reject(new Error(`upload failed with status ${response.statusCode}`))));
    });
    request.setTimeout(config.downloadTimeoutMs, () => request.destroy(new Error("upload timed out")));
    request.on("error", reject);
    fs.createReadStream(filePath).pipe(request);
  });
  return size;
}
