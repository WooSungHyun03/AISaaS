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

/**
 * A business saved before the SNS link field list grew from 4 to 6 keys
 * may still have its blog link under the old generic `blog` key — fall
 * back to it only when the new `naver_blog` key is empty, so that data
 * isn't silently dropped from the form. The next save always writes
 * `naver_blog`, never `blog` again (see snsLinksFromForm in
 * src/app/(app)/business/actions.ts) — this is the one place the
 * migration from the old key happens, and it's read-only.
 */
export function mergeSnsLinks(current: BusinessSnsLinks | null | undefined, suggestion: BusinessSnsLinks | null | undefined): BusinessSnsLinks {
  const currentNaverBlog = current?.naver_blog ?? current?.blog;
  return {
    instagram: mergeBusinessDefault(current?.instagram, suggestion?.instagram) || undefined,
    facebook: mergeBusinessDefault(current?.facebook, suggestion?.facebook) || undefined,
    youtube: mergeBusinessDefault(current?.youtube, suggestion?.youtube) || undefined,
    naver_blog: mergeBusinessDefault(currentNaverBlog, suggestion?.naver_blog) || undefined,
    naver_place: mergeBusinessDefault(current?.naver_place, suggestion?.naver_place) || undefined,
    kakao_channel: mergeBusinessDefault(current?.kakao_channel, suggestion?.kakao_channel) || undefined,
  };
}
