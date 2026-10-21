#!/usr/bin/env node
/**
 * Easy Marketing quality gates. No edits, paid APIs, production DB queries, or deploys.
 * Claude performs the diagnose -> fix -> rerun loop documented in docs/HARNESS.md.
 * Usage: node scripts/harness/run.mjs audit|focus <scope>|verify|demo|perf
 */
import { spawn } from "node:child_process";
import { readFile, access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const scopes = JSON.parse(await readFile(path.join(ROOT, "scripts/harness/scopes.json"), "utf8"));
const [profile = "audit", scope, ...extra] = process.argv.slice(2);
const profiles = ["audit", "focus", "verify", "demo", "perf"];
if (extra.length || !profiles.includes(profile) || (profile === "focus" && !Object.hasOwn(scopes, scope))) {
  console.error(`Usage: node scripts/harness/run.mjs audit|focus <${Object.keys(scopes).join("|")}>|verify|demo|perf`);
  process.exit(2);
}

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const REPORT_DIR = path.join(ROOT, ".tmp/harness");
const report = { runAt: new Date().toISOString(), profile, scope: profile === "focus" ? scope : null, gates: [], outcome: "UNKNOWN" };
const exists = async (p) => access(path.join(ROOT, p)).then(() => true, () => false);
const add = (name, pass, note = "", durationMs = 0) => {
  const status = pass ? "PASS" : "FAIL";
  report.gates.push({ name, status, note, durationMs });
  console.log(`[${status}] ${name}${note ? ` — ${note}` : ""}`);
};

async function command(label, cmd, args, options = {}) {
  const start = Date.now();
  const capture = options.capture === true;
  const env = { ...process.env, ...(options.env || {}) };
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const outcome = await new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", shell: false });
    let output = "";
    if (capture) child.stdout.on("data", (data) => { const txt = data.toString(); output += txt; process.stdout.write(txt); });
    let timedOut = false;
    const timeoutMs = Number(process.env.HARNESS_STEP_TIMEOUT_MS || 900000);
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve({ ok: false, output, note: error.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0 && !timedOut, output, note: timedOut ? "timeout" : `exit ${code}` }); });
  });
  add(label, outcome.ok, outcome.note, Date.now() - start);
  return outcome;
}

async function audit() {
  const essential = [
    "AGENTS.md", "CLAUDE.md", "docs/HARNESS.md", "docs/harness/ACCEPTANCE.md",
    "package.json", ".github/workflows/ci.yml", "vercel.json",
    "src/server/automations", "src/server/channels", "src/server/ai", "src/server/shorts",
    "src/server/budget", "src/server/billing", "src/server/security",
    "src/app/api/cron/run-automations/route.ts", "src/app/api/cron/collect-metrics/route.ts"
  ];
  const missing = [];
  for (const file of essential) if (!(await exists(file))) missing.push(file);
  add("critical repository paths", missing.length === 0, missing.length ? missing.join(", ") : `${essential.length} present`);

  for (const [name, definition] of Object.entries(scopes)) {
    const absent = [];
    for (const file of [...definition.paths, ...definition.tests]) if (!(await exists(file))) absent.push(file);
    add(`scope:${name} paths and tests`, absent.length === 0, absent.length ? absent.join(", ") : `${definition.tests.length} test files`);
  }

  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const requiredScripts = ["lint", "typecheck", "test", "build", "e2e:schedule", "e2e:photos", "e2e:collection", "e2e:admin", "e2e:guide", "e2e:journey", "perf:measure"];
  add("package scripts", requiredScripts.every((key) => typeof pkg.scripts?.[key] === "string"), requiredScripts.filter((key) => !pkg.scripts?.[key]).join(", ") || "present");

  const claude = await readFile(path.join(ROOT, "CLAUDE.md"), "utf8");
  add("Claude harness entrypoint", claude.includes("@docs/HARNESS.md"), "CLAUDE.md must import @docs/HARNESS.md");
  const ci = await readFile(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  add("CI harness gate", ci.includes("npm run harness:audit"), "CI must run the static audit");

  const tracked = await new Promise((resolve) => {
    const child = spawn("git", ["ls-files"], { cwd: ROOT });
    let body = "";
    child.stdout.on("data", d => body += d.toString());
    child.on("error", () => resolve(null));
    child.on("close", code => resolve(code === 0 ? body.split(/\r?\n/) : null));
  });
  if (!tracked) add("git tracked secret check", false, "git ls-files unavailable");
  else {
    const unsafe = tracked.filter(file => /(^|\/)(\.env($|\.(?!example$))|[^/]+\.pem$|service[_-]?role[_-]?key)/i.test(file) && file !== ".env.example");
    add("git tracked secret filenames", unsafe.length === 0, unsafe.length ? unsafe.join(", ") : "none");
  }
}

async function guardLocalDemo() {
  const base = process.env.E2E_BASE_URL || "http://localhost:3100";
  let parsed;
  try { parsed = new URL(base); } catch { add("local E2E guard", false, "Invalid E2E_BASE_URL"); return false; }
  const validHost = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  // The browser target alone is not enough: a LOCAL Next server could still point to production Supabase.
  const localEnvPath = path.join(ROOT, ".env.local");
  const localEnv = await readFile(localEnvPath, "utf8").catch(() => "");
  const matched = localEnv.match(/^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\s"'#]+)["']?/m);
  let localDb = false;
  try { localDb = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(matched?.[1] || "").hostname); } catch { /* missing or malformed URL */ }
  const currentDb = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (currentDb) {
    try { localDb = localDb && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(currentDb).hostname); }
    catch { localDb = false; }
  }
  const valid = process.env.HARNESS_ALLOW_LOCAL_E2E === "1" && validHost && localDb && ["http:", "https:"].includes(parsed.protocol);
  add("local E2E guard", valid, valid ? `${base}; explicitly local Supabase .env.local` : "Require HARNESS_ALLOW_LOCAL_E2E=1, localhost E2E_BASE_URL and .env.local NEXT_PUBLIC_SUPABASE_URL pointing to localhost. Never test against production DB.");
  return valid;
}

