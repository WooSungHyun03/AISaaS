import { CircleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RediagnoseChannelButton } from "@/components/channels/rediagnose-channel-button";
import { PLATFORM_LABEL } from "@/server/channels/platform";
import type { ChannelDiagnosisSummaryItem } from "@/server/channels";

function ScoreStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="tabular text-lg font-bold">{value === null ? "측정 불가" : `${value}점`}</p>
    </div>
  );
}

/**
 * 채널 하나의 진단 카드 — CHANNEL_DASHBOARD_API.md의 가이드대로
 * completeness !== "COMPLETE"면 "데이터 부족" 배지, dataSource === "mock"이면
 * "샘플 데이터" 배지를 보여준다. findings는 그대로 전부 나열하는데, 네이버/티스토리의
 * "콘텐츠 점수 측정 불가" 사유, 네이버의 검색 한계 안내(NAVER_SEARCH_LIMITATION_NOTICE),
 * 티스토리의 "최근 30개 글 기준" 관측 한계가 모두 findings에 이미 들어있어서
 * 플랫폼별 한계 안내를 따로 하드코딩하지 않아도 빠짐없이 보인다.
 */
export function ChannelDiagnosisCard({ item, narrative }: { item: ChannelDiagnosisSummaryItem; narrative: string }) {
  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold">{PLATFORM_LABEL[item.channel]}</h3>
          {item.completeness !== "COMPLETE" ? <Badge variant="warning">데이터 부족</Badge> : null}
          {item.dataSource === "mock" ? <Badge variant="secondary">샘플 데이터</Badge> : null}
        </div>
        <RediagnoseChannelButton channelId={item.channelId} />
      </div>
      <p className="break-all text-[13px] text-muted-foreground">{item.url}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ScoreStat label="전체" value={item.overallScore} />
        <ScoreStat label="활동성" value={item.activityScore} />
        <ScoreStat label="꾸준함" value={item.consistencyScore} />
        <ScoreStat label="콘텐츠" value={item.contentScore} />
      </div>

      <p className="text-[15px] leading-7">{narrative}</p>

      {item.findings.length > 0 ? (
        <ul className="space-y-1.5 text-[13px] leading-5 text-muted-foreground">
          {item.findings.map((finding, index) => (
            <li key={index} className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{finding}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {item.recommendations.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold">먼저 해볼 일</h4>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[14px] leading-6">
            {item.recommendations.map((recommendation, index) => <li key={index}>{recommendation}</li>)}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
