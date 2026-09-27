/**
 * Repos this directory actively tracks. `owner`/`repo` are what the GitHub
 * API needs (see github.ts, and sync.ts); `slug` must match the
 * `directory_tools.slug` row each one syncs into (supabase/seed.sql today —
 * verified to match exactly). Intentionally no stars/forks/description here
 * — those are always fetched live, never hand-entered.
 *
 * `name` is optional: it's only ever used the *first* time a repo is
 * inserted (sync.ts never overwrites an existing row's name). Set it when
 * GitHub's raw repo name (e.g. "langchain") isn't the display name you
 * want; otherwise sync.ts falls back to `repo`.
 */
export interface CuratedRepo {
  owner: string;
  repo: string;
  slug: string;
  name?: string;
}

export const CURATED_REPOS: CuratedRepo[] = [
  { owner: "langchain-ai", repo: "langchain", slug: "langchain", name: "LangChain" },
  { owner: "n8n-io", repo: "n8n", slug: "n8n", name: "n8n" },
  { owner: "supabase", repo: "supabase", slug: "supabase", name: "Supabase" },
];
