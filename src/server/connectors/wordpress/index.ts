import "server-only";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { serverEnv } from "@/lib/env/server";
import { ConnectorError } from "@/server/shared/errors";
import type { PlatformConnector, PublishContentParams, PublishResult } from "../types";

export interface WordPressConnection {
  siteUrl: string;
  username: string;
  appPassword: string;
}

export function normalizeWordPressSiteUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ConnectorError("wordpress", "INVALID_TARGET", "WordPress 사이트 주소가 올바르지 않습니다.");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" || url.port || url.username || url.password ||
    url.search || url.hash || !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(url.pathname) || isIP(host) ||
    host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")
  ) {
    throw new ConnectorError("wordpress", "INVALID_TARGET", "공개 HTTPS WordPress 사이트의 기본 주소를 입력해주세요. 예: https://example.com");
  }
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

function isPrivateAddress(address: string): boolean {
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

async function publicHostAddress(siteUrl: string): Promise<{ address: string; family: number }> {
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(new URL(siteUrl).hostname, { all: true });
  } catch (cause) {
    throw new ConnectorError("wordpress", "INVALID_TARGET", "WordPress 사이트 주소를 확인할 수 없습니다 (DNS 조회 실패).", { cause });
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new ConnectorError("wordpress", "INVALID_TARGET", "공개 인터넷에서 접속 가능한 WordPress 주소를 입력해주세요.");
  }
  return addresses[0];
}

/** Classifies an HTTP failure into the shared connector error taxonomy. */
function classifyHttpStatus(status: number): "AUTH_FAILED" | "PERMISSION_DENIED" | "UPSTREAM_SERVER_ERROR" | "UPSTREAM_CLIENT_ERROR" {
  if (status === 401) return "AUTH_FAILED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status >= 500) return "UPSTREAM_SERVER_ERROR";
  return "UPSTREAM_CLIENT_ERROR";
}

/** WordPress REST API connector using an Application Password. */
export class WordPressConnector implements PlatformConnector {
  readonly name = "wordpress";

  constructor(private readonly connection?: WordPressConnection) {}

  isConfigured(): boolean {
    if (this.connection) return Boolean(this.connection.siteUrl && this.connection.username && this.connection.appPassword);
    return Boolean(serverEnv.WORDPRESS_SITE_URL && serverEnv.WORDPRESS_USERNAME && serverEnv.WORDPRESS_APP_PASSWORD);
  }

  private credentials(): WordPressConnection {
    if (this.connection) return this.connection;
    if (!this.isConfigured()) throw new ConnectorError("wordpress", "NOT_CONFIGURED", "WordPress 연결이 설정되지 않았습니다.");
    return {
      siteUrl: serverEnv.WORDPRESS_SITE_URL!,
      username: serverEnv.WORDPRESS_USERNAME!,
      appPassword: serverEnv.WORDPRESS_APP_PASSWORD!,
    };
  }

  private async request(path: string, body?: object): Promise<Response> {
    const { siteUrl, username, appPassword } = this.credentials();
    const baseUrl = normalizeWordPressSiteUrl(siteUrl);
    const selected = await publicHostAddress(baseUrl);
    // Pin the validated address for the actual TLS request. A second DNS lookup
    // between validation and connection could otherwise reach a private host.
    return new Promise<Response>((resolve, reject) => {
      // Distinguishes the timeout case from a generic network failure: both
      // land on the same `request`/`response` "error" events below, but only
      // one of them should classify as ConnectorError "TIMEOUT".
      let timedOut = false;
      const request = httpsRequest(`${baseUrl}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
      }, (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1_000_000) {
            response.destroy(new Error("WordPress 응답이 너무 큽니다."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", (cause) => {
          reject(new ConnectorError("wordpress", "NETWORK_FAILURE", "WordPress 응답을 읽는 중 오류가 발생했습니다.", { cause }));
        });
        response.on("end", () => {
          const status = response.statusCode ?? 500;
          resolve(new Response(status === 204 ? null : Buffer.concat(chunks), { status }));
        });
      });
      request.setTimeout(12_000, () => {
        timedOut = true;
        request.destroy(new Error("WordPress 요청 시간이 초과되었습니다."));
      });
      request.on("error", (cause) => {
        reject(
          timedOut
            ? new ConnectorError("wordpress", "TIMEOUT", "WordPress 요청 시간이 초과되었습니다.", { cause })
            : new ConnectorError("wordpress", "NETWORK_FAILURE", "WordPress 서버에 연결하지 못했습니다.", { cause }),
        );
      });
      if (body) request.write(JSON.stringify(body));
      request.end();
    });
  }

  async testConnection(): Promise<void> {
    const response = await this.request("/wp-json/wp/v2/users/me");
    if (!response.ok) {
      throw new ConnectorError(
        "wordpress",
        classifyHttpStatus(response.status),
        `WordPress 연결을 확인할 수 없습니다 (HTTP ${response.status}). 사이트 주소와 Application Password를 확인해주세요.`,
      );
    }
  }

  async publish({ title, content, excerpt }: PublishContentParams, status: "draft" | "publish" = "publish"): Promise<PublishResult> {
    const response = await this.request("/wp-json/wp/v2/posts", { title, content, status, ...(excerpt ? { excerpt } : {}) });
    if (!response.ok) {
      throw new ConnectorError(
        "wordpress",
        classifyHttpStatus(response.status),
        `WordPress에 글을 저장하지 못했습니다 (HTTP ${response.status}). 연결과 글 발행 권한을 확인해주세요.`,
      );
    }
    const data = (await response.json()) as { link?: string; id?: number };
    let externalUrl: string | undefined;
    if (data.link) {
      try {
        const url = new URL(data.link);
        if (url.protocol === "https:" || url.protocol === "http:") externalUrl = url.toString();
      } catch { /* WordPress may omit a public link for a draft. */ }
    }
    return { externalUrl, externalId: data.id ? String(data.id) : undefined };
  }
}
