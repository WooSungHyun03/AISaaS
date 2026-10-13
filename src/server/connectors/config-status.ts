import "server-only";
import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";
import { YOUTUBE_OAUTH_SCOPES } from "@/lib/youtube-scopes";

export type OAuthProvider = "youtube";

export interface IntegrationConfigStatus {
  /** All OAuth credentials are present, so the connect button can start a real sign-in. */
  configured: boolean;
  /** Names (never values) of the missing environment variables. */
  missing: string[];
  /** The exact redirect URI to register in the provider's console. */
  redirectUri: string;
  scopes: string[];
}

function status(provider: OAuthProvider, required: Record<string, string | undefined>, scopes: string[]): IntegrationConfigStatus {
  return {
    configured: Object.values(required).every(Boolean),
    missing: Object.entries(required).filter(([, value]) => !value).map(([name]) => name),
    redirectUri: new URL(`/api/integrations/${provider}/callback`, clientEnv.NEXT_PUBLIC_SITE_URL).toString(),
    scopes,
  };
}

/** Whether the YouTube (Google OAuth) app is set up on this deployment — used to disable the connect buttons honestly. */
export function getIntegrationConfigStatus(): Record<OAuthProvider, IntegrationConfigStatus> {
  return {
    youtube: status("youtube", { YOUTUBE_CLIENT_ID: serverEnv.YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET: serverEnv.YOUTUBE_CLIENT_SECRET }, [...YOUTUBE_OAUTH_SCOPES]),
  };
}
