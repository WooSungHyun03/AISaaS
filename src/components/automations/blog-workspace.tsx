"use client";

import { useMemo, useState, useTransition } from "react";
import { Camera, Check, Copy, Code2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateContentHistory } from "@/app/(app)/blog/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { markupToPost } from "@/server/blog/markup";
import { BLOG_PLATFORM_LABEL, countCharsNoSpaces, postBodyText } from "@/server/blog/post";
import { renderBlogHtml, renderBlogText } from "@/server/blog/render";
import {
  buildImagePlacements,
  buildPublishingGuide,
  formatTags,
  fullPublishingGuideText,
  imageGuideText,
  recommendedImageCount,
  seoGuideText,
  styleGuideText,
  themeFromStyle,
  type BlogGuideContext,
  type BlogPublishingGuide,
  type BlogStyleGuide,
  type TextStyle,
} from "@/server/blog/publishing-guide";
import { cn } from "@/lib/utils";

type Target = "naver" | "tistory";

const MARKUP_HELP = [
  ["## 🥐 소제목", "소제목(새 부분이 시작돼요)"],
  ["**굵게**  ==형광펜==", "문장 안에서 강조"],
  ["> 한 줄 인용구", "눈에 띄는 인용 상자"],
  ["[포인트] 💡 꿀팁 | 내용", "포인트 박스"],
  ["[사진] 어떤 사진 | 설명", "사진 자리"],
  ["- 항목 / ✔ 항목 / 1. 항목", "목록 (줄마다)"],
  ["[정보] 위치 | 서울 …", "업체 정보 칸"],
  ["---", "구분선"],
  ["#태그 #태그", "맨 아래 해시태그"],
] as const;

async function copyRich(html: string, text: string): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(text);
}

