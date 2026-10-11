"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/admin/access";
import { recordAdminAudit } from "@/server/admin/audit";
import { setUserAccountStatus } from "@/server/admin/operations";

export interface AdminActionState { ok: boolean; message: string }

export async function setAccountStatusAction(userId: string, _previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const { user, admin } = await requireAdmin({ action: "ADMIN_USER_STATUS_ATTEMPT", targetType: "user", targetId: userId });
  if (user.id === userId) return { ok: false, message: "현재 로그인한 관리자 계정은 정지할 수 없습니다." };
  const status = formData.get("status") === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
  const reason = String(formData.get("reason") ?? "").trim();
  try {
    await setUserAccountStatus(admin, { userId, status, reason });
    await recordAdminAudit(admin, user, { action: status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_REACTIVATED", targetType: "user", targetId: userId, metadata: { status } });
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true, message: status === "SUSPENDED" ? "계정을 정지했습니다." : "계정을 다시 활성화했습니다." };
  } catch (error) {
    await recordAdminAudit(admin, user, { action: "USER_STATUS_CHANGE_FAILED", targetType: "user", targetId: userId, metadata: { status } });
    return { ok: false, message: error instanceof Error ? error.message : "계정 상태를 바꾸지 못했습니다." };
  }
}
