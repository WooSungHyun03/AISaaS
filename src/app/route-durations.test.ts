import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A page's `maxDuration` is the time limit of every Server Action called from it (Next 16 route segment config).
 * The actions below start or advance a paid generation step that can be one model call of several minutes (the
 * blog plan from Opus, a whole post from Fable). On a page with a shorter limit the function is killed mid-call:
 * the paid call is wasted and the run blocks the automation until the stale-run reaper fails it ~10 minutes later.
 */
const LONG_ACTIONS = ["triggerRunNow", "triggerCalendarItemNow", "advanceAutomationRun", "generateShortsPreview", "advanceShortsJob"];
const MIN_SECONDS = 300;

const SRC = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));

/** `@/components/x` (or `./x` inside src/components) → the file it resolves to. */
function resolveImport(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
  if (!base) return undefined;
  return [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")].find((candidate) => sources.has(candidate));
}

function importsOf(file: string): string[] {
  const source = sources.get(file) ?? "";
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => resolveImport(file, match[1])).filter((value): value is string => Boolean(value));
}

/** Client components that call one of the long actions, directly or through other components. */
function callsLongAction(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const source = sources.get(file) ?? "";
  if (file.includes(`${path.sep}components${path.sep}`) && LONG_ACTIONS.some((name) => new RegExp(`\\b${name}\\b`).test(source))) return true;
  return importsOf(file).filter((dep) => dep.includes(`${path.sep}components${path.sep}`)).some((dep) => callsLongAction(dep, seen));
}

function declaredMaxDuration(source: string): number | null {
  const match = source.match(/export const maxDuration\s*=\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

describe("route time limits", () => {
  const pages = files.filter((file) => file.startsWith(path.join(SRC, "app")) && path.basename(file) === "page.tsx");
  const hosting = pages.filter((page) => callsLongAction(page));

  it("finds the pages that host generation actions", () => {
    const names = hosting.map((page) => path.relative(path.join(SRC, "app"), page));
    expect(names).toEqual(expect.arrayContaining([
      path.join("(app)", "blog", "page.tsx"),
      path.join("(app)", "calendar", "page.tsx"),
      path.join("(app)", "automations", "[id]", "runs", "[runId]", "page.tsx"),
    ]));
  });

  it.each(hosting.map((page) => [path.relative(path.join(SRC, "app"), page), page]))("%s gives its Server Actions room for a long model call", (_name, page) => {
    expect(declaredMaxDuration(sources.get(page) ?? "")).toBeGreaterThanOrEqual(MIN_SECONDS);
  });
});
