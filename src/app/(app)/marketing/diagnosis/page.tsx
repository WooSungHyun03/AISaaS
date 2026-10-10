import { permanentRedirect } from "next/navigation";

/**
 * /marketing/diagnosis moved to /diagnosis (ticket 1-5 — the two routes
 * had swapped roles before this: /diagnosis used to redirect here). Kept
 * as a permanent (308) redirect, querystring preserved, so an old
 * link/bookmark still lands somewhere useful instead of 404ing.
 */
export default async function MarketingDiagnosisRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else if (value !== undefined) {
      params.append(key, value);
    }
  }
  const queryString = params.toString();
  permanentRedirect(queryString ? `/diagnosis?${queryString}` : "/diagnosis");
}
