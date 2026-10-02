import { Badge } from "@/components/ui/badge";
import { SETUP_REQUEST_STATUS } from "@/types/setup-request";
import type { SetupRequestStatus } from "@/types/domain";

export function SetupRequestStatusBadge({ status }: { status: SetupRequestStatus }) {
  const variant = status === "COMPLETED" ? "success" : status === "CANCELLED" ? "destructive" : status === "IN_PROGRESS" ? "brand" : "outline";
  return <Badge variant={variant}>{SETUP_REQUEST_STATUS[status].label}</Badge>;
}
