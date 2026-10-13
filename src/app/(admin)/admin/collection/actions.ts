"use server";

import { revalidatePath } from "next/cache";
import type { AdminActionState } from "@/app/(admin)/admin/users/[id]/actions";
import { requireAdmin } from "@/server/admin/access";
import { recordAdminAudit } from "@/server/admin/audit";
import { lastManualAdminRunAt, processDueChannels } from "@/server/channels";

/** One manual collection per this many minutes: the YouTube quota is shared by every user. */
const MANUAL_COLLECTION_COOLDOWN_MS = 10 * 60_000;

/** Admin-only "지금 수집": collects every active channel now, logged as a MANUAL_ADMIN run. */
export async function collectNowAction(_previous: AdminActionState): Promise<AdminActionState> {
  const { user, admin } = await requireAdmin({ action: "ADMIN_COLLECTION_RUN_ATTEMPT", targetType: "route", targetId: "/admin/collection" });
  const last = await lastManualAdminRunAt();
  if (last && Date.now() - last.getTime() < MANUAL_COLLECTION_COOLDOWN_MS) {
    const wait = Math.ceil((MANUAL_COLLECTION_COOLDOWN_MS - (Date.now() - last.getTime())) / 60_000);
    return { ok: false, message: `직전 수동 수집 후 ${wait}분 더 기다려 주세요. (YouTube 일일 할당량 보호)` };
  }
  try {
    const result = await processDueChannels(new Date(), 45_000, { trigger: "MANUAL_ADMIN", triggeredBy: user.id, all: true });
    await recordAdminAudit(admin, user, { action: "ADMIN_COLLECTION_RUN", targetType: "route", targetId: "/admin/collection", metadata: { ...result } });
    revalidatePath("/admin/collection");
    const quota = result.quotaExceeded ? " YouTube 할당량이 소진되어 일부는 나중에 다시 시도돼요." : "";
    return { ok: true, message: `수집 완료: 성공 ${result.processed}, 실패 ${result.failed}, 건너뜀 ${result.skipped}.${quota}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "수집을 시작하지 못했습니다." };
  }
}
