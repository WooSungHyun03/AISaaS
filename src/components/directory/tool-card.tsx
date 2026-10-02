import { ExternalLink, GitFork, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DirectoryTool } from "@/types/domain";

export function ToolCard({ tool }: { tool: DirectoryTool }) {
  return (
    <li className="grid gap-3 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold">{tool.name}</h2>
          {tool.category ? <Badge variant="secondary">{tool.category}</Badge> : null}
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{tool.description}</p>
        <p className="tabular mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-1"><Star className="size-3.5" aria-hidden="true" /><span className="sr-only">별 </span>{tool.stars.toLocaleString()}</span>
          <span className="flex items-center gap-1"><GitFork className="size-3.5" aria-hidden="true" /><span className="sr-only">포크 </span>{tool.forks.toLocaleString()}</span>
          {tool.language ? <span>{tool.language}</span> : null}
        </p>
      </div>
      {tool.github_url ? (
        <a href={tool.github_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline">
          GitHub에서 보기 <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </li>
  );
}
