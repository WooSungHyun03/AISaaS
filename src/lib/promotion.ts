import type { Business } from "@/types/domain";
import { parsePromotionDetails, PROMOTION_FORM, PROMOTION_LABEL, type PromotionFieldKey, type PromotionType } from "@/types/promotion";

/** One answer of the promotion questions, read from wherever it is stored (business column or promotion_details). */
export function promotionFieldValue(business: Business, key: PromotionFieldKey): string | null {
  const details = parsePromotionDetails(business.promotion_details);
  const raw: Record<PromotionFieldKey, string | null | undefined> = {
    name: business.name,
    industry: business.industry,
    location: business.location,
    mainOffering: business.main_offering,
    strengths: business.strengths,
    targetCustomer: business.target_customer,
    website: business.website,
    problem: details.problem,
    priceInfo: details.priceInfo,
    actionUrl: details.actionUrl,
    flow: details.flow,
  };
  const value = raw[key]?.trim();
  return value ? value : null;
}

/** The questions that apply to this business's type, with their answers, labelled the way the owner saw them. */
export function promotionAnswers(business: Business, type: PromotionType): Array<{ key: PromotionFieldKey; label: string; value: string | null }> {
  return PROMOTION_FORM[type].fields.map((spec) => ({ key: spec.key, label: spec.label, value: promotionFieldValue(business, spec.key) }));
}

export function promotionTypeLabel(type: PromotionType | null | undefined): string {
  return type ? PROMOTION_LABEL[type] : "미선택";
}
