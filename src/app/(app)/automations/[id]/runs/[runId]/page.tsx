import { notFound, redirect } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAutomationRunDetail } from "@/server/automations/history";
import { describeAutomationRunError } from "@/server/shared/errors";
import { RunSourceBadge, RunStatusBadge } from "@/components/automations/run-badges";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/layout/page-header";
import { Mascot } from "@/components/brand/mascot";
import { ContentEditor } from "@/components/automations/content-editor";
import { BlogWorkspace } from "@/components/automations/blog-workspace";
import { RunProgress } from "@/components/automations/run-progress";
import { looksLikeBlogMarkup } from "@/server/blog/markup";
import { blogGuideContext } from "@/server/blog/guide-context";
import { ShortsPublishingPanel } from "@/components/automations/shorts-publishing-panel";
import { shortsPublishingSchema } from "@/server/shorts/publishing-metadata";
import { blogSetupSchema } from "@/types/blog-automation";
import { parseShortsSettings } from "@/types/shorts-reference";
import { createAdminClient } from "@/lib/supabase/admin";
import { VIDEO_BUCKET, isOwnedAssetPath, signAsset } from "@/server/shorts/assets";
import { promotionFieldValue } from "@/lib/promotion";

const formatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

function formatDate(value: string | null, fallback = "-") {
  return value ? formatter.format(new Date(value)) : fallback;
}

