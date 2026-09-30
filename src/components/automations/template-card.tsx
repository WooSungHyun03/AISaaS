import { Boxes, Camera, Clapperboard, FileText, Headset, Mail, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { AutomationAvailability } from "@/types/automation";
import type { AutomationTemplate, AutomationTemplateSlug } from "@/types/domain";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";

const DETAILS: Record<AutomationTemplateSlug, { icon: LucideIcon; title: string; purpose: string; color: string }> = {
  "blog-marketing": { icon: FileText, title: "Naver Blog Draft", purpose: "네이버 블로그에 옮길 포스팅 원고 작성", color: "bg-blue-50 text-blue-700" },
  "instagram-marketing": { icon: Camera, title: "Instagram Marketing", purpose: "SNS 콘텐츠 제작과 게시", color: "bg-pink-50 text-pink-700" },
  newsletter: { icon: Mail, title: "Newsletter", purpose: "고객에게 전할 소식 작성", color: "bg-amber-50 text-amber-700" },
  "customer-support": { icon: Headset, title: "Customer Support", purpose: "반복 문의에 대한 답변 준비", color: "bg-emerald-50 text-emerald-700" },
  shorts: { icon: Clapperboard, title: "Ad Shorts", purpose: "광고 숏폼 제작·예약·자동 게시", color: "bg-violet-50 text-violet-700" },
};

const STATUS: Record<AutomationAvailability, { label: string; className: string }> = {
  AVAILABLE: { label: "Available", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  BETA: { label: "Beta", className: "border-blue-200 bg-blue-50 text-blue-800" },
  COMING_SOON: { label: "Coming Soon", className: "border-slate-200 bg-slate-100 text-slate-600" },
};

const CATEGORY_LABEL: Record<string, string> = { marketing: "마케팅", support: "고객 응대" };

export function TemplateCard({
  template,
  children,
}: {
  template: AutomationTemplate;
  children?: React.ReactNode;
}) {
  const availability = AUTOMATION_AVAILABILITY[template.slug as keyof typeof AUTOMATION_AVAILABILITY] ?? "COMING_SOON";
  const detail = DETAILS[template.slug as AutomationTemplateSlug];
  const Icon = detail?.icon ?? Boxes;
  const displayName = template.slug === "blog-marketing"
    ? "네이버 블로그용 포스팅 원고"
    : template.slug === "shorts"
      ? "광고 숏폼 제작·게시"
      : template.name;
  const displayDescription = template.slug === "blog-marketing"
    ? "사업 정보와 키워드를 바탕으로 제목과 본문을 생성합니다."
    : template.slug === "shorts"
      ? "광고성 숏폼 제작과 예약·자동 게시를 준비하고 있습니다."
      : template.description;

  return (
    <Card className="flex h-full flex-col border border-slate-200 bg-white ring-0 transition-shadow hover:shadow-md">
      <CardHeader className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <span className={`flex size-11 items-center justify-center rounded-xl ${detail?.color ?? "bg-slate-100 text-slate-700"}`}>
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <Badge variant="outline" className={STATUS[availability].className}>{STATUS[availability].label}</Badge>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{detail?.title ?? template.slug}</p>
          <CardTitle className="text-lg font-semibold text-slate-950">{displayName}</CardTitle>
          <CardDescription className="mt-2 min-h-12 leading-6">{displayDescription}</CardDescription>
          {template.slug === "blog-marketing" ? <p className="mt-2 text-xs font-medium text-blue-700">네이버 직접 게시는 지원하지 않으며, 복사 가능한 원고를 제공합니다.</p> : null}
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          {CATEGORY_LABEL[template.category] ?? template.category}
        </span>
        {detail ? <p className="text-xs text-slate-500">적합한 작업 · {detail.purpose}</p> : null}
      </CardContent>
      {children ? <CardFooter className="bg-white">{children}</CardFooter> : null}
    </Card>
  );
}
