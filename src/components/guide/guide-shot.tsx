"use client";

import { ZoomIn } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { guideShotSrc, type GuideShot as GuideShotData, type GuideSlug } from "@/lib/guide-content";

/**
 * 실제 서비스 화면 캡처(번호·강조 표시 포함). 휴대폰에서는 휴대폰 화면 이미지를 보여주고,
 * 누르면 큰 화면으로 확대해서 볼 수 있어요.
 */
export function GuideShot({ slug, shot, priority = false }: { slug: GuideSlug; shot: GuideShotData; priority?: boolean }) {
  const desktop = guideShotSrc(slug, shot.id);
  const mobile = guideShotSrc(slug, shot.id, "mobile");
  return (
    <figure className="overflow-hidden rounded-2xl border bg-card">
      <Dialog>
        <DialogTrigger asChild>
          <button type="button" className="group relative block w-full cursor-zoom-in bg-muted/40 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px]" aria-label={`${shot.alt} (눌러서 크게 보기)`}>
            <picture>
              <source media="(max-width: 639px)" srcSet={mobile} />
              { }
              <img src={desktop} alt={shot.alt} loading={priority ? "eager" : "lazy"} decoding="async" className="mx-auto block max-h-[560px] w-auto max-w-full object-contain" />
            </picture>
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-ink/80 px-2.5 py-1 text-xs font-semibold text-white opacity-90 group-hover:opacity-100">
              <ZoomIn className="size-3.5" aria-hidden="true" />크게 보기
            </span>
          </button>
        </DialogTrigger>
        <DialogContent className="max-h-[94vh] w-[min(96vw,1200px)] max-w-none overflow-auto p-3 sm:max-w-none">
          <DialogTitle className="sr-only">{shot.caption}</DialogTitle>
          <DialogDescription className="sr-only">{shot.alt}</DialogDescription>
          <picture>
            <source media="(max-width: 639px)" srcSet={mobile} />
            { }
            <img src={desktop} alt={shot.alt} className="mx-auto block h-auto max-w-full" />
          </picture>
        </DialogContent>
      </Dialog>
      <figcaption className="border-t px-4 py-3 text-sm leading-6 text-muted-foreground">{shot.caption}</figcaption>
    </figure>
  );
}
