import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { PageHeader } from "@/components/layout/page-header";
import { templateTitle } from "@/components/automations/template-card";
import { AutomationStatusBadge } from "@/components/automations/run-badges";

export default async function MyAutomationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: automations, error: automationsError } = await supabase
    .from("automations")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (automationsError) throw new Error("만들기 설정 목록을 불러오지 못했습니다.", { cause: automationsError });

  const templateIds = Array.from(new Set((automations ?? []).map((a) => a.template_id)));
  const { data: templates, error: templatesError } = templateIds.length
    ? await supabase.from("automation_templates").select("id, name, slug").in("id", templateIds)
    : { data: [], error: null };
  if (templatesError) throw new Error("콘텐츠 종류를 불러오지 못했습니다.", { cause: templatesError });
  const templateNames = new Map((templates ?? []).map((t) => [t.id, templateTitle(t.slug, t.name)]));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="만들기 설정"
        description="정해둔 때마다 블로그 글과 숏폼 콘텐츠를 만들어 줘요. 만든 결과는 제작 기록에서 확인해요."
        actions={<Button asChild><Link href="/automations/marketplace"><Plus aria-hidden="true" /> 새로 만들기</Link></Button>}
      />

      {(automations ?? []).length === 0 ? (
        <EmptyState
          mascot="present"
          title="아직 만들기 설정이 없어요"
          description="블로그 글이나 숏폼 중 하나를 골라 첫 설정을 만들어보세요. 1분이면 끝나요."
          action={<Button asChild><Link href="/automations/marketplace">콘텐츠 종류 보기</Link></Button>}
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {(automations ?? []).map((automation) => (
            <li key={automation.id}>
              <Link href={`/automations/${automation.id}`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-brand-soft/50 focus-visible:outline-offset-[-2px] sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{automation.name}</p>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {templateNames.get(automation.template_id) ?? "콘텐츠"}
                    {automation.next_run_at ? ` · 다음 제작 ${new Date(automation.next_run_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
                  </p>
                </div>
                <AutomationStatusBadge status={automation.status} />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
