import { z } from "zod";

/**
 * Env vars that are safe to bundle into the browser. Only NEXT_PUBLIC_*
 * variables belong here — anything else must live in `env/server.ts`.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_TOSS_CLIENT_KEY: z.string().optional(),
});

function loadClientEnv() {
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_TOSS_CLIENT_KEY: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
  });

  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(
      `Missing or invalid public environment variables: ${missing}. Copy .env.example to .env.local and fill in real values.`,
    );
  }

  return parsed.data;
}

export const clientEnv = loadClientEnv();