/** 블로그 글을 서식 그대로 미리 보고, 네이버·티스토리용으로 복사하고, 고칠 수 있는 작업 공간. */
export function BlogWorkspace({
  contentId,
  title,
  markup,
  editedAt,
  platform,
  notes,
  guide,
  guideContext,
}: {
  contentId: string;
  title: string;
  markup: string;
  editedAt: string | null;
  platform: Target;
  notes: string[];
  /** Style, photo notes and SEO stored with the run; null for posts made before the guide existed (built from rules then). */
  guide: BlogPublishingGuide | null;
  guideContext: BlogGuideContext;
}) {
  const [saved, setSaved] = useState({ title, markup, editedAt });
  const [target, setTarget] = useState<Target>(platform);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftMarkup, setDraftMarkup] = useState(markup);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [styled, setStyled] = useState(true);

  const post = useMemo(() => markupToPost(saved.markup), [saved.markup]);
  // An older post has no stored guide: one is built from the post and the profile so the tabs still work.
  const effectiveGuide = useMemo(() => guide ?? buildPublishingGuide(post, guideContext), [guide, post, guideContext]);
  const theme = useMemo(() => themeFromStyle(effectiveGuide.style), [effectiveGuide]);
  const html = useMemo(() => renderBlogHtml(post, target, styled ? theme : undefined), [post, target, styled, theme]);
  const placements = useMemo(() => buildImagePlacements(post, effectiveGuide.images, guideContext), [post, effectiveGuide, guideContext]);
  const photos = placements;
  const chars = useMemo(() => countCharsNoSpaces(postBodyText(post)), [post]);

  async function copy(kind: string, action: () => Promise<void>, message: string) {
    try {
      await action();
      setCopied(kind);
      toast.success(message);
      window.setTimeout(() => setCopied(null), 2_000);
    } catch {
      toast.error("복사하지 못했어요. 브라우저의 복사 권한을 확인해주세요.");
    }
  }

  function save() {
    setError("");
    const form = new FormData();
    form.set("title", draftTitle);
    form.set("content", draftMarkup);
    startTransition(async () => {
      try {
        const result = await updateContentHistory(contentId, form);
        if (result.error) {
          setError(result.error);
          return;
        }
        setSaved({ title: draftTitle.trim(), markup: draftMarkup.trim(), editedAt: result.editedAt ?? new Date().toISOString() });
        setEditing(false);
        toast.success("수정한 글을 저장했어요.");
      } catch {
        setError("저장하지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  if (editing) {
    return (
      <div className="space-y-4" aria-describedby={error ? "blog-editor-error" : undefined}>
        <div className="space-y-2">
          <Label htmlFor="blog-title">제목</Label>
          <Input id="blog-title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} maxLength={200} disabled={pending} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="blog-markup">본문</Label>
          <Textarea id="blog-markup" value={draftMarkup} onChange={(event) => setDraftMarkup(event.target.value)} rows={28} maxLength={30_000} disabled={pending} className="font-mono text-[14px] leading-7" />
          <details className="rounded-xl bg-muted px-4 py-3 text-[13px] leading-6 text-muted-foreground">
            <summary className="cursor-pointer font-semibold text-foreground">글 서식 표기법</summary>
            <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {MARKUP_HELP.map(([syntax, meaning]) => <li key={syntax}><code className="rounded bg-background px-1.5 py-0.5 text-[12px] text-foreground">{syntax}</code> {meaning}</li>)}
            </ul>
            <p className="mt-2">문단 사이는 빈 줄로 나눠요. AI가 처음 만든 글은 이용내역에 그대로 남아 있어요.</p>
          </details>
        </div>
        {error ? <FormMessage id="blog-editor-error">{error}</FormMessage> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={pending}>{pending ? "저장하는 중…" : "수정 저장"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => { setEditing(false); setError(""); setDraftTitle(saved.title); setDraftMarkup(saved.markup); }}>취소</Button>
        </div>
      </div>
    );
  }

  const text = renderBlogText(post);
  const fullGuide = fullPublishingGuideText({ title: saved.title, post, guide: effectiveGuide, placements });
  const { style, seo } = effectiveGuide;
  const copyButton = (id: string, label: string, value: string, message: string, variant: "outline" | "spark" = "outline") => (
    <Button type="button" variant={variant} size="sm" onClick={() => copy(id, () => navigator.clipboard.writeText(value), message)}>
      {copied === id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{label}
    </Button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-muted-foreground">제목</p>
          <p className="mt-1 text-xl font-extrabold leading-8 tracking-[-0.03em]">{saved.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
            <Badge variant="brand">공백 제외 {chars.toLocaleString()}자</Badge>
            <Badge variant="secondary">소제목 {Math.max(0, post.sections.filter((section) => section.heading).length)}개</Badge>
            <Badge variant="secondary">사진 자리 {photos.length}곳</Badge>
            {saved.editedAt ? <span>· 내가 수정한 글이에요</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {copyButton("full", "전체 게시 가이드 복사", fullGuide, "제목·본문·스타일·이미지·태그를 한 번에 복사했어요.", "spark")}
          <Button type="button" size="sm" onClick={() => { setDraftTitle(saved.title); setDraftMarkup(saved.markup); setEditing(true); }}><Pencil aria-hidden="true" /> 고치기</Button>
        </div>
      </div>

      {notes.length > 0 ? (
        <details className="rounded-xl bg-muted px-4 py-3 text-[13px] leading-6 text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">AI가 확인한 점 {notes.length}가지</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </details>
      ) : null}

      <Tabs defaultValue="post" className="gap-4">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="post">완성된 글</TabsTrigger>
          <TabsTrigger value="style">편집 가이드</TabsTrigger>
          <TabsTrigger value="images">이미지 가이드</TabsTrigger>
          <TabsTrigger value="seo">SEO·태그</TabsTrigger>
        </TabsList>

        <TabsContent value="post" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="올릴 곳" className="inline-flex rounded-lg border p-0.5">
              {(Object.keys(BLOG_PLATFORM_LABEL) as Target[]).map((key) => (
                <button key={key} type="button" aria-pressed={target === key} onClick={() => setTarget(key)} className={cn("rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", target === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{BLOG_PLATFORM_LABEL[key]}</button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium"><input type="checkbox" checked={styled} onChange={(event) => setStyled(event.target.checked)} className="size-4 accent-primary" />추천 스타일로 보기·복사</label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="spark" size="sm" onClick={() => copy("rich", () => copyRich(html, text), `${BLOG_PLATFORM_LABEL[target]}에 붙여넣을 글을 복사했어요. 편집기에서 붙여넣기(Ctrl+V) 하세요.`)}>
              {copied === "rich" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}서식 그대로 복사
            </Button>
            {target === "tistory" ? (
              <Button type="button" variant="outline" size="sm" onClick={() => copy("html", () => navigator.clipboard.writeText(html), "HTML 코드를 복사했어요. 티스토리 글쓰기에서 ‘HTML’ 모드로 바꿔 붙여넣으세요.")}>
                {copied === "html" ? <Check aria-hidden="true" /> : <Code2 aria-hidden="true" />}HTML 코드 복사
              </Button>
            ) : null}
            {copyButton("title", "제목 복사", saved.title, "제목을 복사했어요.")}
            {copyButton("text", "글자만 복사", text, "글자만 복사했어요. 사진 자리는 [이미지 N 삽입]으로 표시돼요.")}
          </div>
          <p className="rounded-xl bg-muted px-4 py-3 text-[13px] leading-6 text-muted-foreground">
            ‘서식 그대로 복사’는 굵게·크기·글자색·배경색이 대부분 유지되지만, 편집기마다 달라서 똑같이 붙는다고 보장할 수 없어요. 붙여넣은 뒤 미리보기로 확인하세요. 서식이 달라지면 ‘글자만 복사’ 후 ‘편집 가이드’대로 직접 꾸미면 돼요. 글꼴은 붙여넣어도 유지되지 않아요.
          </p>
          <div className="rounded-2xl border bg-white p-5 text-neutral-800 shadow-sm sm:p-8" aria-label={`${BLOG_PLATFORM_LABEL[target]} 미리보기`}>
            <p className="mb-6 font-extrabold leading-9 tracking-[-0.03em] text-neutral-900" style={{ fontSize: styled ? style.title.sizePx : 26, textAlign: styled ? style.title.align : "left", color: styled ? style.title.color : undefined }}>{saved.title}</p>
            {/* HTML built by renderBlogHtml from escaped text and fixed tags only (see server/blog/render.ts). */}
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </TabsContent>

        <TabsContent value="style" className="space-y-4">
          <StyleGuideView style={style} source={effectiveGuide.source} />
          <div className="flex flex-wrap gap-2">{copyButton("style", "스타일 가이드 복사", styleGuideText(style), "스타일 가이드를 복사했어요.")}</div>
        </TabsContent>

        <TabsContent value="images" className="space-y-4">
          <div className="rounded-2xl bg-brand-soft/50 px-5 py-4">
            <p className="flex items-center gap-2 font-bold"><Camera className="size-4" aria-hidden="true" />이 글에 넣을 이미지 {placements.length}장</p>
            <p className="mt-1 text-sm leading-6">AI는 이미지를 만들지 않아요. 아래 순서와 위치대로 직접 찍은 사진이나 화면을 넣어주세요. 이 글({chars.toLocaleString()}자)에는 {recommendedImageCount(chars).min}~{recommendedImageCount(chars).max}장이 알맞아요.</p>
            {placements.length < recommendedImageCount(chars).min ? <p className="mt-1 text-[13px] text-muted-foreground">사진 자리가 적은 편이에요. ‘고치기’에서 <code className="rounded bg-background px-1">[사진] 어떤 사진 | 설명</code> 줄을 더해 보세요.</p> : null}
          </div>
          {placements.length === 0 ? <p className="rounded-2xl bg-muted px-5 py-6 text-sm text-muted-foreground">이 글에는 사진 자리가 없어요. ‘고치기’에서 [사진] 줄을 넣으면 여기에 안내가 생겨요.</p> : (
            <ol className="space-y-3">
              {placements.map((item) => (
                <li key={item.number} className="rounded-2xl border bg-card p-5">
                  <div className="flex flex-wrap items-center gap-2"><Badge variant="brand">이미지 {item.number}</Badge><span className="text-sm font-bold">{item.type}</span><Badge variant="secondary">권장 비율 {item.ratio}</Badge>{item.ownedImage ? <Badge variant="success">올려둔 ‘{item.ownedImage}’ 활용</Badge> : <Badge variant="outline">직접 촬영 필요</Badge>}</div>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm leading-6 sm:grid-cols-[7rem_1fr]">
                    <dt className="font-semibold text-muted-foreground">넣을 위치</dt><dd>{item.sectionLabel} · {item.afterLabel}{item.afterExcerpt ? <span className="text-muted-foreground"> (“{item.afterExcerpt}…” 다음)</span> : null}</dd>
                    <dt className="font-semibold text-muted-foreground">어떤 이미지</dt><dd>{item.description}</dd>
                    <dt className="font-semibold text-muted-foreground">캡션</dt><dd>{item.caption}</dd>
                    <dt className="font-semibold text-muted-foreground">대체 텍스트</dt><dd>{item.altText}</dd>
                    <dt className="font-semibold text-muted-foreground">필요한 이유</dt><dd>{item.reason}</dd>
                  </dl>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-2">{copyButton("images", "이미지 가이드 복사", imageGuideText(placements), "이미지 가이드를 복사했어요.")}</div>
        </TabsContent>

        <TabsContent value="seo" className="space-y-4">
          <div className="space-y-4 rounded-2xl border bg-card p-5 text-sm leading-6">
            <div><p className="text-[13px] font-semibold text-muted-foreground">추천 제목</p><ol className="mt-1 list-decimal space-y-0.5 pl-5">{seo.titleCandidates.map((candidate) => <li key={candidate}>{candidate}</li>)}</ol></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><p className="text-[13px] font-semibold text-muted-foreground">핵심 키워드</p><p className="mt-1"><Badge variant="brand">{seo.primaryKeyword}</Badge></p></div>
              <div><p className="text-[13px] font-semibold text-muted-foreground">보조 키워드</p><p className="mt-1 flex flex-wrap gap-1.5">{seo.secondaryKeywords.length ? seo.secondaryKeywords.map((keyword) => <Badge key={keyword} variant="secondary">{keyword}</Badge>) : "-"}</p></div>
              <div><p className="text-[13px] font-semibold text-muted-foreground">지역 키워드</p><p className="mt-1 flex flex-wrap gap-1.5">{seo.regionKeywords.length ? seo.regionKeywords.map((keyword) => <Badge key={keyword} variant="secondary">{keyword}</Badge>) : <span className="text-muted-foreground">해당 없음 (가게 홍보에만 써요)</span>}</p></div>
              <div><p className="text-[13px] font-semibold text-muted-foreground">검색 의도</p><p className="mt-1"><strong>{seo.searchIntent}</strong> — {seo.searchIntentNote}</p></div>
            </div>
            <div><p className="text-[13px] font-semibold text-muted-foreground">검색 결과용 요약</p><p className="mt-1">{seo.metaDescription}</p></div>
          </div>
          <div className="space-y-3 rounded-2xl border bg-card p-5">
            <p className="font-bold">태그 {seo.tags.length}개</p>
            <p className="flex flex-wrap gap-1.5">{seo.tags.map((tag) => <Badge key={tag} variant="outline">#{tag}</Badge>)}</p>
            <div className="flex flex-wrap gap-2">
              {copyButton("tags-naver", "네이버용 태그 복사", formatTags(seo.tags, "naver"), "네이버 블로그 태그 칸에 붙여넣으세요. (#로 구분)")}
              {copyButton("tags-tistory", "티스토리용 태그 복사", formatTags(seo.tags, "tistory"), "티스토리 태그 칸에 붙여넣으세요. (쉼표로 구분)")}
              {copyButton("seo", "SEO 정보 전체 복사", seoGuideText(seo, target), "SEO 정보를 복사했어요.")}
            </div>
            <p className="text-[13px] text-muted-foreground">태그는 글에 실제로 나오는 말이나 직접 정한 키워드만 골랐어요. 많이 넣는다고 좋은 게 아니라서 필요한 만큼만 쓰세요.</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StyleLine({ label, style }: { label: string; style: TextStyle }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm font-bold">{label}</p>
      <ul className="mt-2 space-y-0.5 text-[13px] leading-6 text-muted-foreground">
        <li>크기 · <strong className="text-foreground">{style.sizePx}px</strong> (약 {Math.round(style.sizePx * 0.75 * 10) / 10}pt)</li>
        <li className="flex items-center gap-1.5">색상 · <span aria-hidden="true" className="inline-block size-3.5 rounded border" style={{ backgroundColor: style.color }} /><strong className="text-foreground">{style.color}</strong></li>
        <li>굵기 · <strong className="text-foreground">{style.bold ? "Bold" : "Normal"}</strong> · 정렬 · <strong className="text-foreground">{style.align === "center" ? "가운데" : "왼쪽"}</strong></li>
        {style.lineHeight ? <li>줄 간격 · <strong className="text-foreground">{style.lineHeight}</strong></li> : null}
        {style.note ? <li>{style.note}</li> : null}
      </ul>
    </div>
  );
}

function StyleGuideView({ style, source }: { style: BlogStyleGuide; source: BlogPublishingGuide["source"] }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-brand-soft/50 px-5 py-4 text-sm leading-6">
        <p className="font-bold">{BLOG_PLATFORM_LABEL[style.platform]} 편집기 기준 추천이에요 <Badge variant={source === "ai" ? "brand" : "secondary"} className="ml-1">{source === "ai" ? "AI 추천" : "기본 규칙"}</Badge></p>
        <p className="mt-1">글씨체 · <strong>{style.fontFamily}</strong>{style.fontAlternatives.length ? <span className="text-muted-foreground"> (대체: {style.fontAlternatives.join(", ")})</span> : null}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{style.fontNote}</p>
        <p className="mt-2 text-[13px]">{style.rationale}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <StyleLine label="메인 제목" style={style.title} />
        <StyleLine label="소제목" style={style.heading} />
        <StyleLine label="본문" style={style.body} />
        <StyleLine label="강조 문장" style={style.emphasis} />
        <StyleLine label="행동 유도(CTA) 문장" style={style.cta} />
        <StyleLine label="사진 설명(캡션)" style={style.caption} />
      </div>
      <ul className="space-y-1 rounded-2xl bg-muted px-5 py-4 text-[13px] leading-6 text-muted-foreground">
        <li><strong className="text-foreground">문단 간격</strong> · {style.paragraphSpacing}</li>
        <li><strong className="text-foreground">강조 방법</strong> · {style.emphasisMethod}</li>
        <li><strong className="text-foreground">강조 횟수</strong> · {style.emphasisLimit}</li>
        {style.cautions.map((caution) => <li key={caution}>※ {caution}</li>)}
      </ul>
    </div>
  );
}