function durationLabel(startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) return "-";
  const seconds = Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}분 ${seconds % 60}초`;
}

export default async function RunDetailPage({ params }: PageProps<"/automations/[id]/runs/[runId]">) {
  const { id, runId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const detail = await getAutomationRunDetail(user.id, id, runId);
  if (!detail) notFound();
  const { automation, run } = detail;
  const output = run.output;
  // The user's working copy of a generated post (null for runs that saved no text, e.g. a Shorts preview).
  const { data: workingCopy } = run.status === "SUCCESS" && (output?.body || output?.shortsPublishing)
    ? await supabase.from("content_history").select("id,title,content,edited_at,publishing").eq("run_id", run.id).maybeSingle()
    : { data: null };
  // What the blog guide and the Shorts posting text are built around (profile, setup, images already uploaded).
  const guideInputs = run.status === "SUCCESS" && (output?.publishingGuide || (output?.body && output.platform !== undefined && workingCopy?.content && looksLikeBlogMarkup(workingCopy.content)))
    ? await Promise.all([
      supabase.from("businesses").select("name,industry,location,brand_tone,keywords,promotion_type,website,promotion_details").eq("id", automation.business_id).maybeSingle(),
      supabase.from("automations").select("config").eq("user_id", user.id).eq("business_id", automation.business_id).limit(20),
    ])
    : null;
  const guideBusiness = guideInputs?.[0].data ?? null;
  const parsedBlogConfig = blogSetupSchema.safeParse(automation.config);
  const ownedImages = (guideInputs?.[1].data ?? [])
    .flatMap((row) => parseShortsSettings(row.config).assets)
    .filter((asset) => asset.kind === "image" && asset.origin === "upload" && asset.label)
    .slice(0, 10)
    .map((asset) => ({ label: asset.label, subject: asset.role ?? "other" }));
  const blogContext = guideBusiness
    ? blogGuideContext(guideBusiness, { platform: output?.platform ?? (parsedBlogConfig.success ? parsedBlogConfig.data.platform : undefined), keywords: parsedBlogConfig.success ? parsedBlogConfig.data.keywords : [] }, ownedImages)
    : null;
  const editedShortsPublishing = shortsPublishingSchema.safeParse(workingCopy?.publishing);
  // An ad video lives in private Storage: sign a fresh address for this page view. Older videos kept a public address.
  const videoUrl = output?.videoPath && isOwnedAssetPath(output.videoPath, user.id, automation.id)
    ? await signAsset(createAdminClient(), VIDEO_BUCKET, output.videoPath, 60 * 60).catch(() => null)
    : output?.videoUrl ?? null;
  const field = "bg-card px-5 py-4";
  const label = "text-[13px] font-semibold text-muted-foreground";

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        back={{ href: `/automations/${automation.id}`, label: automation.name }}
        title="만든 결과"
        description={<span className="flex flex-wrap items-center gap-2"><RunStatusBadge status={run.status} /><RunSourceBadge source={run.source} /><span>{formatDate(run.createdAt)}</span></span>}
      />

      {run.status === "FAILED" ? (
        <FormMessage>
          <strong className="block">만들지 못했어요</strong>
          {describeAutomationRunError(run.errorMessage)}
          <span className="mt-1 block text-[13px] opacity-90">연결 정보와 설정을 확인하고 다시 만들어보세요. 계속되면 아래 번호와 함께 문의해주세요.</span>
        </FormMessage>
      ) : null}

      {run.status === "RUNNING" || run.status === "QUEUED" ? (
        <div role="status" className="flex items-center gap-4 rounded-2xl bg-brand-soft px-6 py-5">
          <Mascot pose="cheer" size={72} className="mascot-bob shrink-0" />
          <div>
            <p className="flex items-center gap-2 font-bold"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{run.status === "RUNNING" ? "콘텐츠를 만드는 중이에요" : "순서를 기다리고 있어요"}</p>
            <p className="mt-1 text-sm text-muted-foreground">이 화면을 열어두면 끝났을 때 자동으로 결과가 나타나요. 닫아도 계속 만들어져요.</p>
          </div>
          {run.status === "RUNNING" ? <RunProgress automationId={automation.id} /> : null}
        </div>
      ) : null}

      {run.status === "SUCCESS" ? (
        <section aria-labelledby="result-heading" className="space-y-5">
          <h2 id="result-heading" className="text-lg font-extrabold tracking-[-0.03em]">결과</h2>
          {!output ? <p className="rounded-2xl bg-muted px-5 py-6 text-[15px] text-muted-foreground">이번에는 보여줄 결과가 없어요.</p> : (
            <div className="space-y-6 rounded-2xl border bg-card px-5 py-6 sm:px-8">
              {workingCopy?.content && looksLikeBlogMarkup(workingCopy.content) ? (
                <BlogWorkspace contentId={workingCopy.id} title={workingCopy.title ?? output.title ?? ""} markup={workingCopy.content} editedAt={workingCopy.edited_at} platform={output.platform ?? "naver"} notes={output.qualityNotes} guide={output.publishingGuide} guideContext={blogContext ?? blogGuideContext({ name: automation.name, industry: null, location: null, brand_tone: null, keywords: output.keywords, promotion_type: null }, { platform: output.platform ?? "naver", keywords: output.keywords }, ownedImages)} />
              ) : workingCopy?.content ? (
                <ContentEditor contentId={workingCopy.id} title={workingCopy.title ?? output.title ?? ""} content={workingCopy.content} editedAt={workingCopy.edited_at} />
              ) : output.title ? <div><p className={label}>제목</p><p className="mt-1 text-xl font-extrabold leading-8 tracking-[-0.03em]">{output.title}</p></div> : null}
              {output.topic ? <div><p className={label}>주제</p><p className="mt-1 text-[15px] leading-7">{output.topic}</p></div> : null}
              {output.hook && !(workingCopy?.content && looksLikeBlogMarkup(workingCopy.content)) ? <div><p className={label}>도입부 후킹 문장</p><p className="mt-1 text-[15px] leading-7">{output.hook}</p></div> : null}
              {output.summary && !(workingCopy?.content && looksLikeBlogMarkup(workingCopy.content)) ? <div><p className={label}>요약</p><p className="mt-1 whitespace-pre-wrap text-[15px] leading-7">{output.summary}</p></div> : null}
              {output.body && !workingCopy?.content ? (
                <div>
                  <p className={label}>본문</p>
                  <div className="mt-2 max-h-[520px] overflow-y-auto rounded-xl bg-muted px-5 py-4 text-[15px] leading-8 whitespace-pre-wrap">{output.body}</div>
                </div>
              ) : null}
              {output.imageSuggestion && !(workingCopy?.content && looksLikeBlogMarkup(workingCopy.content)) ? <div><p className={label}>이미지 제안</p><p className="mt-1 text-[15px] leading-7">{output.imageSuggestion}</p></div> : null}
              {output.callToAction ? <div><p className={label}>행동 유도 문구</p><p className="mt-1 text-[15px] leading-7">{output.callToAction}</p></div> : null}
              {output.keywords.length ? <div><p className={label}>키워드</p><div className="mt-2 flex flex-wrap gap-1.5">{output.keywords.map((keyword) => <Badge key={keyword} variant="brand">{keyword}</Badge>)}</div></div> : null}
              {output.seoKeywords.length ? <div><p className={label}>SEO 키워드</p><div className="mt-2 flex flex-wrap gap-1.5">{output.seoKeywords.map((keyword) => <Badge key={keyword} variant="secondary">{keyword}</Badge>)}</div></div> : null}
              {videoUrl ? <div><p className={label}>영상 미리보기</p><video src={videoUrl} controls preload="metadata" playsInline className="mt-2 aspect-[9/16] max-h-[620px] w-full rounded-2xl bg-black object-contain" aria-label="생성된 숏폼 영상 미리보기">브라우저에서 영상 재생을 지원하지 않습니다.</video>{output.sampleVideo ? null : <a href={videoUrl} download target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-primary underline underline-offset-2">영상 파일 다운로드</a>}</div> : null}
              {output.shortsPublishing && videoUrl ? (
                <ShortsPublishingPanel
                  key={run.id}
                  contentId={workingCopy?.id ?? null}
                  original={output.shortsPublishing}
                  saved={editedShortsPublishing.success ? editedShortsPublishing.data : null}
                  link={guideBusiness ? promotionFieldValue(guideBusiness as never, "actionUrl") ?? promotionFieldValue(guideBusiness as never, "website") : null}
                />
              ) : null}
              {output.caption && !output.shortsPublishing ? <div><p className={label}>게시 문구</p><p className="mt-1 whitespace-pre-wrap text-[15px] leading-7">{output.caption}</p></div> : null}
              {output.qa ? <div><p className={label}>품질 점검 · 직접 확인해 주세요</p><div className="mt-2 space-y-1 rounded-xl bg-muted px-4 py-3 text-sm leading-6">{output.qa.summary ? <p>{output.qa.summary}</p> : null}{[...output.qa.findings.filter((finding) => finding.severity === "warn").map((finding) => finding.message), ...output.qa.notes].map((message, index) => <p key={`${index}-${message}`} className="text-muted-foreground">· {message}</p>)}{output.qa.aiChecked ? null : <p className="text-muted-foreground">· AI 화면 점검을 하지 못했어요.</p>}</div></div> : null}
              {output.scenes.length ? <div><p className={label}>장면 구성</p><ol className="mt-2 space-y-2">{output.scenes.map((scene, index) => <li key={`${index}-${scene.text}`} className="flex gap-3 rounded-xl bg-muted px-4 py-3 text-sm"><span className="font-bold text-primary">{index + 1}</span><span className="flex-1">{scene.text}</span><span className="text-muted-foreground">{scene.durationSec}초</span></li>)}</ol></div> : null}
              {Object.keys(output.publicationResults).length ? <div><p className={label}>플랫폼 게시 결과</p><ul className="mt-2 space-y-2">{Object.entries(output.publicationResults).map(([platform, result]) => result ? <li key={platform} className="flex flex-wrap items-center gap-2 rounded-xl bg-success-soft px-4 py-3 text-sm"><Badge variant="success">{platform === "youtube" ? "YouTube Shorts" : "Instagram Reels"}</Badge><span className="min-w-0 flex-1 break-all">ID {result.externalId ?? "확인 중"}{result.privacy === "private" ? " · 비공개" : ""}</span>{result.externalUrl ? <a href={result.externalUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline underline-offset-2">열기</a> : null}</li> : null)}</ul></div> : null}
            </div>
          )}
          {videoUrl ? null : (
            <p className="text-sm text-muted-foreground">이지 마케팅에 저장돼 있어요. 본문을 복사해서 직접 올려주세요.</p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="info-heading" className="space-y-3">
        <h2 id="info-heading" className="text-lg font-extrabold tracking-[-0.03em]">진행 정보</h2>
        <dl className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3">
          <div className={field}><dt className={label}>시작</dt><dd className="tabular mt-1 font-medium">{formatDate(run.startedAt, "대기 중")}</dd></div>
          <div className={field}><dt className={label}>완료</dt><dd className="tabular mt-1 font-medium">{formatDate(run.completedAt, run.status === "RUNNING" ? "만드는 중" : "-")}</dd></div>
          <div className={field}><dt className={label}>걸린 시간</dt><dd className="mt-1 font-medium">{durationLabel(run.startedAt, run.completedAt)}</dd></div>
          <div className={`${field} sm:col-span-3`}><dt className={label}>문의용 번호</dt><dd className="mt-1 break-all font-mono text-xs text-muted-foreground">{run.id}</dd></div>
        </dl>
      </section>
    </div>
  );
}
