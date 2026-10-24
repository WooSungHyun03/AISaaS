"use client";

import { useEffect, useRef, useState } from "react";
import { Film, ImageOff } from "lucide-react";
import { shortsVideoSrc } from "@/lib/shorts-format";
import { cn } from "@/lib/utils";

/**
 * The card picture: the video's first frame. The video element is only mounted once the card scrolls near the screen
 * and loads only its metadata, so a page of cards fetches a few hundred kilobytes, not a page of videos.
 */
export function ShortsThumb({ contentId, playable, title, className }: { contentId: string; playable: boolean; title: string; className?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const node = holder.current;
    if (!node || !playable) return;
    // Every current browser has it; without it the card keeps its placeholder rather than loading every video at once.
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [playable]);

  return (
    <div ref={holder} className={cn("relative aspect-[9/16] w-full overflow-hidden bg-muted", className)}>
      {playable && near && !broken ? (
        <video
          src={`${shortsVideoSrc(contentId)}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          aria-label={`${title} 첫 장면`}
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground" aria-hidden="true">
          {playable && !broken ? <Film className="size-7" /> : <ImageOff className="size-7" />}
        </div>
      )}
    </div>
  );
}

/**
 * The detail page's player. If the stored address expires while the page stays open (or the first load fails), the
 * route is asked once more, which signs a new address; only then does it say the video could not be loaded.
 */
export function ShortsPlayer({ contentId, title }: { contentId: string; title: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const src = attempt === 0 ? shortsVideoSrc(contentId) : `${shortsVideoSrc(contentId)}?retry=${attempt}`;

  if (failed) {
    return (
      <div role="alert" className="flex aspect-[9/16] w-full max-w-sm flex-col items-center justify-center gap-3 rounded-2xl bg-muted px-6 text-center text-sm text-muted-foreground">
        <ImageOff className="size-8" aria-hidden="true" />
        <p>영상을 불러오지 못했어요.</p>
        <button type="button" className="font-semibold text-primary underline underline-offset-2" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>다시 불러오기</button>
      </div>
    );
  }
  return (
    <video
      key={attempt}
      src={src}
      controls
      preload="metadata"
      playsInline
      aria-label={`${title} 영상`}
      onError={() => { if (attempt < 1) setAttempt((value) => value + 1); else setFailed(true); }}
      className="aspect-[9/16] max-h-[640px] w-full max-w-sm rounded-2xl bg-black object-contain"
    >
      브라우저에서 영상 재생을 지원하지 않습니다.
    </video>
  );
}
