import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "초안",
  ACTIVE: "실행중",
  PAUSED: "일시정지",
  ERROR: "오류",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  ACTIVE: "default",
  PAUSED: "secondary",
  ERROR: "destructive",
};

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
  if (automationsError) throw new Error("자동화 목록을 불러오지 못했습니다.", { cause: automationsError });

  const templateIds = Array.from(new Set((automations ?? []).map((a) => a.template_id)));
  const { data: templates, error: templatesError } = templateIds.length
    ? await supabase.from("automation_templates").select("id, name").in("id", templateIds)
    : { data: [], error: null };
  if (templatesError) throw new Error("자동화 유형을 불러오지 못했습니다.", { cause: templatesError });
  const templateNames = new Map((templates ?? []).map((t) => [t.id, t.name]));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Automations</h1>
          <p className="text-sm text-muted-foreground">내가 생성한 자동화 목록입니다.</p>
        </div>
        <Button asChild className="w-full sm:w-auto">
          <Link href="/automations/marketplace"><Plus aria-hidden="true" /> 새 자동화 만들기</Link>
        </Button>
      </div>

      {(automations ?? []).length === 0 ? (
        <EmptyState
          icon={<Bot className="size-5" />}
          title="아직 생성한 자동화가 없습니다"
          description="마켓플레이스에서 반복 업무에 맞는 자동화를 선택해 첫 실행을 준비해보세요."
          action={<Button asChild><Link href="/automations/marketplace">자동화 둘러보기</Link></Button>}
        />
      ) : (
        <div className="space-y-3">
          {(automations ?? []).map((automation) => (
            <Link key={automation.id} href={`/automations/${automation.id}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="transition-colors hover:bg-muted/40">
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{automation.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {templateNames.get(automation.template_id) ?? "자동화"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground sm:justify-end">
                    {automation.next_run_at ? (
                      <span>다음 실행: {new Date(automation.next_run_at).toLocaleString("ko-KR")}</span>
                    ) : null}
                    <Badge variant={STATUS_VARIANT[automation.status]}>{STATUS_LABEL[automation.status]}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
