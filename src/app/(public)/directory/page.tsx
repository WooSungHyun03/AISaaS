import { createClient } from "@/lib/supabase/server";
import { ToolCard } from "@/components/directory/tool-card";
import { EmptyState } from "@/components/ui/page-state";

export const metadata = { title: "AI 도구 모음" };

export default async function DirectoryPage() {
  const supabase = await createClient();
  const { data: tools } = await supabase.from("directory_tools").select("*").order("stars", { ascending: false });

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-12 sm:px-6 sm:py-16">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">AI 도구 모음</h1>
        <p className="mt-3 text-[15px] leading-7 text-muted-foreground">마케팅과 업무에 써볼 만한 오픈소스 AI 도구를 모았어요. 별이 많은 순서로 보여드려요.</p>
      </header>
      {(tools ?? []).length === 0 ? (
        <EmptyState mascot="guide" title="아직 등록된 도구가 없어요" description="곧 쓸 만한 도구를 채워 둘게요." />
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {(tools ?? []).map((tool) => <ToolCard key={tool.id} tool={tool} />)}
        </ul>
      )}
    </div>
  );
}
