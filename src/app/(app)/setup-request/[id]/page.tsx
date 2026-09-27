import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ClipboardCheck, Mail, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSetupRequest } from "@/server/setup-requests";
import { SetupRequestStatusBadge } from "@/components/setup-requests/setup-request-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SETUP_CONTACT_METHODS, SETUP_REQUEST_STATUS, setupAutomationTypeLabel, setupRequestNumber } from "@/types/setup-request";
import type { SetupRequestStatus } from "@/types/domain";

const STATUS_STEPS: SetupRequestStatus[] = ["REQUESTED", "CONTACTED", "IN_PROGRESS", "COMPLETED"];
const formatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Seoul" });

export default async function SetupRequestDetailPage({ params }: PageProps<"/setup-request/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent(`/setup-request/${id}`)}`);

  const request = await getSetupRequest(user.id, id);
  if (!request) notFound();
  const currentStep = STATUS_STEPS.indexOf(request.status);
  const contactLabel = SETUP_CONTACT_METHODS.find((method) => method.value === request.contact_method)?.label ?? "연락처";
  const ContactIcon = request.contact_method === "EMAIL" ? Mail : Phone;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button asChild variant="ghost" className="-ml-2"><Link href="/dashboard"><ArrowLeft /> Dashboard</Link></Button>

      <Card className="overflow-hidden border-blue-200">
        <div className="h-1.5 bg-blue-600" />
        <CardHeader className="items-center text-center">
          <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-blue-50 text-blue-700"><ClipboardCheck className="size-6" /></span>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">{setupRequestNumber(request.id)}</p>
          <CardTitle className="text-2xl">{request.status === "REQUESTED" ? "구축 요청이 접수되었습니다" : "구축 요청 진행 현황"}</CardTitle>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{SETUP_REQUEST_STATUS[request.status].description} 상태가 변경되면 Dashboard에서 확인할 수 있습니다.</p>
          <SetupRequestStatusBadge status={request.status} />
        </CardHeader>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">진행 상태</CardTitle></CardHeader>
        <CardContent>
          {request.status === "CANCELLED" ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">이 요청은 취소되었습니다. 다시 상담이 필요하면 새 요청을 제출해주세요.</p>
          ) : (
            <ol className="grid gap-3 sm:grid-cols-4">
              {STATUS_STEPS.map((status, index) => {
                const complete = index <= currentStep;
                return (
                  <li key={status} className={`rounded-xl border p-3 ${complete ? "border-blue-200 bg-blue-50/60" : "bg-muted/20"}`}>
                    <span className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${complete ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground"}`}>{complete ? <Check className="size-3.5" /> : index + 1}</span>
                    <p className="mt-3 text-sm font-medium">{SETUP_REQUEST_STATUS[status].label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{SETUP_REQUEST_STATUS[status].description}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">요청 내용</CardTitle></CardHeader>
        <CardContent className="space-y-5 text-sm">
          <div className="grid gap-5 sm:grid-cols-2">
            <div><p className="text-muted-foreground">요청번호</p><p className="mt-1 font-mono font-medium">{setupRequestNumber(request.id)}</p></div>
            <div><p className="text-muted-foreground">접수 시각</p><p className="mt-1 font-medium">{formatter.format(new Date(request.created_at))} KST</p></div>
            <div><p className="text-muted-foreground">자동화 유형</p><p className="mt-1 font-medium">{setupAutomationTypeLabel(request.automation_type)}</p></div>
            <div><p className="text-muted-foreground">예산 범위</p><p className="mt-1 font-medium">{request.budget_range ?? "상담 후 결정"}</p></div>
          </div>
          <div className="border-t pt-5"><p className="text-muted-foreground">현재 업무</p><p className="mt-2 whitespace-pre-wrap leading-6">{request.current_work ?? request.description ?? "입력된 내용이 없습니다."}</p></div>
          <div className="border-t pt-5"><p className="text-muted-foreground">원하는 자동화 결과</p><p className="mt-2 whitespace-pre-wrap leading-6">{request.desired_outcome ?? "입력된 내용이 없습니다."}</p></div>
          {request.description && request.current_work ? <div className="border-t pt-5"><p className="text-muted-foreground">추가 참고 사항</p><p className="mt-2 whitespace-pre-wrap leading-6">{request.description}</p></div> : null}
          <div className="flex items-start gap-3 border-t pt-5"><ContactIcon className="mt-0.5 size-4 text-blue-700" /><div><p className="text-muted-foreground">{contactLabel}</p><p className="mt-1 font-medium">{request.contact_value ?? "등록된 연락 정보 없음"}</p></div></div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline"><Link href="/setup-request">새 구축 요청</Link></Button>
        <Button asChild><Link href="/dashboard">Dashboard에서 상태 확인 <ArrowRight /></Link></Button>
      </div>
    </div>
  );
}
