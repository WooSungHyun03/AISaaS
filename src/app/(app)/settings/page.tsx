import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/layout/page-header";
import { IntegrationSettings, type SafeConnection } from "@/components/settings/integration-settings";
import { ProfileForm } from "@/components/settings/profile-form";
import { EmptyState } from "@/components/ui/page-state";

const INSTAGRAM_MESSAGE: Record<string, { variant: "success" | "info" | "error"; text: string }> = {
  connected: { variant: "success", text: "인스타그램 계정을 연결했어요." },
  denied: { variant: "info", text: "인스타그램 연결을 취소했어요. 권한을 확인하고 다시 시도할 수 있어요." },
  professional_required: { variant: "info", text: "비즈니스 또는 크리에이터 계정만 연결할 수 있어요." },
  state_error: { variant: "error", text: "연결 요청이 만료됐거나 확인할 수 없어요. 다시 시도해주세요." },
  invalid_business: { variant: "error", text: "연결할 사업체를 확인할 수 없어요." },
  not_configured: { variant: "info", text: "인스타그램 연동 설정이 아직 끝나지 않았어요. 관리자에게 Meta 앱 설정을 요청해주세요." },
  error: { variant: "error", text: "인스타그램 계정을 연결하지 못했어요. 잠시 후 다시 시도해주세요." },
};

const YOUTUBE_MESSAGE: Record<string, { variant: "success" | "info" | "error"; text: string }> = {
  connected: { variant: "success", text: "YouTube 채널을 연결했어요. 현재 비공개로만 업로드됩니다." },
  denied: { variant: "info", text: "YouTube 연결을 취소했어요. 권한을 확인하고 다시 시도할 수 있어요." },
  state_error: { variant: "error", text: "YouTube 연결 요청이 만료됐거나 확인할 수 없어요. 다시 시도해주세요." },
  invalid_business: { variant: "error", text: "연결할 사업체를 확인할 수 없어요." },
  not_configured: { variant: "info", text: "YouTube 연동 설정이 아직 끝나지 않았어요. 관리자에게 Google OAuth 설정을 요청해주세요." },
  error: { variant: "error", text: "YouTube 채널을 연결하지 못했어요. 채널과 권한을 확인해주세요." },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ business?: string; instagram?: string; youtube?: string }> }) {
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
  if (businessError) throw new Error("사업 정보를 불러오지 못했습니다.");
  const selectedBusiness = (businesses ?? []).find((business) => business.id === query.business) ?? businesses?.[0];
  const { data: connections, error: connectionError } = selectedBusiness
    ? await supabase.from("integration_connections")
      .select("id, provider, account_identifier, status, metadata, connected_at, updated_at")
      .eq("user_id", user.id).eq("business_id", selectedBusiness.id)
    : { data: [], error: null };
  if (connectionError) throw new Error("외부 서비스 연결 정보를 불러오지 못했습니다.");
  const instagramMessage = query.instagram ? INSTAGRAM_MESSAGE[query.instagram] : undefined;
  const youtubeMessage = query.youtube ? YOUTUBE_MESSAGE[query.youtube] : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <PageHeader title="설정" description="프로필과 외부 서비스 연결을 관리해요." />

      {instagramMessage && <FormMessage variant={instagramMessage.variant}>{instagramMessage.text}</FormMessage>}
      {youtubeMessage && <FormMessage variant={youtubeMessage.variant}>{youtubeMessage.text}</FormMessage>}

      <section aria-labelledby="integration-heading" className="space-y-4">
        <div><h2 id="integration-heading" className="text-lg font-extrabold tracking-[-0.03em]">외부 서비스 연결</h2><p className="mt-1 text-sm text-muted-foreground">사업체마다 따로 연결해요. 비밀번호와 토큰은 저장한 뒤 다시 보여주지 않아요.</p></div>
        {(businesses ?? []).length === 0 ? <EmptyState mascot="welcome" title="연결할 사업체가 없어요" description="외부 서비스는 사업체마다 따로 연결해요. 먼저 사업 정보를 등록해주세요." action={<Button asChild><Link href="/onboarding">사업 정보 등록</Link></Button>} /> : <>
          {(businesses ?? []).length > 1 && <nav className="flex flex-wrap gap-2" aria-label="연결을 관리할 사업체">
            {(businesses ?? []).map((business) => <Button key={business.id} asChild size="sm" variant={business.id === selectedBusiness?.id ? "default" : "outline"} className="h-9 rounded-full px-4"><Link href={`/settings?business=${business.id}`} aria-current={business.id === selectedBusiness?.id ? "page" : undefined}>{business.name}</Link></Button>)}
          </nav>}
          <IntegrationSettings key={selectedBusiness!.id} businessId={selectedBusiness!.id} connections={(connections ?? []) as SafeConnection[]} />
        </>}
      </section>

      <section aria-labelledby="profile-heading" className="space-y-4">
        <h2 id="profile-heading" className="text-lg font-extrabold tracking-[-0.03em]">프로필</h2>
        <div className="rounded-2xl border bg-card px-5 py-6 sm:px-6">
          <ProfileForm email={user.email ?? ""} displayName={profile?.display_name ?? null} />
        </div>
      </section>
    </div>
  );
}
