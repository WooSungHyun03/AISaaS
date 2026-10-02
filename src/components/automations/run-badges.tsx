import { Badge } from "@/components/ui/badge";
import type { AutomationRunSource, AutomationRunStatus } from "@/types/domain";

const STATUS_LABEL: Record<AutomationRunStatus, string> = {
  QUEUED: "대기 중",
  RUNNING: "만드는 중",
  SUCCESS: "완료",
  FAILED: "실패",
};

export function RunStatusBadge({ status }: { status: AutomationRunStatus }) {
  return (
    <Badge variant={status === "FAILED" ? "destructive" : status === "SUCCESS" ? "success" : status === "RUNNING" ? "brand" : "secondary"}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${status === "SUCCESS" ? "bg-success" : status === "FAILED" ? "bg-destructive" : status === "RUNNING" ? "animate-pulse bg-primary motion-reduce:animate-none" : "bg-muted-foreground"}`} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function RunSourceBadge({ source }: { source: AutomationRunSource }) {
  return <Badge variant="outline">{source === "MANUAL" ? "직접 만들기" : "자동 만들기"}</Badge>;
}

const AUTOMATION_STATUS: Record<string, { label: string; variant: "success" | "brand" | "secondary" | "destructive" | "outline" }> = {
  DRAFT: { label: "확인 필요", variant: "outline" },
  ACTIVE: { label: "켜짐", variant: "success" },
  PAUSED: { label: "꺼짐", variant: "secondary" },
  ERROR: { label: "오류", variant: "destructive" },
};

export function AutomationStatusBadge({ status }: { status: string }) {
  const item = AUTOMATION_STATUS[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={item.variant}>{item.label}</Badge>;
}
