"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, LoaderCircle, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  addMascotReferences,
  removeShortsReference,
  saveShortsCreativeSettings,
  uploadShortsReference,
} from "@/app/(app)/shorts/actions";
import { downsizeImage } from "@/components/automations/downsize-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  MAX_SHORTS_REFERENCES,
  REFERENCE_LABEL_MAX_LENGTH,
  SHORTS_BRIEF_MAX_LENGTH,
  SHORTS_STYLES,
  type ShortsStyle,
} from "@/types/shorts-reference";

export interface ReferenceView {
  id: string;
  kind: "upload" | "mascot";
  label: string;
  /** Signed URL for uploads, `/shorts-mascot/...` for the mascot. Null when it could not be created. */
  previewUrl: string | null;
}

export function ShortsReferencesCard({
  automationId,
  references,
  style: initialStyle,
  brief: initialBrief,
  disabled,
}: {
  automationId: string;
  references: ReferenceView[];
  style: ShortsStyle;
  brief: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [style, setStyle] = useState<ShortsStyle>(initialStyle);
  const [brief, setBrief] = useState(initialBrief);
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const busy = pending || uploading || disabled;
  const full = references.length >= MAX_SHORTS_REFERENCES;

  const finish = (error: string | undefined, success: string) => {
    if (error) toast.error(error);
    else toast.success(success);
    router.refresh();
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_SHORTS_REFERENCES - references.length;
    const picked = [...files].slice(0, room);
    if (files.length > room) toast.info(`최대 ${MAX_SHORTS_REFERENCES}장까지라서 ${picked.length}장만 올려요.`);
    setUploading(true);
    let uploaded = 0;
    try {
      for (const file of picked) {
        const shrunk = await downsizeImage(file);
        const form = new FormData();
        form.set("file", shrunk);
        form.set("label", label);
        const result = await uploadShortsReference(automationId, form);
        if (result.error) {
          toast.error(result.error);
          break;
        }
        uploaded += 1;
      }
    } catch {
      toast.error("이미지를 올리지 못했어요. 다른 이미지로 다시 시도해주세요.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
      if (uploaded > 0) {
        toast.success(`참고 이미지 ${uploaded}장을 올렸어요.`);
        setLabel("");
      }
      router.refresh();
    }
  };

  return (
    <section aria-labelledby="reference-heading" className="rounded-2xl border bg-card p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="reference-heading" className="text-lg font-extrabold tracking-[-0.03em]">참고 이미지로 캐릭터 영상 만들기</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            캐릭터 이미지를 1장~{MAX_SHORTS_REFERENCES}장 올리면, 그 캐릭터가 대사를 하며 움직이는 영상으로 만들어요. 이미지를 올리지 않으면 기본 영상(색 배경 + 자막)이 만들어져요.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy || full} onClick={() => startTransition(async () => finish((await addMascotReferences(automationId)).error, "이지 마케팅 마스코트를 불러왔어요."))}>
          <Sparkles aria-hidden="true" />이지 마케팅 마스코트 불러오기
        </Button>
      </div>

      {references.length > 0 ? (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="올린 참고 이미지">
          {references.map((reference, index) => (
            <li key={reference.id} className="group relative overflow-hidden rounded-xl border bg-muted/40">
              <div className="flex aspect-square items-center justify-center bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%),linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] p-2">
                {reference.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs are not in next/image's allow-list
                  <img src={reference.previewUrl} alt={reference.label || `참고 이미지 ${index + 1}`} className="size-full object-contain" loading="lazy" />
                ) : <span className="text-xs text-muted-foreground">미리보기 없음</span>}
              </div>
              <p className="truncate px-2.5 py-2 text-xs font-semibold" title={reference.label}>{index + 1}. {reference.label || "참고 이미지"}</p>
              <button
                type="button"
                disabled={busy}
                aria-label={`참고 이미지 ${index + 1} 삭제`}
                onClick={() => startTransition(async () => finish((await removeShortsReference(automationId, reference.id)).error, "참고 이미지를 지웠어요."))}
                className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-opacity hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              ><X className="size-4" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <label htmlFor="reference-label" className="text-sm font-semibold">이미지 설명 <span className="font-normal text-muted-foreground">(선택 · AI가 어떤 장면에 쓸지 고를 때 읽어요)</span></label>
          <Input id="reference-label" value={label} maxLength={REFERENCE_LABEL_MAX_LENGTH} disabled={busy || full} onChange={(event) => setLabel(event.target.value)} placeholder="예: 깜짝 놀란 고양이 / 엄지척 하는 사장님" />
        </div>
        <div>
          <input ref={fileInput} id="reference-file" type="file" accept="image/*" multiple className="sr-only" disabled={busy || full} onChange={(event) => void upload(event.target.files)} />
          <Button type="button" variant="outline" disabled={busy || full} onClick={() => fileInput.current?.click()}>
            {uploading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}
            {uploading ? "올리는 중…" : full ? `가득 찼어요 (${MAX_SHORTS_REFERENCES}장)` : `이미지 올리기 (${references.length}/${MAX_SHORTS_REFERENCES})`}
          </Button>
        </div>
      </div>

      <div className="mt-6 space-y-4 border-t pt-5">
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="text-sm font-semibold">영상 스타일</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(SHORTS_STYLES) as ShortsStyle[]).map((key) => (
              <label key={key} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 hover:bg-muted/50", style === key && "border-primary bg-brand-soft/40")}>
                <input type="radio" name="shorts-style" value={key} checked={style === key} onChange={() => setStyle(key)} className="mt-1 size-4 accent-primary" />
                <span><span className="block text-sm font-bold">{SHORTS_STYLES[key].label}</span><span className="block text-xs leading-5 text-muted-foreground">{SHORTS_STYLES[key].description}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1.5">
          <label htmlFor="shorts-brief" className="text-sm font-semibold">이번 영상 요청 사항 <span className="font-normal text-muted-foreground">(선택)</span></label>
          <Textarea id="shorts-brief" rows={3} maxLength={SHORTS_BRIEF_MAX_LENGTH} disabled={busy} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="예: 신메뉴를 홍보하는 웃긴 콩트로 만들어주세요. 마지막엔 예약 링크를 알려주세요." />
          <p className="text-right text-xs text-muted-foreground">{brief.length}/{SHORTS_BRIEF_MAX_LENGTH}</p>
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => startTransition(async () => finish((await saveShortsCreativeSettings(automationId, { style, brief })).error, "스타일과 요청 사항을 저장했어요."))}>
          저장
        </Button>
      </div>

      <p className="mt-5 rounded-xl bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
        올린 이미지는 모양 그대로 쓰이고, 장면마다 표정·동작이 맞는 이미지를 골라 통통 튀거나 흔들리는 효과를 줘요. 입 모양이 말에 맞춰 움직이는 영상은 아니에요. 업로드한 이미지는 나만 볼 수 있게 저장되고 영상을 만들 때만 사용돼요. 저작권이나 초상권 문제가 없는 이미지만 올려주세요.
      </p>
    </section>
  );
}
