import { redirect } from "next/navigation";

/** Compatibility route for bookmarks and links created before `/usage`. */
export default async function LegacyAutomationHistoryPage({ searchParams }: PageProps<"/automations/history">) {
  const source = await searchParams;
  const target = new URLSearchParams();
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) value.forEach((item) => target.append(key, item));
    else if (value !== undefined) target.set(key, value);
  }
  const query = target.toString();
  redirect(`/usage${query ? `?${query}` : ""}`);
}
