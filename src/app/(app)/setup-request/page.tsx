import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { SetupRequestForm } from "@/components/setup-requests/setup-request-form";
import { Mascot } from "@/components/brand/mascot";

const STEPS = [
  { title: "요청 확인", text: "지금 하는 일과 목표를 살펴봐요." },
  { title: "상담 연락", text: "고른 방법으로 범위와 견적을 알려드려요." },
  { title: "세팅", text: "이야기한 대로 설정하고 연결해요." },
  { title: "확인과 전달", text: "결과를 같이 보고 쓰는 법을 알려드려요." },
];

export default async function SetupRequestPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent("/setup-request")}`);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader title="세팅 맡기기" description="직접 설정이 어렵다면 알려주세요. 담당자가 범위와 방법을 살펴보고 연락드려요." />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)] lg:items-start">
        <div className="rounded-2xl border bg-card px-5 py-6 sm:px-8 sm:py-8"><SetupRequestForm defaultEmail={user.email ?? ""} /></div>
        <aside className="space-y-5 lg:sticky lg:top-24">
          <div className="rounded-2xl bg-brand-soft px-6 py-6">
            <Mascot pose="present" size={96} className="mb-4" />
            <h2 className="font-extrabold tracking-[-0.02em]">보내신 뒤에는</h2>
            <ol className="mt-4 space-y-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span>
                  <div><p className="text-sm font-bold">{step.title}</p><p className="mt-0.5 text-[13px] leading-6 text-muted-foreground">{step.text}</p></div>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-[13px] leading-6 text-muted-foreground">세팅 비용은 구독 요금과 따로예요. 요청만 보내서는 비용이 청구되지 않고, 상담 뒤에 범위와 견적을 정해요.</p>
        </aside>
      </div>
    </div>
  );
}
