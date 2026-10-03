import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { DiagnosisForm } from "@/components/marketing/diagnosis-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";

export default async function DiagnosisPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: businesses, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at");
  if (businessError) throw new Error("사업체 정보를 불러오지 못했습니다.", { cause: businessError });

  const selectedBusiness = businesses?.find((business) => business.id === query.business) ?? businesses?.[0];
  if (!selectedBusiness) {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <PageHeading />
        <EmptyState
          mascot="point"
          title="진단할 가게가 아직 없어요"
          description="먼저 사업체를 등록하면 홈페이지 주소로 마케팅 진단을 받을 수 있어요."
          action={<Button asChild><Link href="/business">사업체 등록하기</Link></Button>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeading />

      {(businesses?.length ?? 0) > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label="진단할 사업체 선택">
          {businesses?.map((business) => (
            <Button key={business.id} asChild size="sm" variant={business.id === selectedBusiness.id ? "default" : "outline"}>
              <Link href={`/diagnosis?business=${business.id}`} aria-current={business.id === selectedBusiness.id ? "page" : undefined}>
                {business.name}
              </Link>
            </Button>
          ))}
        </nav>
      ) : null}

      <DiagnosisForm key={selectedBusiness.id} business={selectedBusiness} />
    </div>
  );
}

function PageHeading() {
  return (
    <PageHeader
      title="홈페이지 마케팅 진단"
      description="홈페이지 주소를 입력하면 AI가 내용을 읽고 마케팅 준비도를 점수와 함께 알려드려요."
    />
  );
}
