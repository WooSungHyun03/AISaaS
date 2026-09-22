import { Boxes, Camera, Clapperboard, FileText, Headset, Mail, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { AutomationAvailability } from "@/types/automation";
import type { AutomationTemplate, AutomationTemplateSlug } from "@/types/domain";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";

const DETAILS: Record<AutomationTemplateSlug, { icon: LucideIcon; title: string; purpose: string; color: string }> = {
  "blog-marketing": { icon: FileText, title: "Blog Marketing", purpose: "정기적인 블로그 콘텐츠 작성", color: "bg-blue-50 text-blue-700" },
  "instagram-marketing": { icon: Camera, title: "Instagram Marketing", purpose: "SNS 게시물 기획", color: "bg-pink-50 text-pink-700" },
  newsletter: { icon: Mail, title: "Newsletter", purpose: "고객에게 전할 소식 작성", color: "bg-amber-50 text-amber-700" },
  "customer-support": { icon: Headset, title: "Customer Support", purpose: "반복 문의에 대한 답변 준비", color: "bg-emerald-50 text-emerald-700" },
  shorts: { icon: Clapperboard, title: "Shorts", purpose: "숏폼 콘텐츠 아이디어와 대본", color: "bg-violet-50 text-violet-700" },
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
          <CardTitle className="text-lg font-semibold text-slate-950">{template.name}</CardTitle>
          <CardDescription className="mt-2 min-h-12 leading-6">{template.description}</CardDescription>
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
