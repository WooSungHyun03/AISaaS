import { Badge } from "@/components/ui/badge";
import { INQUIRY_STATUS_LABEL, type InquiryStatus } from "@/types/inquiries";

const VARIANT = { RECEIVED: "secondary", IN_REVIEW: "warning", ANSWERED: "success", CLOSED: "outline" } as const;

export function InquiryStatusBadge({ status }: { status: InquiryStatus }) {
  return <Badge variant={VARIANT[status]}>{INQUIRY_STATUS_LABEL[status]}</Badge>;
}
