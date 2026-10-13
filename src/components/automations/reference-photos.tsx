"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, History, ImagePlus, LoaderCircle, RotateCcw, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import {
  createShortsAssetUpload,
  listReusableImages,
  registerShortsAsset,
  removeShortsAsset,
  reuseImages,
  setAssetRole,
  type ReusableImage,
} from "@/app/(app)/shorts/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ASSET_LABEL_MAX_LENGTH, ASSET_LIMITS, ASSET_ROLES, checkPhotoFile, type AssetView, type ShortsAssetRole } from "@/types/shorts-reference";

const IMAGE = ASSET_LIMITS.image;
const MIME_BY_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const mimeOf = (file: File) => file.type || MIME_BY_EXTENSION[extensionOf(file.name)] || "";

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);

type StagedStatus = "ready" | "uploading" | "done" | "error";
interface Staged {
  key: string;
  file: File;
  previewUrl: string;
  label: string;
  status: StagedStatus;
  error: string | null;
}

let counter = 0;
const nextKey = () => `staged-${(counter += 1)}`;

export function ReferencePhotos({
  automationId,
  assets,
  disabled = false,
  showRole = false,
  heading = "참고 사진",
  description,
}: {
  automationId: string;
  assets: AssetView[];
  disabled?: boolean;
  /** Shorts lets the owner say what a photo is for; the blog does not need it. */
  showRole?: boolean;
  heading?: string;
  description: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reusable, setReusable] = useState<ReusableImage[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loadingReuse, setLoadingReuse] = useState(false);
  const stagedRef = useRef(staged);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  const photos = assets.filter((asset) => asset.kind === "image");
  const waiting = staged.filter((item) => item.status !== "done");
  const room = IMAGE.max - photos.length - waiting.length;
  const busy = disabled || uploading || pending;

  // Local previews are object URLs: release them when the component goes away.
  useEffect(() => () => stagedRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)), []);

  const addFiles = useCallback((list: FileList | File[] | null) => {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    let free = IMAGE.max - photos.length - stagedRef.current.filter((item) => item.status !== "done").length;
    const accepted: Staged[] = [];
    const problems: string[] = [];
    for (const file of files) {
      const problem = checkPhotoFile({ name: file.name, size: file.size, type: file.type });
      if (problem) {
        problems.push(`${file.name}: ${problem}`);
        continue;
      }
      if (free <= 0) {
        problems.push(`${file.name}: 사진은 ${IMAGE.max}장까지만 쓸 수 있어요.`);
        continue;
      }
      free -= 1;
      accepted.push({ key: nextKey(), file, previewUrl: URL.createObjectURL(file), label: "", status: "ready", error: null });
    }
    if (accepted.length > 0) setStaged((current) => [...current.filter((item) => item.status !== "done"), ...accepted]);
    if (problems.length > 0) toast.error(problems.slice(0, 3).join("\n") + (problems.length > 3 ? `\n외 ${problems.length - 3}장` : ""));
    if (inputRef.current) inputRef.current.value = "";
  }, [photos.length]);

  const dropStaged = (key: string) => {
    setStaged((current) => {
      const target = current.find((item) => item.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  };

  const patchStaged = (key: string, patch: Partial<Staged>) => setStaged((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  /** Browser -> Storage directly through a one-time signed URL, one file at a time; the server re-checks the file's bytes. */
  const uploadAll = async () => {
    const queue = stagedRef.current.filter((item) => item.status === "ready" || item.status === "error");
    if (queue.length === 0) return;
    setUploading(true);
    const supabase = createClient();
    let uploaded = 0;
    for (const item of queue) {
      patchStaged(item.key, { status: "uploading", error: null });
      try {
        const ticket = await createShortsAssetUpload(automationId, { kind: "image", fileName: item.file.name, mime: mimeOf(item.file), bytes: item.file.size });
        if (ticket.error || !ticket.assetId || !ticket.path || !ticket.token || !ticket.bucket) {
          patchStaged(item.key, { status: "error", error: ticket.error ?? "업로드를 준비하지 못했어요." });
          continue;
        }
        const { error } = await supabase.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, item.file, { contentType: mimeOf(item.file) || undefined });
        if (error) {
          patchStaged(item.key, { status: "error", error: "파일을 올리지 못했어요. 네트워크를 확인하고 다시 시도해주세요." });
          continue;
        }
        const registered = await registerShortsAsset(automationId, { assetId: ticket.assetId, path: ticket.path, kind: "image", label: item.label });
        if (registered.error) {
          patchStaged(item.key, { status: "error", error: registered.error });
          continue;
        }
        uploaded += 1;
        patchStaged(item.key, { status: "done" });
      } catch {
        patchStaged(item.key, { status: "error", error: "파일을 올리지 못했어요. 다시 시도해주세요." });
      }
    }
    setUploading(false);
    if (uploaded > 0) {
      toast.success(`사진 ${uploaded}장을 올렸어요.`);
      // Finished rows are shown in the saved list now.
      setStaged((current) => {
        current.filter((item) => item.status === "done").forEach((item) => URL.revokeObjectURL(item.previewUrl));
        return current.filter((item) => item.status !== "done");
      });
    }
    router.refresh();
  };

  const finish = (error: string | undefined, success: string) => {
    if (error) toast.error(error);
    else toast.success(success);
    router.refresh();
  };

  const openReuse = async () => {
    if (reusable) {
      setReusable(null);
      return;
    }
    setLoadingReuse(true);
    const result = await listReusableImages(automationId).catch(() => ({ error: "이전 사진을 불러오지 못했어요.", images: undefined }));
    setLoadingReuse(false);
    if (result.error || !result.images) {
      toast.error(result.error ?? "이전 사진을 불러오지 못했어요.");
      return;
    }
    setPicked(new Set());
    setReusable(result.images);
  };

  const togglePick = (key: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else if (next.size < Math.max(room, 0)) next.add(key);
    else toast.info(`지금은 ${Math.max(room, 0)}장까지 더 쓸 수 있어요.`);
    return next;
  });

  const readyCount = staged.filter((item) => item.status === "ready" || item.status === "error").length;

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold"><ImagePlus className="size-4 text-primary" aria-hidden="true" />{heading} <span className="font-normal text-muted-foreground">({photos.length}/{IMAGE.max})</span></h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description} {IMAGE.label}.</p>
      </div>

      <div
        onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!busy) addFiles(event.dataTransfer.files);
        }}
        className={cn("flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors", dragging ? "border-primary bg-brand-soft/60" : "border-border bg-muted/30", busy && "opacity-60")}
        data-testid="photo-dropzone"
      >
        <UploadCloud className="size-7 text-primary" aria-hidden="true" />
        <p className="text-sm font-semibold">사진을 여기로 끌어다 놓거나 아래 버튼으로 골라주세요</p>
        <p className="text-xs text-muted-foreground">한 번에 여러 장을 고를 수 있어요 · 올리기 전에 미리 볼 수 있어요</p>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple className="sr-only" id={`photo-input-${automationId}`} aria-label="참고 사진 파일 선택" disabled={busy || room <= 0} onChange={(event) => addFiles(event.target.files)} />
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" size="sm" disabled={busy || room <= 0} onClick={() => inputRef.current?.click()}><ImagePlus aria-hidden="true" />{room <= 0 ? "가득 찼어요" : "사진 고르기"}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy || loadingReuse} onClick={() => void openReuse()} aria-expanded={reusable !== null}>
            {loadingReuse ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <History aria-hidden="true" />}이전에 올린 사진 쓰기
          </Button>
        </div>
      </div>

      {reusable ? (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-3" role="region" aria-label="이전에 올린 사진">
          {reusable.length === 0 ? (
            <p className="text-sm text-muted-foreground">이 사업체로 올렸던 다른 사진이 아직 없어요.</p>
          ) : (
            <>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {reusable.map((image) => {
                  const on = picked.has(image.key);
                  return (
                    <li key={image.key}>
                      <button type="button" onClick={() => togglePick(image.key)} aria-pressed={on} className={cn("relative block w-full overflow-hidden rounded-lg border-2 bg-background", on ? "border-primary" : "border-transparent")}>
                        {image.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
                          <img src={image.previewUrl} alt={image.label || image.summary || "이전에 올린 사진"} className="aspect-square w-full object-cover" loading="lazy" />
                        ) : <span className="flex aspect-square items-center justify-center text-xs text-muted-foreground">미리보기 없음</span>}
                        {on ? <CheckCircle2 className="absolute right-1 top-1 size-5 rounded-full bg-background text-primary" aria-hidden="true" /> : null}
                        <span className="block truncate px-1.5 py-1 text-[11px] text-muted-foreground">{image.label || image.summary || image.fromName}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={busy || picked.size === 0} onClick={() => startTransition(async () => {
                  const result = await reuseImages(automationId, [...picked]);
                  if (!result.error) setReusable(null);
                  finish(result.error, `사진 ${result.added ?? picked.size}장을 가져왔어요.`);
                })}>고른 사진 {picked.size}장 쓰기</Button>
                <span className="text-xs text-muted-foreground">복사해서 쓰기 때문에 한쪽을 지워도 다른 쪽엔 영향이 없어요.</span>
              </div>
            </>
          )}
        </div>
      ) : null}

      {staged.length > 0 ? (
        <div className="space-y-3" aria-live="polite">
          <p className="text-sm font-semibold">올릴 사진 {waiting.length}장 <span className="font-normal text-muted-foreground">· 설명은 선택이에요 (상품 이름이나 장면을 적으면 더 정확해요)</span></p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {staged.map((item) => (
              <li key={item.key} className="flex gap-3 rounded-xl border bg-card p-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                <img src={item.previewUrl} alt={`${item.file.name} 미리보기`} className="size-20 shrink-0 rounded-lg bg-muted object-cover" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate text-xs font-semibold" title={item.file.name}>{item.file.name} <span className="font-normal text-muted-foreground">({formatSize(item.file.size)})</span></p>
                  <Input aria-label={`${item.file.name} 설명`} value={item.label} maxLength={ASSET_LABEL_MAX_LENGTH} disabled={item.status === "uploading" || item.status === "done"} onChange={(event) => patchStaged(item.key, { label: event.target.value })} placeholder="예: 시그니처 소금빵" className="h-8 text-xs" />
                  <p className={cn("flex items-center gap-1 text-xs", item.status === "error" ? "text-destructive" : item.status === "done" ? "text-success" : "text-muted-foreground")} role={item.status === "error" ? "alert" : undefined}>
                    {item.status === "uploading" ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : item.status === "error" ? <AlertCircle className="size-3.5" aria-hidden="true" /> : item.status === "done" ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : null}
                    {item.status === "ready" ? "올리기를 기다리는 중" : item.status === "uploading" ? "올리는 중…" : item.status === "done" ? "올렸어요" : item.error}
                  </p>
                </div>
                {item.status !== "uploading" ? (
                  <button type="button" onClick={() => dropStaged(item.key)} aria-label={`${item.file.name} 빼기`} className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" aria-hidden="true" /></button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={disabled || uploading || readyCount === 0} onClick={() => void uploadAll()}>
              {uploading ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : staged.some((item) => item.status === "error") ? <RotateCcw aria-hidden="true" /> : <UploadCloud aria-hidden="true" />}
              {uploading ? "올리는 중…" : staged.some((item) => item.status === "error") ? `실패한 사진 다시 올리기` : `사진 ${readyCount}장 올리기`}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={uploading} onClick={() => setStaged((current) => { current.forEach((item) => URL.revokeObjectURL(item.previewUrl)); return []; })}>모두 빼기</Button>
          </div>
        </div>
      ) : null}

      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="올린 참고 사진">
          {photos.map((asset, index) => (
            <li key={asset.id} className="group relative overflow-hidden rounded-xl border bg-muted/40">
              <div className="flex aspect-square items-center justify-center bg-muted/60 p-1.5">
                {asset.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs are not in next/image's allow-list
                  <img src={asset.previewUrl} alt={asset.label || asset.summary || `참고 사진 ${index + 1}`} className="size-full object-contain" loading="lazy" />
                ) : <span className="text-xs text-muted-foreground">미리보기 없음</span>}
              </div>
              <p className="truncate px-2.5 pt-2 text-xs font-semibold" title={asset.summary || asset.label}>{index + 1}. {asset.label || asset.summary || "사진"}</p>
              {showRole ? (
                asset.origin === "mascot" ? (
                  <p className="px-2.5 pb-2 text-[11px] text-muted-foreground">{ASSET_ROLES.character}</p>
                ) : (
                  <div className="px-1.5 pb-1.5 pt-0.5">
                    <NativeSelect aria-label={`사진 ${index + 1} 쓰임새`} value={asset.role ?? ""} disabled={busy} className="h-8 text-xs" onChange={(event) => {
                      const next = event.target.value;
                      if (next in ASSET_ROLES) startTransition(async () => finish((await setAssetRole(automationId, asset.id, next)).error, "사진의 쓰임새를 바꿨어요."));
                    }}>
                      <option value="" disabled>AI가 구분해요</option>
                      {(Object.keys(ASSET_ROLES) as ShortsAssetRole[]).map((key) => <option key={key} value={key}>{ASSET_ROLES[key]}</option>)}
                    </NativeSelect>
                  </div>
                )
              ) : <div className="pb-2" />}
              <button
                type="button"
                disabled={busy}
                aria-label={`참고 사진 ${index + 1} 삭제`}
                onClick={() => startTransition(async () => finish((await removeShortsAsset(automationId, asset.id)).error, "사진을 지웠어요."))}
                className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-opacity hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              ><X className="size-4" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
