import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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

  const { data: automations } = await supabase
    .from("automations")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const templateIds = Array.from(new Set((automations ?? []).map((a) => a.template_id)));
  const { data: templates } = templateIds.length
    ? await supabase.from("automation_templates").select("id, name").in("id", templateIds)
    : { data: [] };
  const templateNames = new Map((templates ?? []).map((t) => [t.id, t.name]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Automations</h1>
          <p className="text-sm text-muted-foreground">내가 생성한 자동화 목록입니다.</p>
        </div>
        <Button asChild>
          <Link href="/automations/marketplace">새 자동화 만들기</Link>
        </Button>
      </div>

      {(automations ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            아직 생성한 자동화가 없습니다. 마켓플레이스에서 첫 자동화를 만들어보세요.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(automations ?? []).map((automation) => (
            <Link key={automation.id} href={`/automations/${automation.id}`}>
              <Card className="transition-colors hover:bg-muted/40">
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <p className="font-medium">{automation.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {templateNames.get(automation.template_id) ?? "자동화"}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
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
