"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateContentHistory } from "@/app/(app)/blog/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** 만든 글을 검토하고 고친 뒤, 복사해서 직접 올릴 수 있게 해주는 작업 공간. */
export function ContentEditor({
  contentId,
  title,
  content,
  editedAt,
}: {
  contentId: string;
  title: string;
  content: string;
  editedAt: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState({ title, content, editedAt });
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${saved.title}\n\n${saved.content}`);
      setCopied(true);
      toast.success("제목과 본문을 복사했어요.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("복사하지 못했어요. 글을 직접 선택해서 복사해주세요.");
    }
  }

  function save(formData: FormData) {
    setError("");
    startTransition(async () => {
      try {
        const result = await updateContentHistory(contentId, formData);
        if (result.error) {
          setError(result.error);
          return;
        }
        setSaved({ title: String(formData.get("title")).trim(), content: String(formData.get("content")).trim(), editedAt: result.editedAt ?? new Date().toISOString() });
        setEditing(false);
        toast.success("수정한 글을 저장했어요.");
      } catch {
        setError("저장하지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  if (editing) {
    return (
      <form action={save} className="space-y-4" aria-describedby={error ? "content-editor-error" : undefined}>
        <div className="space-y-2">
          <Label htmlFor="content-title">제목</Label>
          <Input id="content-title" name="title" defaultValue={saved.title} maxLength={200} required disabled={pending} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="content-body">본문</Label>
          <Textarea id="content-body" name="content" defaultValue={saved.content} rows={16} maxLength={30_000} required disabled={pending} className="leading-7" />
          <p className="text-[13px] text-muted-foreground">문단 사이는 빈 줄로 나눠주세요. AI가 처음 만든 글은 제작 기록에 그대로 남아 있어요.</p>
        </div>
        {error ? <FormMessage id="content-editor-error">{error}</FormMessage> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>{pending ? "저장하는 중…" : "수정 저장"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => { setEditing(false); setError(""); }}>취소</Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-muted-foreground">제목</p>
          <p className="mt-1 text-xl font-extrabold leading-8 tracking-[-0.03em]">{saved.title}</p>
          {saved.editedAt ? <p className="mt-1 text-[13px] text-muted-foreground">내가 수정한 글이에요 · {new Date(saved.editedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</p> : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copy}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? "복사됨" : "복사"}</Button>
          <Button type="button" size="sm" onClick={() => setEditing(true)}><Pencil aria-hidden="true" /> 고치기</Button>
        </div>
      </div>
      <div>
        <p className="text-[13px] font-semibold text-muted-foreground">본문</p>
        <div className="mt-2 max-h-[520px] overflow-y-auto rounded-xl bg-muted px-5 py-4 text-[15px] leading-8 whitespace-pre-wrap">{saved.content}</div>
      </div>
    </div>
  );
}
