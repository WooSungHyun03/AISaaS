import { redirect } from "next/navigation";

export default async function LegacyMarketingCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; business?: string }>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();
  if (query.month) params.set("month", query.month);
  if (query.business) params.set("business", query.business);
  redirect(params.size ? `/calendar?${params.toString()}` : "/calendar");
}
