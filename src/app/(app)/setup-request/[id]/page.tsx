import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSetupRequest } from "@/server/setup-requests";
import { SetupRequestStatusBadge } from "@/components/setup-requests/setup-request-status";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { FormMessage } from "@/components/ui/form-message";
import { cn } from "@/lib/utils";
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

  const label = "text-[13px] font-semibold text-muted-foreground";

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        back={{ href: "/dashboard", label: "홈" }}
        title={request.status === "REQUESTED" ? "요청을 받았어요" : "요청 진행 현황"}
        description={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><SetupRequestStatusBadge status={request.status} /><span>{SETUP_REQUEST_STATUS[request.status].description}</span></span>}
        actions={<Button asChild variant="outline"><Link href="/setup-request">새 요청 보내기</Link></Button>}
      />

      <section aria-labelledby="progress-heading" className="space-y-3">
        <h2 id="progress-heading" className="text-lg font-extrabold tracking-[-0.03em]">진행 상태</h2>
        {request.status === "CANCELLED" ? (
          <FormMessage>이 요청은 취소됐어요. 다시 상담이 필요하면 새 요청을 보내주세요.</FormMessage>
        ) : (
          <ol className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-4">
            {STATUS_STEPS.map((status, index) => {
              const complete = index <= currentStep;
              return (
                <li key={status} aria-current={index === currentStep ? "step" : undefined} className={cn("px-4 py-4", complete ? "bg-brand-soft" : "bg-card")}>
                  <span className={cn("flex size-6 items-center justify-center rounded-full text-xs font-bold", complete ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{complete ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}</span>
                  <p className="mt-3 text-sm font-bold">{SETUP_REQUEST_STATUS[status].label}</p>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{SETUP_REQUEST_STATUS[status].description}</p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="request-heading" className="space-y-3">
        <h2 id="request-heading" className="text-lg font-extrabold tracking-[-0.03em]">보내신 내용</h2>
        <div className="space-y-5 rounded-2xl border bg-card px-5 py-6 sm:px-8">
          <dl className="grid gap-5 sm:grid-cols-2">
            <div><dt className={label}>요청 번호</dt><dd className="mt-1 font-mono text-sm font-medium">{setupRequestNumber(request.id)}</dd></div>
            <div><dt className={label}>보낸 시각</dt><dd className="mt-1 font-medium">{formatter.format(new Date(request.created_at))}</dd></div>
            <div><dt className={label}>도움이 필요한 일</dt><dd className="mt-1 font-medium">{setupAutomationTypeLabel(request.automation_type)}</dd></div>
            <div><dt className={label}>예산 범위</dt><dd className="mt-1 font-medium">{request.budget_range ?? "상담 뒤에 정해요"}</dd></div>
          </dl>
          <div className="border-t pt-5"><p className={label}>지금 반복하는 일</p><p className="mt-2 whitespace-pre-wrap text-[15px] leading-7">{request.current_work ?? request.description ?? "적힌 내용이 없어요."}</p></div>
          <div className="border-t pt-5"><p className={label}>원하는 결과</p><p className="mt-2 whitespace-pre-wrap text-[15px] leading-7">{request.desired_outcome ?? "적힌 내용이 없어요."}</p></div>
          {request.description && request.current_work ? <div className="border-t pt-5"><p className={label}>추가 참고 사항</p><p className="mt-2 whitespace-pre-wrap text-[15px] leading-7">{request.description}</p></div> : null}
          <div className="border-t pt-5"><p className={label}>{contactLabel}</p><p className="mt-1 font-medium">{request.contact_value ?? "등록된 연락처가 없어요"}</p></div>
        </div>
      </section>
    </div>
  );
}
