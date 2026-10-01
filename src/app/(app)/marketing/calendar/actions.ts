"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CalendarPlanError, generateCalendarPlan } from "@/server/marketing/calendar";

const requestSchema = z.object({
  businessId: z.string().uuid(),
  weeks: z.coerce.number().int().min(2).max(4),
});

export interface GenerateCalendarActionState {
  status?: "success" | "error";
  message?: string;
  count?: number;
  completedAt?: number;
}

export async function generateMarketingCalendar(
  _previousState: GenerateCalendarActionState,
  formData: FormData,
): Promise<GenerateCalendarActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "로그인이 만료되었습니다. 다시 로그인해주세요." };

  const parsed = requestSchema.safeParse({
    businessId: formData.get("businessId"),
    weeks: formData.get("weeks"),
  });
  if (!parsed.success) return { status: "error", message: "사업체와 계획 기간을 확인해주세요." };

  try {
    const result = await generateCalendarPlan(parsed.data.businessId, parsed.data.weeks);
    revalidatePath("/calendar");
    revalidatePath("/marketing/calendar");
    return {
      status: "success",
      message: `${parsed.data.weeks}주 마케팅 계획 ${result.items.length}건을 저장했습니다.`,
      count: result.items.length,
      completedAt: Date.now(),
    };
  } catch (error) {
    if (error instanceof CalendarPlanError) {
      return { status: "error", message: error.message, completedAt: Date.now() };
    }
    return {
      status: "error",
      message: "마케팅 계획을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
      completedAt: Date.now(),
    };
  }
}
