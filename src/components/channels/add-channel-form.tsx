"use client";

import { useState, useTransition } from "react";
import { BadgeCheck, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { addChannel, previewChannelAction, type ChannelActionState } from "@/app/(app)/diagnosis/actions";
import type { ChannelPreview } from "@/server/channels/preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { FormMessage } from "@/components/ui/form-message";

const initialState: ChannelActionState = {};

export interface ChannelSuggestion {
  label: string;
  url: string;
}

const PLATFORM_LABEL: Record<ChannelPreview["platform"], string> = { youtube: "유튜브", naver_blog: "네이버 블로그", tistory: "티스토리" };

/**
 * 채널 등록: 주소 입력 → "확인"(저장 없이 이름·사진·공개 수치 미리보기) → "이 채널로 등록".
 * replaceChannelId가 있으면 "주소 변경"이라서, 새 채널을 등록한 뒤에만 이전 채널을 지운다.
 * platformHint는 URL만으로 플랫폼을 알 수 없을 때(대표적으로 티스토리 커스텀 도메인)만 쓰인다 — url-parser.ts 참고.
 */
export function AddChannelForm({
  businessId,
  suggestions = [],
  replaceChannelId,
  onDone,
}: {
  businessId: string;
  /** 사업 정보에 이미 적어 둔 주소: 눌러서 바로 확인할 수 있다. */
  suggestions?: ChannelSuggestion[];
  replaceChannelId?: string;
  onDone?: () => void;
}) {
  const [result, setResult] = useState<ChannelActionState>(initialState);
  const [url, setUrl] = useState("");
  const [platformHint, setPlatformHint] = useState("");
  const [preview, setPreview] = useState<ChannelPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isChecking, startChecking] = useTransition();
  const [isSaving, startSaving] = useTransition();

  function save(formData: FormData) {
    startSaving(async () => {
      const next = await addChannel(initialState, formData);
      setResult(next);
      if (!next.channelId) return;
      toast.success(replaceChannelId ? "채널 주소를 바꿨어요." : next.notice ? "채널을 등록했어요." : "채널을 등록하고 진단했어요.");
      if (next.notice) toast.info(next.notice);
      if (!next.error) {
        setUrl("");
        setPreview(null);
        onDone?.();
      }
    });
  }

  function check(nextUrl = url, hint = platformHint) {
    setPreviewError(null);
    setPreview(null);
    startChecking(async () => {
      const result = await previewChannelAction(nextUrl, hint);
      if (result.preview) setPreview(result.preview);
      else setPreviewError(result.error ?? "채널을 확인하지 못했어요.");
    });
  }

  const busy = isChecking || isSaving;
  const error = result.error ?? previewError;

  return (
    <div className="space-y-3">
      {suggestions.length > 0 && !preview ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">사업 정보에 적어 둔 주소</span>
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion.url}
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setUrl(suggestion.url);
                setPlatformHint("");
                check(suggestion.url, "");
              }}
            >
              {suggestion.label} 확인
            </Button>
          ))}
        </div>
      ) : null}

      <form
        action={save}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        aria-describedby={error ? "add-channel-error" : undefined}
        onSubmit={(event) => {
          // Enter before the confirmation step checks the channel instead of saving it.
          if (!preview) {
            event.preventDefault();
            check();
          }
        }}
      >
        <input type="hidden" name="businessId" value={businessId} />
        {replaceChannelId ? <input type="hidden" name="replaceChannelId" value={replaceChannelId} /> : null}
        {/* What is saved is exactly what was confirmed: the normalised address of the previewed channel. */}
        <input type="hidden" name="url" value={preview ? preview.normalizedUrl : url} />
        <input type="hidden" name="platformHint" value={preview ? preview.platform : platformHint} />
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`channel-url-${replaceChannelId ?? "new"}`}>{replaceChannelId ? "새 채널 주소" : "채널 주소"}</Label>
          <Input
            id={`channel-url-${replaceChannelId ?? "new"}`}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setPreview(null);
              setPreviewError(null);
            }}
            placeholder="youtube.com/@내채널, blog.naver.com/내블로그, 내블로그.tistory.com"
            required
            disabled={busy}
          />
        </div>
        {!preview ? (
          <div className="space-y-1.5">
            <Label htmlFor={`channel-platform-hint-${replaceChannelId ?? "new"}`}>플랫폼</Label>
            <NativeSelect id={`channel-platform-hint-${replaceChannelId ?? "new"}`} value={platformHint} onChange={(event) => { setPlatformHint(event.target.value); setPreview(null); }} disabled={busy} className="sm:w-48">
              <option value="">자동 인식</option>
              <option value="youtube">유튜브</option>
              <option value="naver_blog">네이버 블로그</option>
              <option value="tistory">티스토리(커스텀 도메인)</option>
            </NativeSelect>
          </div>
        ) : null}
        {preview ? (
          <Button type="submit" disabled={busy} aria-disabled={busy}>
            {isSaving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {isSaving ? "등록하는 중…" : replaceChannelId ? "이 채널로 바꾸기" : "이 채널로 등록"}
          </Button>
        ) : (
          <Button type="submit" disabled={busy || !url.trim()} aria-disabled={busy}>
            {isChecking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
            {isChecking ? "확인하는 중…" : "채널 확인"}
          </Button>
        )}
      </form>

      {preview ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3" role="status" aria-label="확인된 채널">
          {preview.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a remote channel image whose host is not known ahead of time
            <img src={preview.thumbnailUrl} alt="" className="size-12 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
              {preview.verified ? <BadgeCheck className="size-4 shrink-0 text-success" aria-hidden="true" /> : null}
              {preview.displayName ?? PLATFORM_LABEL[preview.platform]}
              <span className="text-xs font-normal text-muted-foreground">{PLATFORM_LABEL[preview.platform]}</span>
            </p>
            {preview.summary ? <p className="text-[13px] text-muted-foreground">{preview.summary}</p> : null}
            {preview.note ? <p className="text-[13px] text-muted-foreground">{preview.note}</p> : null}
            <p className="break-all text-xs text-muted-foreground">{preview.normalizedUrl}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setPreview(null)}>
            다시 입력
          </Button>
        </div>
      ) : null}

      {error ? <FormMessage id="add-channel-error">{error}</FormMessage> : null}
    </div>
  );
}
