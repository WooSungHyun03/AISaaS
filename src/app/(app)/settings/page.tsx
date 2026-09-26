import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IntegrationSettings, type SafeConnection } from "@/components/settings/integration-settings";
import { ProfileForm } from "@/components/settings/profile-form";

const INSTAGRAM_MESSAGE: Record<string, { tone: string; text: string }> = {
  connected: { tone: "border-emerald-200 bg-emerald-50 text-emerald-800", text: "Instagram Professional 계정을 연결했습니다." },
  denied: { tone: "border-amber-200 bg-amber-50 text-amber-800", text: "Instagram 연결이 취소되었습니다. 권한을 확인하고 다시 시도할 수 있습니다." },
  professional_required: { tone: "border-amber-200 bg-amber-50 text-amber-800", text: "Business 또는 Creator Instagram 계정만 연결할 수 있습니다." },
  state_error: { tone: "border-red-200 bg-red-50 text-red-800", text: "Instagram 연결 요청이 만료되었거나 확인할 수 없습니다. 다시 시도해주세요." },
  invalid_business: { tone: "border-red-200 bg-red-50 text-red-800", text: "연결할 사업체를 확인할 수 없습니다." },
  not_configured: { tone: "border-amber-200 bg-amber-50 text-amber-800", text: "Instagram OAuth 설정이 아직 완료되지 않았습니다. 관리자에게 Meta 앱 설정을 요청해주세요." },
  error: { tone: "border-red-200 bg-red-50 text-red-800", text: "Instagram 계정을 연결하지 못했습니다. 잠시 후 다시 시도해주세요." },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ business?: string; instagram?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: businesses, error: businessError }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("businesses").select("id, name").eq("owner_id", user.id).order("created_at"),
  ]);
  if (businessError) throw new Error("사업체 정보를 불러오지 못했습니다.");
  const selectedBusiness = (businesses ?? []).find((business) => business.id === query.business) ?? businesses?.[0];
  const { data: connections, error: connectionError } = selectedBusiness
    ? await supabase.from("integration_connections")
      .select("id, provider, account_identifier, status, metadata, connected_at, updated_at")
      .eq("user_id", user.id).eq("business_id", selectedBusiness.id)
    : { data: [], error: null };
  if (connectionError) throw new Error("외부 서비스 연결 정보를 불러오지 못했습니다.");
  const instagramMessage = query.instagram ? INSTAGRAM_MESSAGE[query.instagram] : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div><h1 className="text-2xl font-bold tracking-tight">설정</h1><p className="mt-1 text-sm text-muted-foreground">프로필과 자동화에 사용할 외부 서비스 연결을 관리합니다.</p></div>

      {instagramMessage && <div role="status" className={`rounded-lg border p-4 text-sm ${instagramMessage.tone}`}>{instagramMessage.text}</div>}

      <section className="space-y-4">
        <div><h2 className="text-lg font-semibold">외부 서비스 연결</h2><p className="text-sm text-muted-foreground">연결은 사업체별로 관리됩니다. 비밀번호와 토큰은 저장 후 다시 표시하지 않습니다.</p></div>
        {(businesses ?? []).length === 0 ? <Card><CardContent className="space-y-4 py-10 text-center"><p className="text-sm text-muted-foreground">연결을 추가하려면 먼저 사업체를 등록해주세요.</p><Button asChild><Link href="/onboarding">사업체 등록</Link></Button></CardContent></Card> : <>
          <div className="flex flex-wrap gap-2" aria-label="연결을 관리할 사업체">
            {(businesses ?? []).map((business) => <Button key={business.id} asChild size="sm" variant={business.id === selectedBusiness?.id ? "default" : "outline"}><Link href={`/settings?business=${business.id}`}>{business.name}</Link></Button>)}
          </div>
          <IntegrationSettings key={selectedBusiness!.id} businessId={selectedBusiness!.id} connections={(connections ?? []) as SafeConnection[]} />
        </>}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">프로필</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm email={user.email ?? ""} displayName={profile?.display_name ?? null} />
        </CardContent>
      </Card>
    </div>
  );
}
