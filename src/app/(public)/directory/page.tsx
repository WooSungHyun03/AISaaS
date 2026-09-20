import { createClient } from "@/lib/supabase/server";
import { ToolCard } from "@/components/directory/tool-card";

export default async function DirectoryPage() {
  const supabase = await createClient();
  const { data: tools } = await supabase.from("directory_tools").select("*").order("stars", { ascending: false });

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-16">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">AI 툴 디렉토리</h1>
        <p className="text-muted-foreground">업무 자동화에 활용할 수 있는 오픈소스 AI 툴을 모아봤습니다.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(tools ?? []).map((tool) => (
          <ToolCard key={tool.id} tool={tool} />
        ))}
      </div>
      {(tools ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">아직 등록된 툴이 없습니다.</p>
      ) : null}
    </div>
  );
}
