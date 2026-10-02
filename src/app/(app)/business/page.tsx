import { ExternalLink, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BusinessFormDialog } from "@/components/business/business-form-dialog";
import { DeleteBusinessButton } from "@/components/business/delete-business-button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/page-state";
import type { Business } from "@/types/domain";

function profileCompleteness(business: Business) {
  const fields = [business.industry, business.description, business.location, business.target_customer, business.brand_tone, business.website, business.keywords.length ? "keywords" : null];
  const filled = fields.filter(Boolean).length;
  return { filled, total: fields.length, percent: Math.round((filled / fields.length) * 100) };
}

export default async function BusinessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: businesses, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error("사업체 정보를 불러오지 못했습니다.", { cause: error });

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="사업 정보"
        description="진단과 콘텐츠를 만들 때 AI가 참고하는 우리 가게 정보예요. 자세히 적을수록 글이 가게다워져요."
        actions={<BusinessFormDialog trigger={<Button><Plus aria-hidden="true" /> 새 사업체 등록</Button>} />}
      />

      {(businesses ?? []).length === 0 ? (
        <EmptyState
          mascot="welcome"
          title="아직 등록된 가게가 없어요"
          description="업체명만 적어도 시작할 수 있어요. 가게 정보가 있어야 진단과 콘텐츠를 가게에 맞게 만들어드려요."
          action={<BusinessFormDialog trigger={<Button>첫 가게 등록하기</Button>} />}
        />
      ) : (
        <div className="space-y-6">
          {(businesses ?? []).map((business) => {
            const completeness = profileCompleteness(business);
            const rows: Array<[string, React.ReactNode]> = [
              ["가게 소개", business.description ? <span className="whitespace-pre-line">{business.description}</span> : null],
              ["지역", business.location],
              ["주요 손님", business.target_customer],
              ["브랜드 말투", business.brand_tone],
              [
                "대표 키워드",
                business.keywords.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {business.keywords.map((keyword) => <Badge key={keyword} variant="secondary" className="font-medium">{keyword}</Badge>)}
                  </span>
                ) : null,
              ],
              [
                "홈페이지",
                business.website ? (
                  <a href={business.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all font-medium text-primary hover:underline">
                    {business.website} <ExternalLink className="size-3.5 shrink-0" aria-label="새 탭에서 열림" />
                  </a>
                ) : null,
              ],
            ];
            return (
              <section key={business.id} aria-labelledby={`business-${business.id}`} className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="flex flex-col gap-4 border-b border-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 id={`business-${business.id}`} className="text-xl font-extrabold tracking-[-0.03em]">{business.name}</h2>
                      {business.industry ? <Badge variant="brand">{business.industry}</Badge> : null}
                    </div>
                  </div>
                  <div className="w-full sm:w-56">
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span className="font-medium text-muted-foreground">정보 채움</span>
                      <span className="tabular font-bold">{completeness.filled}/{completeness.total}</span>
                    </div>
                    <Progress value={completeness.percent} className="mt-1.5" aria-label={`사업 정보 ${completeness.total}개 중 ${completeness.filled}개 입력`} />
                  </div>
                </div>
                <dl className="divide-y divide-border">
                  {rows.map(([label, value]) => (
                    <div key={label} className="grid gap-1 px-6 py-3.5 sm:grid-cols-[9rem_1fr] sm:gap-6">
                      <dt className="text-sm font-semibold text-muted-foreground">{label}</dt>
                      <dd className="min-w-0 text-[15px] leading-7">{value ?? <span className="text-muted-foreground">아직 입력하지 않았어요</span>}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex justify-end gap-2 border-t border-border bg-muted/40 px-6 py-3">
                  <DeleteBusinessButton businessId={business.id} />
                  <BusinessFormDialog business={business} trigger={<Button variant="outline" size="sm">정보 수정</Button>} />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
