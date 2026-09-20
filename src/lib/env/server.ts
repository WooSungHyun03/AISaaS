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

  AI_PROVIDER: z.enum(["mock", "openai", "gemini"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),

  BILLING_PROVIDER: z.enum(["mock"]).default("mock"),

  WORDPRESS_SITE_URL: z.string().optional(),
  WORDPRESS_USERNAME: z.string().optional(),
  WORDPRESS_APP_PASSWORD: z.string().optional(),

  META_ACCESS_TOKEN: z.string().optional(),
  META_IG_USER_ID: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),

  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REFRESH_TOKEN: z.string().optional(),

  GITHUB_TOKEN: z.string().optional(),
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
