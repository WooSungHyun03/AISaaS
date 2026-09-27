import { Badge } from "@/components/ui/badge";
import type { AutomationRunSource, AutomationRunStatus } from "@/types/domain";

const STATUS_LABEL: Record<AutomationRunStatus, string> = {
  QUEUED: "대기 중",
  RUNNING: "실행 중",
  SUCCESS: "성공",
  FAILED: "실패",
};

export function RunStatusBadge({ status }: { status: AutomationRunStatus }) {
  return (
    <Badge variant={status === "FAILED" ? "destructive" : status === "SUCCESS" ? "secondary" : "outline"}>
      <span className={`size-1.5 rounded-full ${status === "SUCCESS" ? "bg-emerald-600" : status === "FAILED" ? "bg-red-600" : status === "RUNNING" ? "animate-pulse bg-blue-600" : "bg-slate-400"}`} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function RunSourceBadge({ source }: { source: AutomationRunSource }) {
  return <Badge variant="outline">{source === "MANUAL" ? "수동 실행" : "예약 실행"}</Badge>;
}
