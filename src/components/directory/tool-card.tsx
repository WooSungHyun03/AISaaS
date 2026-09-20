import { Star, GitFork, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { DirectoryTool } from "@/types/domain";

export function ToolCard({ tool }: { tool: DirectoryTool }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{tool.name}</CardTitle>
          {tool.category ? <Badge variant="outline">{tool.category}</Badge> : null}
        </div>
        <CardDescription>{tool.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Star className="h-4 w-4" /> {tool.stars.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <GitFork className="h-4 w-4" /> {tool.forks.toLocaleString()}
        </span>
        {tool.language ? <span>{tool.language}</span> : null}
      </CardContent>
      {tool.github_url ? (
        <CardFooter>
          <a
            href={tool.github_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-sm text-primary underline underline-offset-4"
          >
            GitHub에서 보기 <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </CardFooter>
      ) : null}
    </Card>
  );
}
