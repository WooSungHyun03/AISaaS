import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(new URL("./install.mjs", import.meta.url));

test("installer preserves existing configuration and is idempotent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "em-harness-install-"));
  await mkdir(path.join(root, "scripts/harness"), { recursive: true });
  await mkdir(path.join(root, ".github/workflows"), { recursive: true });
  const install = await readFile(SOURCE, "utf8");
  await writeFile(path.join(root, "scripts/harness/install.mjs"), install);
  await writeFile(path.join(root, "CLAUDE.md"), "@AGENTS.md\nCustom rules stay.\n");
  await writeFile(path.join(root, "AGENTS.md"), "Next.js rules stay.\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }, null, 2) + "\n");
  await writeFile(path.join(root, ".github/workflows/ci.yml"), "steps:\n      - run: npm ci\n      - run: npm test\n");
  const run = () => spawnSync(process.execPath, [path.join(root, "scripts/harness/install.mjs")], { encoding: "utf8" });
  assert.equal(run().status, 0);
  const original = await readFile(path.join(root, "CLAUDE.md"), "utf8");
  assert.match(original, /@AGENTS\.md/);
  assert.match(original, /@docs\/HARNESS\.md/);
  const ci = await readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /npm run harness:audit/);
  assert.match(ci, /npm test/);
  const scripts = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).scripts;
  assert.equal(scripts.test, "vitest run");
  assert.equal(scripts["harness:verify"], "node scripts/harness/run.mjs verify");
  assert.equal(run().status, 0);
  assert.equal(await readFile(path.join(root, "CLAUDE.md"), "utf8"), original);
  assert.equal(await readFile(path.join(root, ".github/workflows/ci.yml"), "utf8"), ci);
});
