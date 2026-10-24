import Link from "next/link";
import { Download, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteShortsButton } from "@/components/shorts/library-controls";
import { ShortsThumb } from "@/components/shorts/library-media";
import { formatShortsDate, formatShortsDuration, shortsDownloadHref } from "@/lib/shorts-format";
import type { ShortsLibraryItem, ShortsVideoState } from "@/server/shorts/library";

export const VIDEO_STATE_LABEL: Record<ShortsVideoState, { label: string; variant: "success" | "warning" | "secondary" | "destructive"; hint: string }> = {
  STORED: { label: "저장됨", variant: "success", hint: "내 보관함에 영구 저장된 영상이에요." },
  EXTERNAL: { label: "임시 링크", variant: "warning", hint: "예전 방식으로 만든 영상이에요. 원본 링크가 만료되면 볼 수 없어요." },
  SAMPLE: { label: "샘플", variant: "secondary", hint: "테스트용 샘플 영상이에요. 실제 광고 영상이 아니에요." },
  UNAVAILABLE: { label: "복구 불가", variant: "destructive", hint: "영상 파일을 찾을 수 없어요." },
};

/** One video of the library: its first frame, name, date, length, status, and the things the owner does with it. */
export function ShortsLibraryCard({ item }: { item: ShortsLibraryItem }) {
  const state = VIDEO_STATE_LABEL[item.state];
  const playable = item.state === "STORED" || item.state === "EXTERNAL";
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <Link href={`/shorts/${item.id}`} className="block focus-visible:outline-2 focus-visible:outline-ring" aria-label={`${item.title} 상세 보기`}>
        <ShortsThumb contentId={item.id} playable={playable} title={item.title} className="max-h-[360px]" />
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={state.variant} title={state.hint}>{state.label}</Badge>
          {item.edited ? <Badge variant="outline">수정됨</Badge> : null}
        </div>
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-[15px] font-bold leading-6 tracking-[-0.02em] [overflow-wrap:anywhere]">
            <Link href={`/shorts/${item.id}`} className="hover:underline">{item.title}</Link>
          </h3>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            {item.businessName ? <span>{item.businessName} · </span> : null}
            {formatShortsDate(item.createdAt)}
            {item.durationSec ? <span> · {formatShortsDuration(item.durationSec)}</span> : null}
          </p>
          {item.topic ? <p className="mt-1 line-clamp-1 text-[13px] text-muted-foreground">{item.topic}</p> : null}
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <Button asChild size="sm"><Link href={`/shorts/${item.id}`}><Eye aria-hidden="true" /> 상세 보기</Link></Button>
          {item.state === "STORED" ? <Button asChild size="sm" variant="outline"><a href={shortsDownloadHref(item.id)}><Download aria-hidden="true" /> 다운로드</a></Button> : null}
          <DeleteShortsButton contentId={item.id} title={item.title} />
        </div>
      </div>
    </li>
  );
}
