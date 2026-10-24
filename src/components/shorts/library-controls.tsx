"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { archiveLegacyShortsVideo, deleteShortsContent, renameShortsContent } from "@/app/(app)/shorts/library-actions";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";

/** Deletes the video and its file after an explicit confirmation, then goes back to the library. */
export function DeleteShortsButton({ contentId, title, redirectTo }: { contentId: string; title: string; redirectTo?: string }) {
  const router = useRouter();
  return (
    <ConfirmationDialog
      destructive
      title="이 영상을 삭제할까요?"
      description={`“${title}” 영상 파일과 보관함 기록이 지워져요. 삭제한 영상은 되돌릴 수 없고, 이미 쓴 AI 제작 이용권은 돌아오지 않아요.`}
      confirmLabel="삭제하기"
      pendingLabel="삭제 중…"
      trigger={<Button type="button" variant="outline" size="sm" className="text-destructive"><Trash2 aria-hidden="true" /> 삭제</Button>}
      onConfirm={async () => {
        const result = await deleteShortsContent(contentId);
        if (result.error) {
          toast.error(result.error);
          throw new Error(result.error);
        }
        toast.success("영상을 삭제했어요.");
        if (redirectTo) router.push(redirectTo);
        router.refresh();
      }}
    />
  );
}

/** The video's title, with a small edit form. The title is what the library lists and what a downloaded file is named after. */
export function ShortsTitleEditor({ contentId, title }: { contentId: string; title: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(title);
  const [value, setValue] = useState(title);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    setError("");
    startTransition(async () => {
      const result = await renameShortsContent(contentId, value);
      if (result.error || !result.title) {
        setError(result.error ?? "저장하지 못했어요.");
        return;
      }
      setSaved(result.title);
      setValue(result.title);
      setEditing(false);
      toast.success("제목을 바꿨어요.");
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 text-xl font-extrabold leading-8 tracking-[-0.03em] [overflow-wrap:anywhere]">{saved}</h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="제목 수정" onClick={() => { setValue(saved); setEditing(true); }}><Pencil aria-hidden="true" /></Button>
      </div>
    );
  }
  return (
    <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <div className="flex gap-2">
        <Input value={value} onChange={(event) => setValue(event.target.value)} maxLength={100} aria-label="영상 제목" aria-invalid={Boolean(error)} autoFocus disabled={pending} />
        <Button type="submit" size="icon-sm" aria-label="제목 저장" disabled={pending}><Check aria-hidden="true" /></Button>
        <Button type="button" variant="outline" size="icon-sm" aria-label="수정 취소" disabled={pending} onClick={() => { setEditing(false); setError(""); }}><X aria-hidden="true" /></Button>
      </div>
      {error ? <FormMessage>{error}</FormMessage> : null}
    </form>
  );
}

/** For an older video that was only ever a hosted link: tries to copy it into the library, or says it is gone. */
export function ArchiveLegacyButton({ contentId }: { contentId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => {
        setError("");
        startTransition(async () => {
          const result = await archiveLegacyShortsVideo(contentId);
          if (result.error) setError(result.error);
          else {
            toast.success("영상을 내 보관함에 저장했어요.");
            router.refresh();
          }
        });
      }}>
        <Archive aria-hidden="true" /> {pending ? "옮기는 중…" : "보관함에 영구 저장"}
      </Button>
      {error ? <FormMessage>{error}</FormMessage> : null}
    </div>
  );
}
