import { redirect } from "next/navigation";
import { CheckCircle2, ClipboardList, MessagesSquare, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SetupRequestForm } from "@/components/setup-requests/setup-request-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SetupRequestPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent("/setup-request")}`);

  return (
    <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] lg:items-start">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-700">Setup service</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">자동화 구축 맡기기</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">현재 반복 업무와 원하는 결과를 알려주시면 담당자가 범위와 구축 방법을 검토해 연락드립니다.</p>
        <Card className="mt-7">
          <CardContent className="py-2"><SetupRequestForm defaultEmail={user.email ?? ""} /></CardContent>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6">
        <Card>
          <CardHeader><CardTitle className="text-base">접수 후 진행 과정</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-5">
              {[
                { icon: ClipboardList, title: "요청 검토", text: "현재 업무와 목표를 확인합니다." },
                { icon: MessagesSquare, title: "상담 연락", text: "선택한 방법으로 범위와 견적을 안내합니다." },
                { icon: Wrench, title: "자동화 구축", text: "협의한 도구와 실행 흐름을 구성합니다." },
                { icon: CheckCircle2, title: "검수와 인계", text: "실행 결과를 확인하고 사용법을 전달합니다." },
              ].map(({ icon: Icon, title, text }, index) => (
                <li key={title} className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700"><Icon className="size-4" /></span>
                  <div><p className="text-sm font-medium">{index + 1}. {title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <p className="rounded-xl bg-muted/50 p-4 text-xs leading-5 text-muted-foreground">구축 비용은 구독 요금과 별도입니다. 요청 제출만으로 비용이 청구되지 않으며 상담 후 범위와 견적을 확정합니다.</p>
      </aside>
    </div>
  );
}
