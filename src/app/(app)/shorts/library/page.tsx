import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, Film, LoaderCircle, Plus } from "lucide-react";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { ShortsLibraryCard } from "@/components/shorts/library-card";
import { formatShortsDate } from "@/lib/shorts-format";
import { describeAutomationRunError } from "@/server/shared/errors";
import { listShortsLibrary, listUnfinishedShorts } from "@/server/shorts/library";

export const metadata: Metadata = { title: "내 영상 보관함" };

export default async function ShortsLibraryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { data: template } = await supabase.from("automation_templates").select("id").eq("slug", "shorts").maybeSingle();
  const { data: automations } = template
    ? await supabase.from("automations").select("id").eq("user_id", user.id).eq("template_id", template.id)
    : { data: [] };
  const [library, unfinished] = await Promise.all([
    listShortsLibrary(supabase, user.id, Number(query.page) || 1),
    listUnfinishedShorts(supabase, (automations ?? []).map((automation) => automation.id)),
  ]);
  const inProgress = unfinished.filter((run) => run.status !== "FAILED");
  const failed = unfinished.filter((run) => run.status === "FAILED");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        back={{ href: "/shorts", label: "숏폼 스튜디오" }}
        title="내 영상"
        description="만든 광고 영상이 하나씩 저장돼요. 다시 보고, 내려받고, 제목을 고치고, 필요 없으면 지울 수 있어요. 보거나 내려받는다고 이용권이 줄지 않아요."
        actions={<Button asChild><Link href="/shorts"><Plus aria-hidden="true" /> 새 영상 만들기</Link></Button>}
      />

      {inProgress.length > 0 ? (
        <section aria-labelledby="in-progress-heading" className="space-y-3">
          <h2 id="in-progress-heading" className="text-base font-extrabold tracking-[-0.02em]">만드는 중</h2>
          <ul className="space-y-2">
            {inProgress.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-brand-soft px-4 py-3 text-sm">
                <span className="flex items-center gap-2 font-semibold"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />영상을 만들고 있어요 · {formatShortsDate(run.createdAt)} 시작</span>
                <Link href="/shorts" className="font-semibold text-primary underline underline-offset-2">진행 상황 보기</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {failed.length > 0 ? (
        <section aria-labelledby="failed-heading" className="space-y-3">
          <h2 id="failed-heading" className="text-base font-extrabold tracking-[-0.02em]">만들지 못한 영상 <span className="text-sm font-medium text-muted-foreground">(최근 7일)</span></h2>
          <ul className="space-y-2">
            {failed.map((run) => (
              <li key={run.id} className="flex flex-wrap items-start gap-2 rounded-2xl bg-destructive/5 px-4 py-3 text-sm">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{formatShortsDate(run.createdAt)} · 영상이 만들어지지 않았어요</p>
                  <p className="text-muted-foreground">{describeAutomationRunError(run.errorMessage)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="library-heading" className="space-y-4">
        <h2 id="library-heading" className="flex items-baseline gap-2 text-base font-extrabold tracking-[-0.02em]">
          만든 영상 <span className="text-sm font-medium text-muted-foreground">{library.total}개</span>
        </h2>
        {library.items.length === 0 ? (
          <EmptyState
            mascot="point"
            icon={<Film className="size-5" />}
            title={library.total > 0 ? "이 페이지에는 영상이 없어요" : "아직 만든 영상이 없어요"}
            description={library.total > 0 ? "처음 페이지로 돌아가 주세요." : "사진을 올려 첫 광고 영상을 만들어 보세요. 완성되면 이곳에 자동으로 저장돼요."}
            action={<Button asChild><Link href={library.total > 0 ? "/shorts/library" : "/shorts"}>{library.total > 0 ? "처음으로" : "영상 만들러 가기"}</Link></Button>}
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {library.items.map((item) => <ShortsLibraryCard key={item.id} item={item} />)}
          </ul>
        )}
        {library.pageCount > 1 ? (
          <nav className="flex items-center justify-center gap-3 pt-2" aria-label="영상 목록 페이지">
            {library.page > 1 ? <Button asChild variant="outline" size="sm"><Link href={library.page - 1 > 1 ? `/shorts/library?page=${library.page - 1}` : "/shorts/library"}>이전</Link></Button> : null}
            <span className="text-sm text-muted-foreground" aria-current="page">{library.page} / {library.pageCount}</span>
            {library.page < library.pageCount ? <Button asChild variant="outline" size="sm"><Link href={`/shorts/library?page=${library.page + 1}`}>다음</Link></Button> : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
