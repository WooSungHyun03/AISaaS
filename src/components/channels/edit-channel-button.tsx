"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { AddChannelForm } from "@/components/channels/add-channel-form";
import { Button } from "@/components/ui/button";

/** "주소 변경" — 새 주소를 확인한 뒤 등록하고, 등록에 성공하면 이전 채널을 지운다(기록은 새 채널부터 쌓여요). */
export function EditChannelButton({ businessId, channelId, channelLabel }: { businessId: string; channelId: string; channelLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" aria-label={`${channelLabel} 주소 변경`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Pencil aria-hidden="true" />
        주소 변경
      </Button>
      {open ? (
        <div className="basis-full rounded-xl border border-border bg-background p-3">
          <p className="mb-2 text-[13px] text-muted-foreground">다른 채널로 바꾸면 이전 채널의 성장 기록은 삭제되고 새 채널부터 쌓여요.</p>
          <AddChannelForm businessId={businessId} replaceChannelId={channelId} onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}
