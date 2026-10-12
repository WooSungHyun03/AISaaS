"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { updateShortsPublishing } from "@/app/(app)/shorts/publishing-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { instagramCaption, normalizeShortsPublishing, shortsPublishingText, youtubeMetadata, type ShortsPublishing } from "@/server/shorts/publishing-metadata";

interface Draft {
  title: string;
  alt: [string, string, string];
  description: string;
  keywords: string;
  hashtags: string;
  callToAction: string;
  summary: string;
  youtubeTitle: string;
  instagramHook: string;
}

function toDraft(meta: ShortsPublishing): Draft {
  return {
    title: meta.title,
    alt: [meta.alternativeTitles[0] ?? "", meta.alternativeTitles[1] ?? "", meta.alternativeTitles[2] ?? ""],
    description: meta.description,
    keywords: meta.keywords.join(", "),
    hashtags: meta.hashtags.map((tag) => `#${tag}`).join(" "),
    callToAction: meta.callToAction,
    summary: meta.summary,
    youtubeTitle: meta.youtubeTitle,
    instagramHook: meta.instagramHook,
  };
}

function fromDraft(draft: Draft, source: ShortsPublishing["source"]) {
  return normalizeShortsPublishing({
    source,
    title: draft.title,
    alternativeTitles: draft.alt.filter((item) => item.trim()),
    description: draft.description,
    keywords: draft.keywords.split(/[,\n]/).map((item) => item.trim()),
    hashtags: draft.hashtags.split(/[\s,]+/),
    callToAction: draft.callToAction,
    summary: draft.summary,
    youtubeTitle: draft.youtubeTitle,
    instagramHook: draft.instagramHook,
  });
}

/**
 * The text that goes with a finished Short: title, alternative titles, description, keywords, hashtags and a call to
 * action — each with a copy button, all editable. What is saved here is what "지금 게시" sends to YouTube and Instagram.
 */
