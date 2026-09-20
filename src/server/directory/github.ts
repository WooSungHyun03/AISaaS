import "server-only";
import { serverEnv } from "@/lib/env/server";

export interface GithubRepoStats {
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  description: string | null;
}

/**
 * Fetches public repo metadata for the AI Tool Directory. Works
 * unauthenticated (60 requests/hour) or with GITHUB_TOKEN (5000/hour) for
 * syncing a larger catalog.
 */
export async function fetchRepoStats(owner: string, repo: string): Promise<GithubRepoStats> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(serverEnv.GITHUB_TOKEN ? { Authorization: `Bearer ${serverEnv.GITHUB_TOKEN}` } : {}),
    },
    // Directory data changes slowly; avoid burning API rate limit on every request.
    next: { revalidate: 60 * 60 * 6 },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed for ${owner}/${repo} (${response.status})`);
  }

  const data = (await response.json()) as {
    stargazers_count: number;
    forks_count: number;
    language: string | null;
    license: { spdx_id: string } | null;
    description: string | null;
  };

  return {
    stars: data.stargazers_count,
    forks: data.forks_count,
    language: data.language,
    license: data.license?.spdx_id ?? null,
    description: data.description,
  };
}

/** Parses "owner/repo" out of a GitHub URL, e.g. https://github.com/owner/repo. */
export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}
