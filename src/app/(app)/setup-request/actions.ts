"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createSetupRequestRecord } from "@/server/setup-requests";
import { setupRequestInputSchema } from "@/server/setup-request-input";

export interface SetupRequestActionState {
  error?: string;
}

export async function submitSetupRequest(
  _previousState: SetupRequestActionState,
  formData: FormData,
): Promise<SetupRequestActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 만료되었습니다. 다시 로그인해주세요." };

  const parsed = setupRequestInputSchema.safeParse({
    automationType: formData.get("automationType"),
    currentWork: formData.get("currentWork"),
    desiredOutcome: formData.get("desiredOutcome"),
    budgetRange: formData.get("budgetRange"),
    contactMethod: formData.get("contactMethod"),
    contactValue: formData.get("contactValue"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력 내용을 확인해주세요." };

  let requestId: string;
  try {
    const request = await createSetupRequestRecord(user.id, {
      ...parsed.data,
      notes: parsed.data.notes || null,
    });
    requestId = request.id;
  } catch {
    return { error: "요청을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." };
  }

  revalidatePath("/dashboard");
  redirect(`/setup-request/${requestId}`);
}
