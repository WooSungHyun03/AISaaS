import { ASSET_ROLES, SHORTS_ASSET_KINDS, type UsedReference } from "@/types/shorts-reference";

/** "What was used" for one run: the owner's photos or clips, numbered the way the AI was told about them. */
export function UsedReferences({ references }: { references: Array<UsedReference & { previewUrl: string | null }> }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-muted-foreground">사용한 참고 자료 {references.length}개</p>
      <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="이번 결과에 사용한 참고 자료">
        {references.map((reference) => {
          const name = reference.label || reference.summary || SHORTS_ASSET_KINDS[reference.kind];
          return (
            <li key={reference.id} className="overflow-hidden rounded-xl border bg-card">
              <div className="flex aspect-square items-center justify-center bg-muted/60 p-1.5">
                {reference.previewUrl && reference.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
                  <img src={reference.previewUrl} alt={`${reference.number}번 ${name}`} className="size-full object-contain" loading="lazy" />
                ) : (
                  <span className="px-2 text-center text-xs text-muted-foreground">{reference.origin === "mascot" ? "이지 마케팅 마스코트" : "원본 파일이 삭제됐어요"}</span>
                )}
              </div>
              <div className="space-y-0.5 px-2.5 py-2">
                <p className="truncate text-xs font-semibold" title={name}>{reference.number}번 · {name}</p>
                {reference.role ? <p className="text-[11px] text-muted-foreground">{ASSET_ROLES[reference.role]}</p> : null}
                {reference.summary && reference.summary !== name ? <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">AI가 본 모습: {reference.summary}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
