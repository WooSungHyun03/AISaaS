import { Badge } from "@/components/ui/badge";
import { SETUP_REQUEST_STATUS } from "@/types/setup-request";
import type { SetupRequestStatus } from "@/types/domain";

export function SetupRequestStatusBadge({ status }: { status: SetupRequestStatus }) {
  const variant = status === "COMPLETED" ? "secondary" : status === "CANCELLED" ? "destructive" : status === "IN_PROGRESS" ? "default" : "outline";
  return (
    <Badge variant={variant} className={status === "IN_PROGRESS" ? "bg-blue-600 text-white" : ""}>
      <span className={`size-1.5 rounded-full ${status === "COMPLETED" ? "bg-emerald-600" : status === "CANCELLED" ? "bg-red-600" : "bg-blue-600"}`} />
      {SETUP_REQUEST_STATUS[status].label}
    </Badge>
  );
}
