#!/usr/bin/env node
/** Idempotently wires the copied harness into the existing project. Does not deploy, install deps, or call APIs. */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const projectFile = (p) => path.join(root, p);
async function change(relative, transform) {
  const file = projectFile(relative);
  const previous = await readFile(file, "utf8");
  const updated = transform(previous);
  if (updated !== previous) {
    await writeFile(file, updated, "utf8");
    console.log(`UPDATED ${relative}`);
  } else console.log(`UNCHANGED ${relative}`);
}

await change("CLAUDE.md", text => {
  if (text.includes("@docs/HARNESS.md")) return text;
  // Preserve existing @AGENTS.md import and custom instructions.
  return `${text.trimEnd()}\n@docs/HARNESS.md\n`;
});
await change("AGENTS.md", text => {
  if (text.includes("docs/HARNESS.md")) return text;
  return `${text.trimEnd()}\n\n## Iterative quality harness\n\nBefore implementing or changing functionality, read [docs/HARNESS.md](docs/HARNESS.md). Run the scoped checks, then the full gates and local demo tests when applicable. Preserve team ownership and existing AGENTS.md Next.js rules.\n`;
});
await change("package.json", text => {
  const packageJson = JSON.parse(text);
  if (!packageJson.scripts || typeof packageJson.scripts !== "object") throw new Error("package.json scripts missing");
  const added = {
    "harness:audit": "node scripts/harness/run.mjs audit",
    "harness:focus": "node scripts/harness/run.mjs focus",
    "harness:verify": "node scripts/harness/run.mjs verify",
    "harness:demo": "node scripts/harness/run.mjs demo",
    "harness:perf": "node scripts/harness/run.mjs perf",
    "harness:test": "node --test scripts/harness/*.test.mjs"
  };
  for (const [name, value] of Object.entries(added)) {
    if (packageJson.scripts[name] && packageJson.scripts[name] !== value) throw new Error(`Existing ${name} script differs; resolve manually`);
    packageJson.scripts[name] = value;
  }
  return JSON.stringify(packageJson, null, 2) + "\n";
});
await change(".github/workflows/ci.yml", text => {
  if (text.includes("npm run harness:audit")) return text;
  const anchor = "      - run: npm ci\n";
  if (!text.includes(anchor)) throw new Error("CI npm ci step was changed; add npm run harness:audit manually");
  return text.replace(anchor, `${anchor}\n      - name: Harness static audit\n        run: npm run harness:audit\n`);
});
console.log("\nHarness installed. Next: npm run harness:audit && npm run harness:focus -- schedule && npm run harness:verify");
