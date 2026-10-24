import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "em-harness-audit-"));
  const config = JSON.parse(await readFile(path.join(dirname, "scopes.json"), "utf8"));
  const files = [
    "AGENTS.md", "CLAUDE.md", "docs/HARNESS.md", "docs/harness/ACCEPTANCE.md",
    "package.json", ".github/workflows/ci.yml", "vercel.json",
    "src/server/automations", "src/server/channels", "src/server/ai", "src/server/shorts",
    "src/server/budget", "src/server/billing", "src/server/security",
    "src/app/api/cron/run-automations/route.ts", "src/app/api/cron/collect-metrics/route.ts"
  ];
  for (const scope of Object.values(config)) files.push(...scope.paths, ...scope.tests);
  for (const file of new Set(files)) {
    const full = path.join(root, file);
    const isDir = !path.extname(file) && !["AGENTS.md", "CLAUDE.md"].includes(file);
    if (isDir) await mkdir(full, { recursive: true });
    else { await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, "fixture\n"); }
  }
  await writeFile(path.join(root, "CLAUDE.md"), "@AGENTS.md\n@docs/HARNESS.md\n");
  await writeFile(path.join(root, ".github/workflows/ci.yml"), "run: npm run harness:audit\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: Object.fromEntries(["lint", "typecheck", "test", "build", "e2e:schedule", "e2e:photos", "e2e:library", "e2e:collection", "e2e:admin", "e2e:guide", "e2e:journey", "perf:measure"].map(s => [s, "echo fixture"])) }));
  await mkdir(path.join(root, "scripts/harness"), { recursive: true });
  await writeFile(path.join(root, "scripts/harness/scopes.json"), JSON.stringify(config));
  await writeFile(path.join(root, "scripts/harness/run.mjs"), await readFile(path.join(dirname, "run.mjs")));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  return root;
}

test("audit passes on a complete local repository layout", async () => {
  const root = await fixture();
  const proc = spawnSync(process.execPath, ["scripts/harness/run.mjs", "audit"], { cwd: root, encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stdout + proc.stderr);
  assert.match(proc.stdout, /Harness PASS/);
});

test("demo refuses to run without explicitly opting into local mutable tests", async () => {
  const root = await fixture();
  const proc = spawnSync(process.execPath, ["scripts/harness/run.mjs", "demo"], { cwd: root, encoding: "utf8", env: { ...process.env, HARNESS_ALLOW_LOCAL_E2E: "0", E2E_BASE_URL: "https://be-celeb.org" } });
  assert.equal(proc.status, 1);
  assert.match(proc.stdout, /local E2E guard/);
  assert.match(proc.stdout, /Harness FAIL/);
});

test("audit fails on a missing P0 test dependency", async () => {
  const { rm } = await import("node:fs/promises");
  const root = await fixture();
  await rm(path.join(root, "src/server/automations/runner.test.ts"));
  const proc = spawnSync(process.execPath, ["scripts/harness/run.mjs", "audit"], { cwd: root, encoding: "utf8" });
  assert.equal(proc.status, 1);
  assert.match(proc.stdout, /scope:schedule paths and tests/);
  assert.match(proc.stdout, /Harness FAIL/);
});
