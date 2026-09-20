import "server-only";
import { serverEnv } from "@/lib/env/server";
import type { PlatformConnector, PublishContentParams, PublishResult } from "../types";

/**
 * Publishes via the WordPress REST API using an Application Password
 * (WordPress 5.6+, no plugin required). This is the one connector with a
 * real implementation — used by the Blog Marketing vertical slice — the
 * rest are interface-only placeholders until a team member picks them up.
 */
export class WordPressConnector implements PlatformConnector {
  readonly name = "wordpress";

  isConfigured(): boolean {
    return Boolean(
      serverEnv.WORDPRESS_SITE_URL && serverEnv.WORDPRESS_USERNAME && serverEnv.WORDPRESS_APP_PASSWORD,
    );
  }

  async publish({ title, content }: PublishContentParams): Promise<PublishResult> {
    if (!this.isConfigured()) {
      throw new Error("WordPress connector is not configured (WORDPRESS_SITE_URL / WORDPRESS_USERNAME / WORDPRESS_APP_PASSWORD).");
    }

    const siteUrl = serverEnv.WORDPRESS_SITE_URL!.replace(/\/$/, "");
    const auth = Buffer.from(`${serverEnv.WORDPRESS_USERNAME}:${serverEnv.WORDPRESS_APP_PASSWORD}`).toString("base64");

    const response = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ title, content, status: "publish" }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WordPress publish failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { link: string; id: number };
    return { externalUrl: data.link, externalId: String(data.id) };
  }
}
