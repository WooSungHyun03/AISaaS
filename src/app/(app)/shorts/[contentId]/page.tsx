import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert, Download, Plus } from "lucide-react";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { ShortsPublishingPanel } from "@/components/automations/shorts-publishing-panel";
import { UsedReferences } from "@/components/automations/used-references";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { VIDEO_STATE_LABEL } from "@/components/shorts/library-card";
import { ArchiveLegacyButton, DeleteShortsButton, ShortsTitleEditor } from "@/components/shorts/library-controls";
import { ShortsPlayer } from "@/components/shorts/library-media";
import { formatShortsDate, formatShortsDuration, formatShortsSize, shortsDownloadHref } from "@/lib/shorts-format";
import { promotionFieldValue } from "@/lib/promotion";
import { toSafeAutomationRunOutput } from "@/server/automations/run-output";
import { usedReferenceViews } from "@/server/shorts/asset-views";
import { getShortsContent, ownsVideoPath, videoFileExists } from "@/server/shorts/library";
import { externalVideoReachable } from "@/server/shorts/library-archive";
import { shortsPublishingSchema } from "@/server/shorts/publishing-metadata";

export const metadata: Metadata = { title: "영상 상세" };

function generationOf(output: unknown): { model: string | null; resolution: string | null } {
  const raw = output && typeof output === "object" && !Array.isArray(output) ? (output as Record<string, unknown>).generation : null;
  const generation = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { model: typeof generation.model === "string" ? generation.model : null, resolution: typeof generation.resolution === "string" ? generation.resolution : null };
}

