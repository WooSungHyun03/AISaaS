import Link from "next/link";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { ProfileForm } from "@/components/settings/profile-form";
import { PasswordForm } from "@/components/settings/password-form";
import { DeleteAccountForm } from "@/components/settings/delete-account-form";

export const metadata = { title: "설정" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <PageHeader title="설정" description="프로필, 비밀번호, 채널 등록 안내와 계정을 관리해요." actions={<Button asChild variant="outline"><Link href="/business">사업 정보 관리</Link></Button>} />

      <section aria-labelledby="channels-heading" className="space-y-3">
        <h2 id="channels-heading" className="text-lg font-extrabold tracking-[-0.03em]">채널 등록</h2>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-5 sm:px-6">
          <p className="min-w-0 max-w-xl text-sm leading-6 text-muted-foreground">YouTube·네이버 블로그·티스토리는 계정을 연결하지 않아도 돼요. 채널 주소만 등록하면 공개된 통계를 매일 오전 6시(한국 시간)에 모아 성장 리포트에 보여드려요.</p>
          <Button asChild variant="outline"><Link href="/diagnosis">채널 등록하러 가기</Link></Button>
        </div>
      </section>

      <section aria-labelledby="profile-heading" className="space-y-4">
        <h2 id="profile-heading" className="text-lg font-extrabold tracking-[-0.03em]">프로필</h2>
        <div className="rounded-2xl border bg-card px-5 py-6 sm:px-6">
          <ProfileForm email={user.email ?? ""} displayName={profile?.display_name ?? null} />
        </div>
      </section>

      <section aria-labelledby="password-heading" className="space-y-4">
        <div><h2 id="password-heading" className="text-lg font-extrabold tracking-[-0.03em]">비밀번호 변경</h2><p className="mt-1 text-sm text-muted-foreground">현재 비밀번호를 확인한 뒤 바꿔요. 기억나지 않으면 로그아웃 후 &lsquo;비밀번호를 잊으셨나요?&rsquo;를 이용해주세요.</p></div>
        <div className="rounded-2xl border bg-card px-5 py-6 sm:px-6">
          <PasswordForm />
        </div>
      </section>

      <section aria-labelledby="delete-account-heading" className="space-y-4">
        <div><h2 id="delete-account-heading" className="text-lg font-extrabold tracking-[-0.03em]">회원 탈퇴</h2><p className="mt-1 text-sm text-muted-foreground">계정과 저장된 모든 데이터를 바로 삭제해요.</p></div>
        <div className="rounded-2xl border border-destructive/30 bg-card px-5 py-6 sm:px-6">
          <DeleteAccountForm />
        </div>
      </section>
    </div>
  );
}