async function performance() {
  const result = await command("performance measurement", "npm", ["run", "perf:measure"], { capture: true });
  if (!result.ok) return;
  const lines = [...result.output.matchAll(/^(최근 7일|최근 30일|최근 90일|일별|주별|월별)\s+selected\s+(\d+)ms\s+settled\s+\d+ms\s+network requests\s+(\d+)/gm)];
  const maxMs = Number(process.env.HARNESS_GROWTH_SELECT_MS ?? 250);
  const maxNetwork = Number(process.env.HARNESS_GROWTH_REQUESTS ?? 0);
  const failures = lines.filter(m => Number(m[2]) > maxMs || Number(m[3]) > maxNetwork).map(m => `${m[1]} ${m[2]}ms / ${m[3]} requests`);
  add("growth filter interaction budget", lines.length === 6 && failures.length === 0,
    failures.length ? failures.join("; ") : `${lines.length}/6 recorded; <=${maxMs}ms, <=${maxNetwork} requests`);
}

try {
  await audit();
  if (profile === "focus") {
    await command(`focused ${scope} tests`, "npm", ["test", "--", ...scopes[scope].tests]);
  }
  if (profile === "verify") {
    for (const [label, args] of [
      ["lint", ["run", "lint"]], ["typecheck", ["run", "typecheck"]],
      ["unit tests", ["test"]], ["production build", ["run", "build"]]
    ]) await command(label, "npm", args);
    await command("git diff whitespace check", "git", ["diff", "--check"]);
  }
  if (profile === "demo" || profile === "perf") {
    if (await guardLocalDemo()) {
      if (profile === "demo") {
        for (const [label, npmScript] of [
          ["scheduled blog/Shorts", "e2e:schedule"], ["reference photos", "e2e:photos"],
          ["channel collection", "e2e:collection"], ["admin access", "e2e:admin"],
          ["guide pages", "e2e:guide"], ["new-user journey", "e2e:journey"]
        ]) await command(label, "npm", ["run", npmScript], { env: { AI_PROVIDER: "mock", BILLING_PROVIDER: "mock", CHANNEL_DATA_PROVIDER: "mock", ALLOW_MOCK_AI: "true" } });
        await command("desktop/mobile page sweep", "node", ["scripts/e2e/page-sweep.mjs"]);
        await command("monkey sweep (desktop)", "node", ["scripts/e2e/monkey-sweep.mjs"]);
        await command("monkey sweep (mobile)", "node", ["scripts/e2e/monkey-sweep.mjs", "--mobile"]);
        await command("local credit ledger DB", "npm", ["run", "test:credits-db"]);
        await command("local RLS / scheduler / growth / budget DB tests", "npx", ["vitest", "run",
          "src/server/admin/admin-security.db.test.ts", "src/server/security/row-caps.db.test.ts",
          "src/server/automations/scheduler.db.test.ts", "src/server/channels/channel-collection.db.test.ts",
          "src/server/budget/ledger.db.test.ts"], { env: { RUN_DB_TESTS: "true" } });
      } else await performance();
    }
  }
} catch (error) {
  add("harness infrastructure", false, error instanceof Error ? error.message : String(error));
}
report.outcome = report.gates.every(g => g.status === "PASS") ? "PASS" : "FAIL";
report.finishedAt = new Date().toISOString();
await mkdir(REPORT_DIR, { recursive: true });
const resultPath = path.join(REPORT_DIR, `${stamp}-${profile}${scope ? `-${scope}` : ""}.json`);
await writeFile(resultPath, JSON.stringify(report, null, 2) + "\n");
const lines = [`# Harness result — ${profile}${scope ? ` / ${scope}` : ""}`, "", `- Start: ${report.runAt}`, `- Result: **${report.outcome}**`, "", "| Gate | Result | Note | Duration |", "|---|---|---|---|"];
for (const gate of report.gates) lines.push(`| ${gate.name} | ${gate.status} | ${gate.note.replaceAll("|", "\\|").replaceAll("\n", " ")} | ${gate.durationMs}ms |`);
await writeFile(resultPath.replace(/\.json$/, ".md"), lines.join("\n") + "\n");
console.log(`\nHarness ${report.outcome}: ${resultPath}\nFailures: ${report.gates.filter(g => g.status === "FAIL").map(g => g.name).join(", ") || "none"}`);
process.exitCode = report.outcome === "PASS" ? 0 : 1;
