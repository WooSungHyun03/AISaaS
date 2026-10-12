"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AudioLines, Film, ImagePlus, LoaderCircle, Sparkles, Stamp, X } from "lucide-react";
import { toast } from "sonner";
import {
  addMascotReferences,
  createShortsAssetUpload,
  registerShortsAsset,
  removeShortsAsset,
  saveShortsSettings,
  setAssetRole,
} from "@/app/(app)/shorts/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  ASSET_LABEL_MAX_LENGTH,
  ASSET_LIMITS,
  ASSET_ROLES,
  SHORTS_BRIEF_MAX_LENGTH,
  SHORTS_DURATION,
  SHORTS_ASSET_KINDS,
  VOICE_MODES,
  type ShortsAssetKind,
  type ShortsAssetRole,
  type VoiceMode,
} from "@/types/shorts-reference";

export interface AssetView {
  id: string;
  kind: ShortsAssetKind;
  origin: "upload" | "mascot";
  label: string;
  role: ShortsAssetRole | null;
  /** What the AI saw in a photo. */
  summary: string;
  durationSec: number | null;
  /** Signed URL for uploads, `/shorts-mascot/...` for the mascot. Null when it could not be created. */
  previewUrl: string | null;
}

const MIME_BY_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", svg: "image/svg+xml" };

