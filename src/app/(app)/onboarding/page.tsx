import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BusinessOnboardingWizard } from "@/components/business/business-onboarding-wizard";

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const { next } = await searchParams;
  const destination = typeof next === "string" && /^\/billing\?plan=(STARTER|PRO)$/.test(next)
    ? next
    : "/automations/marketplace";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent("/onboarding")}`);

  const { data: business, error } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error("사업체 정보를 불러오지 못했습니다.");
  if (business) redirect(destination);

  return <BusinessOnboardingWizard destination={destination} />;
}
