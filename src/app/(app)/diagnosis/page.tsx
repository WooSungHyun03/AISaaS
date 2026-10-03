import { redirect } from "next/navigation";

/**
 * /diagnosis merged into /marketing/diagnosis (the one page that now does
 * both the static profile/connection checklist AND the AI website
 * diagnosis + Business Profile prefill). Kept as a redirect, not deleted
 * outright, so any old link/bookmark to /diagnosis still lands somewhere
 * useful instead of 404ing.
 */
export default async function DiagnosisPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const query = await searchParams;
  const destination = query.business ? `/marketing/diagnosis?business=${encodeURIComponent(query.business)}` : "/marketing/diagnosis";
  redirect(destination);
}
