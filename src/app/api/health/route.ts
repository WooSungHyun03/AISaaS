import { NextResponse } from "next/server";

/**
 * Liveness check for container orchestration (Docker HEALTHCHECK) and
 * uptime monitoring. Deliberately does not touch Supabase or any other
 * external dependency — it only confirms the Next.js server itself is up
 * and serving requests.
 */
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
