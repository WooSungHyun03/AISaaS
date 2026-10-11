"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createBlogAutomation } from "@/app/(app)/blog/actions";
import { triggerRunNow } from "@/app/(app)/automations/actions";
import { cn } from "@/lib/utils";

const PLATFORMS = [
  { value: "naver", label: "네이버 블로그" },
  { value: "tistory", label: "티스토리" },
] as const;

/**
 * First blog post in one click: pick where it will be posted, the setup is made from the business profile and the
 * first post starts right away (the usual credit check applies, and a failed post gives the credit back).
 */
export function QuickBlogStart({ businessId, disabled = false }: { businessId: string; disabled?: boolean }) {
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]["value"]>("naver");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function start() {
    startTransition(async () => {
      try {
        const created = await createBlogAutomation(businessId, platform);
        if (created.error || !created.automationId) {
          toast.error(created.error ?? "블로그 설정을 만들지 못했어요.");
          return;
        }
        const run = await triggerRunNow(created.automationId);
        if (run.error) toast.error(run.error);
        else toast.success("첫 글을 쓰기 시작했어요. 몇 분 안에 완성돼요.");
      } catch {
        toast.error("글 만들기를 시작하지 못했어요. 잠시 후 다시 시도해주세요.");
      } finally {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-center gap-3 sm:items-start">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="글을 올릴 곳">
        {PLATFORMS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={platform === item.value}
            onClick={() => setPlatform(item.value)}
            disabled={pending}
            className={cn("min-h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold transition-colors", platform === item.value ? "border-primary bg-brand-soft text-primary" : "border-input bg-card text-muted-foreground hover:border-primary/40")}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Button variant="spark" onClick={start} disabled={pending || disabled}>{pending ? "글 쓰는 중…" : "첫 글 바로 만들기"}</Button>
    </div>
  );
}
