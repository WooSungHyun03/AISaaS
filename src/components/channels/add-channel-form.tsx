"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { addChannel, type ChannelActionState } from "@/app/(app)/diagnosis/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { FormMessage } from "@/components/ui/form-message";

const initialState: ChannelActionState = {};

/** platformHint는 URL만으로 플랫폼을 알 수 없을 때(대표적으로 티스토리 커스텀 도메인)만 쓰인다 — url-parser.ts 참고. */
export function AddChannelForm({ businessId }: { businessId: string }) {
  const [state, formAction, isPending] = useActionState(addChannel, initialState);
  const lastChannelId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!state.channelId || state.channelId === lastChannelId.current) return;
    lastChannelId.current = state.channelId;
    toast.success("채널을 진단했어요.");
  }, [state.channelId]);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end" aria-describedby={state.error ? "add-channel-error" : undefined}>
      <input type="hidden" name="businessId" value={businessId} />
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="channel-url">채널 주소</Label>
        <Input id="channel-url" name="url" placeholder="youtube.com/@내채널, blog.naver.com/내블로그, 내블로그.tistory.com" required disabled={isPending} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="channel-platform-hint">플랫폼</Label>
        <NativeSelect id="channel-platform-hint" name="platformHint" defaultValue="" disabled={isPending} className="sm:w-48">
          <option value="">자동 인식</option>
          <option value="youtube">유튜브</option>
          <option value="naver_blog">네이버 블로그</option>
          <option value="tistory">티스토리(커스텀 도메인)</option>
        </NativeSelect>
      </div>
      <Button type="submit" disabled={isPending} aria-disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
        {isPending ? "진단하는 중…" : "채널 추가"}
      </Button>
      {state.error ? (
        <div className="w-full">
          <FormMessage id="add-channel-error">{state.error}</FormMessage>
        </div>
      ) : null}
    </form>
  );
}
