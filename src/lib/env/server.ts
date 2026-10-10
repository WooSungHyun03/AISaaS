import "server-only";
import { z } from "zod";

/**
 * Server-only environment variables. Importing "server-only" makes any
 * accidental import from a Client Component fail the build instead of
 * leaking secrets into the browser bundle (Rule 6/7 in TEAM_GUIDE.md).
 *
 * Fields that gate an optional feature (a connector, a specific AI/billing
 * provider) are kept optional here and validated lazily at the call site,
 * so the app can boot without every integration configured.
 */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(1).optional(),

  AI_PROVIDER: z.enum(["mock", "openai", "gemini", "anthropic"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Overrides the selected provider's default model id (e.g. claude-sonnet-5-5) without a deploy of new code.
  AI_MODEL: z.string().min(1).optional(),
  // Bounded request timeout + retry count for real AI providers. Retries are
  // only ever applied to transient failures (timeout/429/5xx/network) — never
  // to auth or validation errors, and never unbounded.
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  BILLING_PROVIDER: z.enum(["mock", "toss"]).default("mock"),
  // The mock provider upgrades a plan with one click and no payment. It is
  // refused in production unless this is explicitly "true" (demo deployments).
  ALLOW_MOCK_BILLING: z.enum(["true", "false"]).optional(),
  TOSS_SECRET_KEY: z.string().optional(),

  WORDPRESS_SITE_URL: z.string().optional(),
  WORDPRESS_USERNAME: z.string().optional(),
  WORDPRESS_APP_PASSWORD: z.string().optional(),
  WORDPRESS_CREDENTIALS_KEY: z.string().optional(),

  META_ACCESS_TOKEN: z.string().optional(),
  META_IG_USER_ID: z.string().optional(),
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),

  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REFRESH_TOKEN: z.string().optional(),

  VIDEO_RENDER_PROVIDER: z.enum(["mock", "json2video"]).default("mock"),
  VIDEO_RENDER_API_KEY: z.string().optional(),

  // Image-to-video service that animates reference characters (src/server/connectors/animation).
  // "mock" never calls the network; "fal" needs FAL_KEY. ANIMATION_MODEL overrides the fal endpoint id.
  ANIMATION_PROVIDER: z.enum(["mock", "fal"]).default("mock"),
  FAL_KEY: z.string().optional(),
  ANIMATION_MODEL: z.string().min(1).optional(),

  // Which backend collects channel diagnosis/growth metrics (src/server/channels).
  // "mock" must never run in production — see instrumentation.ts, which
  // fails the server at boot instead of silently serving fabricated
  // numbers (no diagnosis/snapshot code calls this provider yet in this
  // ticket, so a call-site guard like assertMockBillingAllowed's would
  // never actually run). The default therefore follows the environment:
  // a production deploy that simply forgot this variable runs the real
  // collectors (which report "not configured" without keys, never invented
  // numbers) instead of failing every request at boot; only an explicit
  // CHANNEL_DATA_PROVIDER=mock in production is refused.
  CHANNEL_DATA_PROVIDER: z.enum(["live", "mock"]).default(process.env.NODE_ENV === "production" ? "live" : "mock"),
  // YouTube Data API v3 key (API key only — this is public-data collection,
  // no OAuth/user connection involved, unlike YOUTUBE_CLIENT_ID/SECRET above
  // which belong to the Shorts-publishing connector).
  YOUTUBE_API_KEY: z.string().optional(),
  // Naver Search API (blog.json) — sent as X-Naver-Client-Id/Secret headers.
  // Public-data search, not the blog owner's own credentials.
  NAVER_CLIENT_ID: z.string().optional(),
  NAVER_CLIENT_SECRET: z.string().optional(),

  GITHUB_TOKEN: z.string().optional(),

  // Keys the CS widget's requester IP before it's stored for rate limiting
  // (never the raw IP). Optional locally/in tests so the app can boot
  // without it configured; hashRequesterIp() itself refuses to silently
  // degrade in production (see src/server/customer-support/widget.ts) —
  // checked there, not here, because `next build`'s page-data-collection
  // step runs with NODE_ENV=production too, and a module-load-time check in
  // this file would fail every local production build, not just a real
  // deployment missing the secret.
  SUPPORT_WIDGET_IP_HASH_SECRET: z.string().min(1).optional(),
});

function loadServerEnv() {
  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid server environment variables: ${missing}. Check .env.example.`);
  }

  return parsed.data;
}

export const serverEnv = loadServerEnv();

/**
 * Throws a descriptive error for a required-but-missing env var instead of
 * letting a downstream `undefined` fail with an opaque error later.
 */
export function requireEnv<K extends keyof typeof serverEnv>(key: K): NonNullable<(typeof serverEnv)[K]> {
  const value = serverEnv[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${key}. Set it in .env.local (see .env.example).`);
  }
  return value as NonNullable<(typeof serverEnv)[K]>;
}
