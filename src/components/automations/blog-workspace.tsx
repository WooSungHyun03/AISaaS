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
import { markupToPost } from "@/server/blog/markup";
import { BLOG_PLATFORM_LABEL, countCharsNoSpaces, postBodyText } from "@/server/blog/post";
import { renderBlogHtml, renderBlogText } from "@/server/blog/render";
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
}: {
  contentId: string;
  title: string;
  markup: string;
  editedAt: string | null;
  platform: Target;
  notes: string[];
}) {
  const [saved, setSaved] = useState({ title, markup, editedAt });
  const [target, setTarget] = useState<Target>(platform);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftMarkup, setDraftMarkup] = useState(markup);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const post = useMemo(() => markupToPost(saved.markup), [saved.markup]);
  const html = useMemo(() => renderBlogHtml(post, target), [post, target]);
  const photos = useMemo(() => post.sections.flatMap((section) => section.blocks).filter((block) => block.type === "photo"), [post]);
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
            <p className="mt-2">문단 사이는 빈 줄로 나눠요. AI가 처음 만든 글은 제작 기록에 그대로 남아 있어요.</p>
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
        <Button type="button" size="sm" onClick={() => { setDraftTitle(saved.title); setDraftMarkup(saved.markup); setEditing(true); }}><Pencil aria-hidden="true" /> 고치기</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="올릴 곳" className="inline-flex rounded-lg border p-0.5">
          {(Object.keys(BLOG_PLATFORM_LABEL) as Target[]).map((key) => (
            <button key={key} type="button" aria-pressed={target === key} onClick={() => setTarget(key)} className={cn("rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", target === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{BLOG_PLATFORM_LABEL[key]}</button>
          ))}
        </div>
        <Button type="button" variant="spark" size="sm" onClick={() => copy("rich", () => copyRich(html, text), `${BLOG_PLATFORM_LABEL[target]}에 붙여넣을 글을 복사했어요. 편집기에서 붙여넣기(Ctrl+V) 하세요.`)}>
          {copied === "rich" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}서식 그대로 복사
        </Button>
        {target === "tistory" ? (
          <Button type="button" variant="outline" size="sm" onClick={() => copy("html", () => navigator.clipboard.writeText(html), "HTML 코드를 복사했어요. 티스토리 글쓰기에서 ‘HTML’ 모드로 바꿔 붙여넣으세요.")}>
            {copied === "html" ? <Check aria-hidden="true" /> : <Code2 aria-hidden="true" />}HTML 코드 복사
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => copy("title", () => navigator.clipboard.writeText(saved.title), "제목을 복사했어요.")}>{copied === "title" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}제목 복사</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => copy("text", () => navigator.clipboard.writeText(text), "글자만 복사했어요.")}>{copied === "text" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}글자만 복사</Button>
      </div>

      {notes.length > 0 ? (
        <details className="rounded-xl bg-muted px-4 py-3 text-[13px] leading-6 text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">AI가 확인한 점 {notes.length}가지</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </details>
      ) : null}

      <div className="rounded-2xl border bg-white p-5 text-neutral-800 shadow-sm sm:p-8" aria-label={`${BLOG_PLATFORM_LABEL[target]} 미리보기`}>
        <p className="mb-6 text-[26px] font-extrabold leading-9 tracking-[-0.03em] text-neutral-900">{saved.title}</p>
        {/* HTML built by renderBlogHtml from escaped text and fixed tags only (see server/blog/render.ts). */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      {photos.length > 0 ? (
        <div className="rounded-2xl bg-brand-soft/50 px-5 py-4">
          <p className="flex items-center gap-2 font-bold"><Camera className="size-4" aria-hidden="true" />올릴 때 넣을 사진 {photos.length}장</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6">
            {photos.map((photo, index) => <li key={`${index}-${photo.slot}`}>{photo.slot}{photo.caption ? <span className="text-muted-foreground"> — {photo.caption}</span> : null}</li>)}
          </ol>
          <p className="mt-2 text-[13px] text-muted-foreground">미리보기의 ‘사진 자리’ 줄을 지우고 그 자리에 직접 찍은 사진을 넣어주세요. 직접 찍은 사진이 있을수록 검색에 유리해요.</p>
        </div>
      ) : null}
    </div>
  );
}
