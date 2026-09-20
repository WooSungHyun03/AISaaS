<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AutoBiz — Project Rules for AI Coding Agents

This is a 3-person team's AI automation SaaS built with heavy use of AI coding
tools (Codex and similar). Read before making changes:

- [README.md](README.md) — stack, local setup, deployment
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — domain boundaries, request/automation/billing flow, database overview
- [docs/TEAM_GUIDE.md](docs/TEAM_GUIDE.md) — file ownership per teammate, shared-code rules, PR rules, and the 10 vibe-coding rules

The short version of the vibe-coding rules (full detail in TEAM_GUIDE.md):

1. Search the existing codebase before creating a new file — `src/server/` and `src/components/` likely already have something close.
2. Don't add a dependency before checking `package.json` for something that already does the job.
3. Keep dependencies minimal — never install two libraries for the same purpose.
4. Don't write huge files, but don't over-fragment either.
5. Never put a DB query, AI API call, or external platform API call inside a UI component — go through a Server Action or `src/server/`.
6. Never expose a server secret to the client bundle — server-only env vars live behind `src/lib/env/server.ts`, which imports `"server-only"` so a client-side import fails the build.
7. Never commit an API key, password, or the Supabase service-role key. `.env.local` is gitignored.
8. Keep mock and real implementations clearly separate (`AI_PROVIDER`/`BILLING_PROVIDER` default to `mock`).
9. Check `src/types/` and the relevant domain's `types.ts`/`provider.ts` before implementing a feature.
10. Only add a new abstraction when it has two real call sites, not in anticipation of a future one.