function mimeOf(file: File): string {
  if (file.type) return file.type;
  return MIME_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

const ACCEPT: Record<ShortsAssetKind, string> = {
  image: ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
  video: ".mp4,.mov,video/mp4,video/quicktime",
  audio: ".mp3,.wav,audio/mpeg,audio/wav",
  logo: ".png,.svg,image/png,image/svg+xml",
};

const KIND_ICON = { image: ImagePlus, video: Film, audio: AudioLines, logo: Stamp } as const;

const KIND_HELP: Record<ShortsAssetKind, string> = {
  image: "광고에 나올 상품·메뉴·매장·사람 사진이에요. AI가 이 사진 속 모습을 그대로 살려 영상을 만들어요.",
  video: "움직임이나 분위기를 참고할 짧은 영상이에요. 길이만큼 제작 비용이 더 들어서, 꼭 필요할 때만 올려주세요.",
  audio: "배경음악 분위기를 참고할 음원이에요.",
  logo: "영상 위에 올리는 로고예요. 영상 속 상품에는 섞이지 않아요.",
};

export function ShortsAssetsCard({
  automationId,
  assets,
  brief: initialBrief,
  durationSec: initialDuration,
  voiceMode: initialVoice,
  disabled,
}: {
  automationId: string;
  assets: AssetView[];
  brief: string;
  durationSec: number;
  voiceMode: VoiceMode;
  disabled: boolean;
}) {
  const router = useRouter();
  const inputs = useRef<Partial<Record<ShortsAssetKind, HTMLInputElement | null>>>({});
  const [pending, startTransition] = useTransition();
  const [brief, setBrief] = useState(initialBrief);
  const [durationSec, setDurationSec] = useState(initialDuration);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(initialVoice);
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState<ShortsAssetKind | null>(null);
  const busy = pending || uploading !== null || disabled;

  const finish = (error: string | undefined, success: string) => {
    if (error) toast.error(error);
    else toast.success(success);
    router.refresh();
  };

  /** Browser -> Storage directly (a video does not fit through a Server Action); the server checks the file afterwards. */
  const upload = async (kind: ShortsAssetKind, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const limits = ASSET_LIMITS[kind];
    const room = limits.max - assets.filter((asset) => asset.kind === kind).length;
    const picked = [...files].slice(0, Math.max(room, 0));
    if (picked.length === 0) {
      toast.error(kind === "logo" ? "로고는 1개만 올릴 수 있어요. 먼저 지운 뒤 올려주세요." : `${limits.max}개까지만 올릴 수 있어요.`);
      return;
    }
    if (files.length > picked.length) toast.info(`최대 ${limits.max}개까지라서 ${picked.length}개만 올려요.`);
    setUploading(kind);
    let uploaded = 0;
    try {
      const supabase = createClient();
      for (const file of picked) {
        const ticket = await createShortsAssetUpload(automationId, { kind, fileName: file.name, mime: mimeOf(file), bytes: file.size });
        if (ticket.error || !ticket.assetId || !ticket.path || !ticket.token || !ticket.bucket) {
          toast.error(ticket.error ?? "업로드를 준비하지 못했어요.");
          break;
        }
        const { error } = await supabase.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: mimeOf(file) || undefined });
        if (error) {
          toast.error("파일을 올리지 못했어요. 네트워크를 확인하고 다시 시도해주세요.");
          break;
        }
        const registered = await registerShortsAsset(automationId, { assetId: ticket.assetId, path: ticket.path, kind, label });
        if (registered.error) {
          toast.error(registered.error);
          break;
        }
        uploaded += 1;
      }
    } catch {
      toast.error("파일을 올리지 못했어요. 다른 파일로 다시 시도해주세요.");
    } finally {
      setUploading(null);
      const input = inputs.current[kind];
      if (input) input.value = "";
      if (uploaded > 0) {
        toast.success(`${SHORTS_ASSET_KINDS[kind]} ${uploaded}개를 올렸어요.`);
        setLabel("");
      }
      router.refresh();
    }
  };

  const section = (kind: ShortsAssetKind) => {
    const limits = ASSET_LIMITS[kind];
    const items = assets.filter((asset) => asset.kind === kind);
    const full = items.length >= limits.max;
    const Icon = KIND_ICON[kind];
    const seconds = kind === "video" || kind === "audio" ? Math.round(items.reduce((sum, item) => sum + (item.durationSec ?? 0), 0) * 10) / 10 : null;
    return (
      <div key={kind} className="space-y-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-bold"><Icon className="size-4 text-primary" aria-hidden="true" />{SHORTS_ASSET_KINDS[kind]} <span className="font-normal text-muted-foreground">({items.length}/{limits.max}{seconds !== null ? ` · ${seconds}/${"totalSeconds" in limits ? limits.totalSeconds : 0}초` : ""})</span></h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{KIND_HELP[kind]} {limits.label}</p>
          </div>
          <div>
            <input
              ref={(node) => { inputs.current[kind] = node; }}
              type="file"
              accept={ACCEPT[kind]}
              multiple={limits.max > 1}
              className="sr-only"
              id={`asset-file-${kind}`}
              aria-label={`${SHORTS_ASSET_KINDS[kind]} 파일 선택`}
              disabled={busy || full}
              onChange={(event) => void upload(kind, event.target.files)}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy || full} onClick={() => inputs.current[kind]?.click()}>
              {uploading === kind ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Icon aria-hidden="true" />}
              {uploading === kind ? "올리는 중…" : full ? "가득 찼어요" : `${SHORTS_ASSET_KINDS[kind]} 올리기`}
            </Button>
          </div>
        </div>
        {items.length > 0 ? (
          <ul className={cn("grid gap-3", kind === "audio" ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4")} aria-label={`올린 ${SHORTS_ASSET_KINDS[kind]}`}>
            {items.map((asset, index) => (
              <li key={asset.id} className="group relative overflow-hidden rounded-xl border bg-muted/40">
                {kind === "audio" ? (
                  <div className="flex items-center gap-3 p-3">
                    <AudioLines className="size-5 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{asset.label || `음원 ${index + 1}`}</span>
                    <span className="text-xs text-muted-foreground">{asset.durationSec ?? "?"}초</span>
                    {asset.previewUrl ? <audio src={asset.previewUrl} controls preload="none" className="h-8 max-w-[11rem]" aria-label={`음원 ${index + 1} 미리 듣기`} /> : null}
                  </div>
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%),linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] p-2">
                    {asset.previewUrl && kind === "video" ? (
                      <video src={asset.previewUrl} muted playsInline preload="metadata" className="size-full object-contain" aria-label={`참고 영상 ${index + 1} 미리보기`} />
                    ) : asset.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed Storage URLs are not in next/image's allow-list
                      <img src={asset.previewUrl} alt={asset.label || `${SHORTS_ASSET_KINDS[kind]} ${index + 1}`} className="size-full object-contain" loading="lazy" />
                    ) : <span className="text-xs text-muted-foreground">미리보기 없음</span>}
                  </div>
                )}
                {kind !== "audio" ? <p className="truncate px-2.5 pt-2 text-xs font-semibold" title={asset.summary || asset.label}>{index + 1}. {asset.label || asset.summary || SHORTS_ASSET_KINDS[kind]}{asset.durationSec ? ` · ${asset.durationSec}초` : ""}</p> : null}
                {kind === "image" ? (
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
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`${SHORTS_ASSET_KINDS[kind]} ${index + 1} 삭제`}
                  onClick={() => startTransition(async () => finish((await removeShortsAsset(automationId, asset.id)).error, `${SHORTS_ASSET_KINDS[kind]}을(를) 지웠어요.`))}
                  className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-opacity hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                ><X className="size-4" aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  };

  return (
    <section aria-labelledby="assets-heading" className="rounded-2xl border bg-card p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="assets-heading" className="text-lg font-extrabold tracking-[-0.03em]">광고 영상 재료</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            상품·매장 사진을 올리면 AI가 그 모습을 그대로 살려 {SHORTS_DURATION.min}~{SHORTS_DURATION.max}초짜리 세로 광고 영상을 한 번에 만들어요. 로고와 문구는 영상이 끝난 뒤 정확하게 얹어요.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy || assets.filter((asset) => asset.kind === "image").length >= ASSET_LIMITS.image.max} onClick={() => startTransition(async () => finish((await addMascotReferences(automationId)).error, "이지 마케팅 마스코트를 불러왔어요."))}>
          <Sparkles aria-hidden="true" />이지 마케팅 마스코트 불러오기
        </Button>
      </div>

      <div className="mt-5 space-y-1.5">
        <label htmlFor="asset-label" className="text-sm font-semibold">올릴 파일 설명 <span className="font-normal text-muted-foreground">(선택 · 다음에 올리는 파일에 붙어요. 상품 이름이나 어떤 장면인지 적으면 더 정확해요)</span></label>
        <Input id="asset-label" value={label} maxLength={ASSET_LABEL_MAX_LENGTH} disabled={busy} onChange={(event) => setLabel(event.target.value)} placeholder="예: 시그니처 소금빵 / 매장 입구 / 포장 라벨" />
      </div>

      <div className="mt-4 grid gap-4">{(["image", "video", "audio", "logo"] as const).map(section)}</div>

      <div className="mt-6 space-y-5 border-t pt-5">
        <div className="space-y-2">
          <label htmlFor="shorts-duration" className="text-sm font-semibold">영상 길이 <span className="text-primary">{durationSec}초</span></label>
          <input id="shorts-duration" type="range" min={SHORTS_DURATION.min} max={SHORTS_DURATION.max} step={1} value={durationSec} disabled={busy} onChange={(event) => setDurationSec(Number(event.target.value))} className="w-full accent-primary" aria-valuetext={`${durationSec}초`} />
          <div className="flex justify-between text-xs text-muted-foreground"><span>{SHORTS_DURATION.min}초</span><span>{SHORTS_DURATION.max}초</span></div>
        </div>
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="text-sm font-semibold">목소리</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(VOICE_MODES) as VoiceMode[]).map((key) => (
              <label key={key} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 hover:bg-muted/50", voiceMode === key && "border-primary bg-brand-soft/40")}>
                <input type="radio" name="shorts-voice" value={key} checked={voiceMode === key} onChange={() => setVoiceMode(key)} className="mt-1 size-4 accent-primary" />
                <span><span className="block text-sm font-bold">{VOICE_MODES[key].label}</span><span className="block text-xs leading-5 text-muted-foreground">{VOICE_MODES[key].description}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1.5">
          <label htmlFor="shorts-brief" className="text-sm font-semibold">어떤 광고를 원하세요? <span className="font-normal text-muted-foreground">(선택)</span></label>
          <Textarea id="shorts-brief" rows={3} maxLength={SHORTS_BRIEF_MAX_LENGTH} disabled={busy} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="예: 신메뉴 소금빵을 갓 구운 느낌으로 보여주고 마지막에 예약을 유도해줘요" />
          <p className="text-right text-xs text-muted-foreground">{brief.length}/{SHORTS_BRIEF_MAX_LENGTH}</p>
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => startTransition(async () => finish((await saveShortsSettings(automationId, { brief, durationSec, voiceMode })).error, "길이와 요청 사항을 저장했어요."))}>
          저장
        </Button>
      </div>

      <p className="mt-5 rounded-xl bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
        영상 하나를 만드는 데 몇 분에서 십여 분 걸려요. AI가 만든 영상은 자동 점검을 거치지만 사람이 마지막으로 확인해야 해요. 상품 모양이나 라벨 글자가 달라 보이면 게시하지 말고 다시 만들어 주세요. 업로드한 파일은 나만 볼 수 있게 저장되고 영상을 만들 때만 사용돼요. 저작권이나 초상권 문제가 없는 파일만 올려주세요.
      </p>
    </section>
  );
}