export default async function ShortsContentPage({ params }: PageProps<"/shorts/[contentId]">) {
  const { contentId } = await params;
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const content = await getShortsContent(supabase, contentId);
  if (!content) notFound();

  const safe = toSafeAutomationRunOutput(content.output);
  // What the file really is right now: a stored path is checked in Storage, an old hosted link is probed.
  const { source } = content;
  const storedPath = source.state === "STORED" && source.path && ownsVideoPath(source.path, user.id, content.automationId) ? source.path : null;
  const [fileThere, linkAlive, businessResult, references] = await Promise.all([
    storedPath ? videoFileExists(storedPath) : Promise.resolve(false),
    source.state === "EXTERNAL" && source.externalUrl ? externalVideoReachable(source.externalUrl) : Promise.resolve(false),
    supabase.from("businesses").select("*").eq("id", content.businessId).maybeSingle(),
    safe && safe.references.length > 0 ? usedReferenceViews(safe.references, user.id, content.automationId).catch(() => null) : Promise.resolve(null),
  ]);
  const business = businessResult.data;
  const playable = (storedPath !== null && fileThere) || (source.state === "EXTERNAL" && linkAlive);
  const lost = source.state === "UNAVAILABLE" || (source.state === "STORED" && !fileThere) || (source.state === "EXTERNAL" && !linkAlive);
  const label = VIDEO_STATE_LABEL[lost ? "UNAVAILABLE" : source.state];
  const original = shortsPublishingSchema.safeParse(safe?.shortsPublishing);
  const edited = shortsPublishingSchema.safeParse(content.publishing);
  const generation = generationOf(content.output);
  const meta: Array<[string, string]> = [
    ["만든 날짜", formatShortsDate(content.createdAt)],
    ["영상 길이", formatShortsDuration(content.durationSec)],
    ["파일 크기", formatShortsSize(content.bytes)],
    ...(generation.resolution ? [["화질", `${generation.resolution} · 세로형 9:16`] as [string, string]] : []),
    ...(business ? [["홍보 대상", business.name] as [string, string]] : []),
    ...(content.topic ? [["주제", content.topic] as [string, string]] : []),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        back={{ href: "/shorts/library", label: "내 영상" }}
        title="영상 상세"
        description="다시 보고, 내려받고, 게시용 문구를 복사할 수 있어요. 보거나 내려받는다고 AI 제작 이용권이 줄지 않아요."
        actions={
          <>
            <Button asChild variant="outline"><Link href="/shorts"><Plus aria-hidden="true" /> 새 영상 만들기</Link></Button>
            {source.state === "STORED" && playable ? <Button asChild><a href={shortsDownloadHref(content.id)}><Download aria-hidden="true" /> MP4 다운로드</a></Button> : null}
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <section aria-label="영상" className="space-y-3">
          {playable ? <ShortsPlayer contentId={content.id} title={content.title} /> : (
            <div role="status" className="flex aspect-[9/16] w-full max-w-sm flex-col items-center justify-center gap-3 rounded-2xl bg-muted px-6 text-center text-sm text-muted-foreground">
              <CircleAlert className="size-8" aria-hidden="true" />
              <p className="font-semibold text-foreground">{source.state === "SAMPLE" ? "테스트용 샘플 영상이에요" : "영상 파일을 불러올 수 없어요"}</p>
              <p>{source.state === "SAMPLE" ? "실제 영상 제작 서비스가 연결되지 않은 상태에서 만든 샘플이라 재생·다운로드를 지원하지 않아요." : "저장된 영상 파일이 없어 복구할 수 없어요. 아래 문구는 그대로 쓸 수 있어요."}</p>
            </div>
          )}
          {source.state === "EXTERNAL" && linkAlive ? (
            <div className="max-w-sm space-y-2">
              <FormMessage variant="info">예전 방식으로 만든 영상이라 원본 링크로 재생하고 있어요. 링크가 만료되기 전에 보관함에 저장해 두세요.</FormMessage>
              <ArchiveLegacyButton contentId={content.id} />
            </div>
          ) : null}
        </section>

        <section aria-label="영상 정보" className="min-w-0 space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5"><Badge variant={label.variant}>{label.label}</Badge>{content.editedAt ? <Badge variant="outline">수정됨</Badge> : null}</div>
            <ShortsTitleEditor contentId={content.id} title={content.title} />
            <p className="text-[13px] text-muted-foreground">{label.hint}</p>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-2xl border bg-card px-5 py-4 text-sm">
            {meta.map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="font-semibold text-muted-foreground">{term}</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>

          {safe?.voiceFallback ? <p className="text-[13px] text-muted-foreground">영상 속 음성이 부족해 한국어 음성을 추가했어요.</p> : null}
          {safe?.qa ? (
            <div>
              <p className="text-[13px] font-semibold text-muted-foreground">품질 점검 · 게시 전에 직접 확인해 주세요</p>
              <div className="mt-2 space-y-1 rounded-xl bg-muted px-4 py-3 text-sm leading-6">
                {safe.qa.summary ? <p>{safe.qa.summary}</p> : null}
                {[...safe.qa.findings.filter((finding) => finding.severity === "warn").map((finding) => finding.message), ...safe.qa.notes].map((message, index) => <p key={`${index}-${message}`} className="text-muted-foreground">· {message}</p>)}
              </div>
            </div>
          ) : null}
          {references && references.length > 0 ? <UsedReferences references={references} /> : null}
          {content.script ? (
            <div>
              <p className="text-[13px] font-semibold text-muted-foreground">영상 대본</p>
              <p className="mt-1 whitespace-pre-wrap rounded-xl bg-muted px-4 py-3 text-[15px] leading-7">{content.script}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 border-t pt-5">
            <DeleteShortsButton contentId={content.id} title={content.title} redirectTo="/shorts/library" />
          </div>
        </section>
      </div>

      {original.success ? (
        <ShortsPublishingPanel
          key={content.id}
          contentId={content.id}
          original={original.data}
          saved={edited.success ? edited.data : null}
          link={business ? promotionFieldValue(business, "actionUrl") ?? promotionFieldValue(business, "website") : null}
        />
      ) : null}
    </div>
  );
}
