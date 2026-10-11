import { Building2, Laptop, Package, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BusinessFormDialog } from "@/components/business/business-form-dialog";
import { promotionAnswers } from "@/lib/promotion";
import { PROMOTION_FORM, PROMOTION_LABEL } from "@/types/promotion";
import type { Business } from "@/types/domain";

const ICON = { STORE: Building2, PRODUCT: Package, PLATFORM: Laptop } as const;

/**
 * What the next post or Short is about, shown right where it is made: the type the owner chose, the answers that
 * will be used, and a way to change either. Without a type nothing can be generated, so the card asks for it.
 */
export function PromotionTargetCard({ business }: { business: Business }) {
  const type = business.promotion_type;
  if (!type) {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/[0.05] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="font-bold">무엇을 홍보할지 먼저 골라주세요</p>
            <p className="mt-0.5 text-sm text-muted-foreground">가게·상품·플랫폼에 따라 글과 영상의 구성이 달라져요. 한 번 고르면 이후에도 그대로 써요.</p>
          </div>
        </div>
        <BusinessFormDialog business={business} trigger={<Button size="sm">홍보 대상 고르기</Button>} />
      </div>
    );
  }

  const Icon = ICON[type];
  const answers = promotionAnswers(business, type).filter((answer) => answer.key !== "name" && answer.value).slice(0, 3);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary"><Icon className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-bold"><span className="truncate">{business.name}</span><Badge variant="brand">{PROMOTION_LABEL[type]} 홍보</Badge></p>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
            {answers.length > 0 ? answers.map((answer) => `${answer.label}: ${answer.value}`).join(" · ") : `${PROMOTION_FORM[type].hint} — 정보를 더 적어주면 글과 영상이 구체적이 돼요.`}
          </p>
        </div>
      </div>
      <BusinessFormDialog business={business} trigger={<Button size="sm" variant="outline">홍보 대상·정보 바꾸기</Button>} />
    </div>
  );
}
