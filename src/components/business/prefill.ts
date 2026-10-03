import type { BusinessSnsLinks } from "@/types/domain";

/**
 * Resolves one Business Profile field's defaultValue: the business's own
 * saved value always wins over an AI diagnosis suggestion (ticket 2 — the
 * suggestion only fills a gap, it never overrides real data). This module
 * has no supabase/network import at all, so it structurally cannot save
 * anything — it only computes form defaultValues; see
 * src/components/business/business-form-dialog.tsx for where that's used,
 * and the only actual write path remains the form's own submit ->
 * createBusiness/updateBusiness Server Action.
 */
export function mergeBusinessDefault(current: string | null | undefined, suggestion: string | null | undefined): string {
  if (current && current.trim()) return current;
  return suggestion ?? "";
}

export function mergeSnsLinks(current: BusinessSnsLinks | null | undefined, suggestion: BusinessSnsLinks | null | undefined): BusinessSnsLinks {
  return {
    instagram: mergeBusinessDefault(current?.instagram, suggestion?.instagram) || undefined,
    facebook: mergeBusinessDefault(current?.facebook, suggestion?.facebook) || undefined,
    youtube: mergeBusinessDefault(current?.youtube, suggestion?.youtube) || undefined,
    blog: mergeBusinessDefault(current?.blog, suggestion?.blog) || undefined,
  };
}