export function ShortsPublishingPanel({ contentId, original, saved, link }: { contentId: string | null; original: ShortsPublishing; saved: ShortsPublishing | null; link: string | null }) {
  const [current, setCurrent] = useState<ShortsPublishing>(saved ?? original);
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved ?? original));
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = useMemo(() => fromDraft(draft, current.source), [draft, current.source]);
  const live = parsed.ok ? parsed.value : current;
  const dirty = !parsed.ok || JSON.stringify(parsed.value) !== JSON.stringify(current);
  const youtube = useMemo(() => youtubeMetadata(live, link), [live, link]);
  const instagram = useMemo(() => instagramCaption(live), [live]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((previous) => ({ ...previous, [key]: value }));

  async function copy(key: string, value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      toast.success(message);
      window.setTimeout(() => setCopied(null), 1_800);
    } catch {
      toast.error("복사하지 못했어요. 브라우저의 복사 권한을 확인해주세요.");
    }
  }

  const renderCopy = (id: string, value: string, label: string) => (
    <Button type="button" variant="ghost" size="sm" onClick={() => copy(id, value, `${label}을(를) 복사했어요.`)} aria-label={`${label} 복사`}>
      {copied === id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}복사
    </Button>
  );

  function save() {
    setError("");
    if (!contentId) return;
    if (!parsed.ok) { setError(parsed.error); return; }
    startTransition(async () => {
      try {
        const result = await updateShortsPublishing(contentId, parsed.value);
        if (result.error || !result.value) { setError(result.error ?? "저장하지 못했어요."); return; }
        setCurrent(result.value);
        setDraft(toDraft(result.value));
        toast.success("게시용 제목과 설명을 저장했어요. 게시할 때 이 내용이 사용돼요.");
      } catch {
        setError("저장하지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  const field = "space-y-1.5";
  return (
    <section aria-labelledby="shorts-publishing-title" className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="shorts-publishing-title" className="text-lg font-extrabold tracking-[-0.03em]">게시용 제목·설명</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">만들어진 영상의 대본과 장면을 바탕으로 썼어요. 직접 고칠 수 있고, 저장한 내용이 게시할 때 그대로 쓰여요.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={current.source === "ai" ? "brand" : "secondary"}>{current.source === "ai" ? "AI가 영상 내용으로 작성" : "영상 대본에서 자동 구성"}</Badge>
          {renderCopy("all", shortsPublishingText(live), "전체 게시 정보")}
        </div>
      </div>

      <div className={field}>
        <div className="flex items-center justify-between"><Label htmlFor="sp-title">영상 제목</Label>{renderCopy("title", draft.title, "제목")}</div>
        <Input id="sp-title" value={draft.title} onChange={(event) => set("title", event.target.value)} maxLength={100} disabled={pending} />
      </div>

      <div className={field}>
        <p className="text-sm font-semibold">대체 제목 (마음에 드는 것으로 바꿔 쓰세요)</p>
        {draft.alt.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input aria-label={`대체 제목 ${index + 1}`} value={value} onChange={(event) => set("alt", draft.alt.map((item, position) => (position === index ? event.target.value : item)) as Draft["alt"])} maxLength={100} disabled={pending} />
            <Button type="button" variant="outline" size="sm" disabled={pending || !value.trim()} onClick={() => set("title", value)}>제목으로 쓰기</Button>
            {renderCopy(`alt${index}`, value, `대체 제목 ${index + 1}`)}
          </div>
        ))}
      </div>

      <div className={field}>
        <div className="flex items-center justify-between"><Label htmlFor="sp-description">영상 설명 (게시글)</Label>{renderCopy("description", draft.description, "영상 설명")}</div>
        <Textarea id="sp-description" value={draft.description} onChange={(event) => set("description", event.target.value)} rows={5} maxLength={1_500} disabled={pending} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className={field}>
          <div className="flex items-center justify-between"><Label htmlFor="sp-keywords">핵심 키워드 (쉼표로 구분)</Label>{renderCopy("keywords", draft.keywords, "키워드")}</div>
          <Textarea id="sp-keywords" value={draft.keywords} onChange={(event) => set("keywords", event.target.value)} rows={2} disabled={pending} />
        </div>
        <div className={field}>
          <div className="flex items-center justify-between"><Label htmlFor="sp-hashtags">추천 해시태그</Label>{renderCopy("hashtags", draft.hashtags, "해시태그")}</div>
          <Textarea id="sp-hashtags" value={draft.hashtags} onChange={(event) => set("hashtags", event.target.value)} rows={2} disabled={pending} />
        </div>
      </div>

      <div className={field}>
        <div className="flex items-center justify-between"><Label htmlFor="sp-cta">행동 유도(CTA)</Label>{renderCopy("cta", draft.callToAction, "CTA")}</div>
        <Input id="sp-cta" value={draft.callToAction} onChange={(event) => set("callToAction", event.target.value)} maxLength={120} disabled={pending} />
      </div>

      <div className={field}>
        <div className="flex items-center justify-between"><Label htmlFor="sp-summary">영상 내용 요약</Label>{renderCopy("summary", draft.summary, "영상 요약")}</div>
        <Textarea id="sp-summary" value={draft.summary} onChange={(event) => set("summary", event.target.value)} rows={2} maxLength={300} disabled={pending} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="space-y-2 rounded-xl bg-muted p-4" aria-label="YouTube Shorts에 들어갈 내용">
          <div className="flex items-center justify-between"><h4 className="text-sm font-bold">YouTube Shorts</h4>{renderCopy("yt", `${youtube.title}\n\n${youtube.description}`, "YouTube 제목·설명")}</div>
          <Label htmlFor="sp-yt-title" className="text-xs text-muted-foreground">제목 (검색에 잘 걸리게, 키워드를 앞에)</Label>
          <Input id="sp-yt-title" value={draft.youtubeTitle} onChange={(event) => set("youtubeTitle", event.target.value)} maxLength={100} disabled={pending} />
          <p className="whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">{youtube.description}</p>
          <p className="text-[12px] text-muted-foreground">태그(API) · {youtube.tags.join(", ")}</p>
        </article>
        <article className="space-y-2 rounded-xl bg-muted p-4" aria-label="Instagram Reels에 들어갈 내용">
          <div className="flex items-center justify-between"><h4 className="text-sm font-bold">Instagram Reels</h4>{renderCopy("ig", instagram, "Instagram 캡션")}</div>
          <Label htmlFor="sp-ig-hook" className="text-xs text-muted-foreground">캡션 첫 줄 (‘더 보기’ 전에 보이는 문장)</Label>
          <Input id="sp-ig-hook" value={draft.instagramHook} onChange={(event) => set("instagramHook", event.target.value)} maxLength={125} disabled={pending} />
          <p className="whitespace-pre-wrap text-[13px] leading-6 text-muted-foreground">{instagram}</p>
        </article>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">YouTube는 제목·설명·태그를, Instagram은 캡션 한 칸을 사용해요. 위 내용에서 각 플랫폼 형식으로 자동 구성돼요.</p>

      {error ? <FormMessage>{error}</FormMessage> : null}
      {!parsed.ok && !error ? <FormMessage variant="info">{parsed.error}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={pending || !contentId || !dirty || !parsed.ok}>{pending ? "저장하는 중…" : "수정 내용 저장"}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => { setDraft(toDraft(original)); setError(""); }}><RotateCcw aria-hidden="true" />AI가 쓴 처음 내용으로</Button>
        {!contentId ? <p className="self-center text-xs text-muted-foreground">이 영상은 저장 기록이 없어 수정할 수 없어요.</p> : null}
      </div>
    </section>
  );
}
