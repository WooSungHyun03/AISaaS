import { Headset } from "lucide-react";
import { INQUIRY_STATUS_LABEL, type InquiryMessageView } from "@/types/inquiries";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Answers and status changes of one inquiry in time order. Text is rendered as text (React escapes it). */
export function InquiryThread({ messages }: { messages: InquiryMessageView[] }) {
  if (messages.length === 0) return <p className="text-sm text-muted-foreground">아직 답변이 없어요. 확인하는 대로 이곳에 남겨드려요.</p>;
  return (
    <ol className="space-y-3">
      {messages.map((message) =>
        message.kind === "REPLY" ? (
          <li key={message.id} className="rounded-xl bg-brand-soft px-4 py-3">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-primary"><Headset className="size-3.5" aria-hidden="true" />이지 마케팅 답변<span className="tabular font-normal text-muted-foreground">· {dateFormat.format(new Date(message.createdAt))}</span></p>
            <p className="mt-1.5 whitespace-pre-line text-[15px] leading-7">{message.body}</p>
          </li>
        ) : (
          <li key={message.id} className="text-[13px] text-muted-foreground">
            <span className="tabular">{dateFormat.format(new Date(message.createdAt))}</span> · 상태가 ‘{message.toStatus ? INQUIRY_STATUS_LABEL[message.toStatus] : ""}’(으)로 바뀌었어요
          </li>
        ),
      )}
    </ol>
  );
}
