import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createConnection, getConnection, getConnectionSecret, updateConnectionStatus } from "@/server/connectors/integrations";
import type { Database } from "@/types/database.types";
import { YouTubeConnector } from "./index";
import { buildYouTubeAuthorizationUrl, exchangeYouTubeCode, getYouTubeChannel } from "./oauth";

type DbClient = SupabaseClient<Database>;

export interface YouTubeOAuthCookie {
  state: string;
  businessId: string;
}

export function startYouTubeOAuth(params: {
  clientId: string;
  redirectUri: string;
  businessId: string;
}): { authorizationUrl: string; cookieValue: string } {
  const state = randomBytes(24).toString("base64url");
  const authorizationUrl = buildYouTubeAuthorizationUrl({ clientId: params.clientId, redirectUri: params.redirectUri, state });
  const cookieValue = Buffer.from(JSON.stringify({ state, businessId: params.businessId } satisfies YouTubeOAuthCookie)).toString("base64url");
  return { authorizationUrl, cookieValue };
}

export function parseYouTubeOAuthCookie(value: string | undefined): YouTubeOAuthCookie | null {
  try {
    const parsed = JSON.parse(Buffer.from(value ?? "", "base64url").toString("utf8")) as Partial<YouTubeOAuthCookie>;
    return parsed.state && parsed.businessId ? { state: parsed.state, businessId: parsed.businessId } : null;
  } catch {
    return null;
  }
}

export function isMatchingYouTubeOAuthState(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type YouTubeOAuthOutcome = "connected" | "error";

export async function completeYouTubeOAuth(
  params: { userId: string; businessId: string; clientId: string; clientSecret: string; redirectUri: string; code: string },
  admin: DbClient = createAdminClient(),
): Promise<YouTubeOAuthOutcome> {
  try {
    const token = await exchangeYouTubeCode(params);
    const channel = await getYouTubeChannel(token.accessToken);
    await createConnection(
      {
        userId: params.userId,
        businessId: params.businessId,
        provider: "youtube",
        accountIdentifier: channel.title,
        secret: token.refreshToken,
        metadata: {
          channelId: channel.id,
          scope: token.scope,
          privacyStatus: "private",
        },
      },
      admin,
    );
    return "connected";
  } catch {
    await markYouTubeConnectionError(admin, params.userId, params.businessId);
    return "error";
  }
}

export async function loadYouTubeConnector(
  admin: DbClient,
  userId: string,
  businessId: string,
): Promise<YouTubeConnector | null> {
  const connection = await getConnection(admin, userId, businessId, "youtube");
  if (!connection || connection.status !== "CONNECTED") return null;
  const refreshToken = await getConnectionSecret(admin, connection);
  if (!refreshToken || !serverEnv.YOUTUBE_CLIENT_ID || !serverEnv.YOUTUBE_CLIENT_SECRET) return null;
  return new YouTubeConnector({
    clientId: serverEnv.YOUTUBE_CLIENT_ID,
    clientSecret: serverEnv.YOUTUBE_CLIENT_SECRET,
    refreshToken,
  });
}

async function markYouTubeConnectionError(admin: DbClient, userId: string, businessId: string): Promise<void> {
  try {
    const connection = await getConnection(admin, userId, businessId, "youtube");
    if (connection) await updateConnectionStatus(admin, connection.id, "ERROR");
  } catch {
    /* The OAuth result remains the source of truth when status persistence fails. */
  }
}
