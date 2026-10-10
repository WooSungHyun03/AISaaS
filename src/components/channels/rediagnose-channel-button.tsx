"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { rediagnoseChannel } from "@/app/(app)/diagnosis/actions";
import { Button } from "@/components/ui/button";

/** "다시 진단하기" — 1시간 캐시/시간당 한도는 diagnoseChannel(서버) 쪽에서 그대로 적용됨, 여기선 호출만. */
export function RediagnoseChannelButton({ channelId }: { channelId: string }) {
  const [isPending, setIsPending] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      aria-disabled={isPending}
      onClick={async () => {
        setIsPending(true);
        const result = await rediagnoseChannel(channelId);
        setIsPending(false);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("다시 진단했어요.");
      }}
    >
      {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
      다시 진단하기
    </Button>
  );
}
