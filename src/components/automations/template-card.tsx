import { Boxes, Camera, Clapperboard, FileText, Headset, Mail, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AutomationAvailability } from "@/types/automation";
import type { AutomationTemplate, AutomationTemplateSlug } from "@/types/domain";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";

interface TemplateCopy {
  icon: LucideIcon;
  title: string;
  description: string;
  note?: string;
}

/** 사용자에게 보이는 이름과 설명. DB의 template.name 대신 서비스 언어로 표기합니다. */
const COPY: Record<AutomationTemplateSlug, TemplateCopy> = {
  "blog-marketing": {
    icon: FileText,
    title: "블로그 글 만들기",
    description: "사업 정보와 키워드로 제목, 본문, 검색 키워드까지 갖춘 글을 써드려요.",
    note: "만든 글은 복사해서 직접 올려요. 자동으로 게시되지 않아요.",
  },
  shorts: {
    icon: Clapperboard,
    title: "숏폼 영상 만들기",
    description: "첫 3초 후킹 문장, 대본, 자막을 갖춘 세로 영상을 만들어드려요.",
  },
  "instagram-marketing": {
    icon: Camera,
    title: "인스타그램 콘텐츠",
    description: "브랜드 말투에 맞는 캡션과 마케팅 카드를 만들어 연결한 계정에 올려요.",
    note: "Professional 계정 연결이 필요한 베타 기능이에요.",
  },
  newsletter: { icon: Mail, title: "뉴스레터", description: "단골 손님에게 보낼 소식을 써드려요." },
  "customer-support": { icon: Headset, title: "고객 문의 답변", description: "자주 오는 문의에 쓸 답변을 준비해드려요." },
};

/** 화면에 보이는 콘텐츠 종류 이름. DB의 template.name 대신 서비스 언어로 씁니다. */
export function templateTitle(slug: string, fallback: string) {
  return COPY[slug as AutomationTemplateSlug]?.title ?? fallback;
}

export const AVAILABILITY_COPY: Record<AutomationAvailability, { label: string; variant: "success" | "brand" | "secondary" }> = {
  AVAILABLE: { label: "이용 가능", variant: "success" },
  BETA: { label: "베타", variant: "brand" },
  COMING_SOON: { label: "준비 중", variant: "secondary" },
};

export function TemplateRow({
  template,
  children,
}: {
  template: AutomationTemplate;
  children?: React.ReactNode;
}) {
  const availability = AUTOMATION_AVAILABILITY[template.slug as keyof typeof AUTOMATION_AVAILABILITY] ?? "COMING_SOON";
  const copy = COPY[template.slug as AutomationTemplateSlug];
  const Icon = copy?.icon ?? Boxes;
  const status = AVAILABILITY_COPY[availability];
  const muted = availability === "COMING_SOON";

  return (
    <li className="grid gap-4 px-5 py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-5 sm:px-6">
      <span className={`flex size-12 items-center justify-center rounded-xl ${muted ? "bg-muted text-muted-foreground" : "bg-brand-soft text-primary"}`}>
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold tracking-[-0.02em]">{copy?.title ?? template.name}</h3>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <p className="mt-1.5 text-[15px] leading-7 text-muted-foreground">{copy?.description ?? template.description}</p>
        {copy?.note ? <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{copy.note}</p> : null}
      </div>
      {children ? <div className="sm:w-40">{children}</div> : null}
    </li>
  );
}
