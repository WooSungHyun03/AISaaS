import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORTS = [54320, 54321, 54322, 54323, 54324, 54325, 54326, 54327, 54328, 54329, 54330];

async function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve(true)));
  });
}

async function selectPortOffset(ports, requestedOffset) {
  const candidates = requestedOffset === undefined
    ? Array.from({ length: 20 }, (_, index) => 1_000 + index * 100)
    : [requestedOffset];
  for (const offset of candidates) {
    const checks = await Promise.all(ports.map((port) => portIsAvailable(port + offset)));
    if (checks.every(Boolean)) return offset;
  }
  throw new Error("로컬 Supabase에 사용할 빈 포트 묶음을 찾지 못했습니다. DEV_DB_PORT_OFFSET을 다른 값으로 지정해주세요.");
}

function localStorageMigration(sourceName) {
  return `-- Generated local-only copy of ${sourceName}.
-- The public bucket is sufficient for local asset URLs. storage.objects is
-- owned by Supabase's storage role, so policy DDL from the application
-- migration is intentionally omitted in this disposable local copy.
insert into storage.buckets (id, name, public)
values ('marketing-assets', 'marketing-assets', true)
on conflict (id) do update set public = excluded.public;
`;
}

function nextMigrationVersion(version, usedVersions) {
  let suffix = 1;
  let candidate = `${version}${String(suffix).padStart(2, "0")}`;
  while (usedVersions.has(candidate)) {
    suffix += 1;
    candidate = `${version}${String(suffix).padStart(2, "0")}`;
  }
  return candidate;
}

export async function copyLocalMigrations(sourceDir, targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  const files = (await readdir(sourceDir)).filter((name) => name.endsWith(".sql")).sort();
  const reservedVersions = new Set(files.map((name) => /^(\d+)_/.exec(name)?.[1]).filter(Boolean));
  const usedVersions = new Set();
  const manifest = [];

  for (const sourceName of files) {
    const match = /^(\d+)_([^/]+\.sql)$/.exec(sourceName);
    if (!match) throw new Error(`올바르지 않은 migration 파일명입니다: ${sourceName}`);
    const [, originalVersion, description] = match;
    let version = originalVersion;
    let reason = "copied";
    if (usedVersions.has(version)) {
      version = nextMigrationVersion(version, new Set([...usedVersions, ...reservedVersions]));
      reason = `duplicate version ${originalVersion} -> ${version}`;
    }
    usedVersions.add(version);
    const targetName = `${version}_${description}`;
    const sourcePath = path.join(sourceDir, sourceName);
    const targetPath = path.join(targetDir, targetName);
    if (originalVersion === "0027" && sourceName.includes("instagram_marketing_assets_bucket")) {
      await writeFile(targetPath, localStorageMigration(sourceName), "utf8");
      reason = "local storage ownership workaround";
    } else {
      await copyFile(sourcePath, targetPath);
    }
    manifest.push({ source: sourceName, target: targetName, reason });
  }

  await writeFile(path.join(targetDir, "LOCAL_MIGRATION_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function configureLocalPorts(configPath, requestedOffset) {
  let config = await readFile(configPath, "utf8");
  const configuredPorts = [...new Set(config.match(/\b543\d{2}\b/g)?.map(Number) ?? DEFAULT_PORTS)].sort((a, b) => a - b);
  const offset = await selectPortOffset(configuredPorts, requestedOffset);
  config = config.replace(/^project_id\s*=.*$/m, 'project_id = "autobiz-dev-db"');
  for (const port of configuredPorts) {
    config = config.replaceAll(String(port), String(port + offset));
  }
  await writeFile(configPath, config, "utf8");
  const ports = Object.fromEntries(configuredPorts.map((port) => [port, port + offset]));
  await writeFile(path.join(path.dirname(configPath), "LOCAL_PORTS.json"), `${JSON.stringify({ offset, ports }, null, 2)}\n`, "utf8");
  return { offset, ports };
}

export async function prepareDevDb({ repoRoot, workRoot, requestedOffset, configurePorts = true }) {
  const sourceSupabase = path.join(repoRoot, "supabase");
  const targetSupabase = path.join(workRoot, "supabase");
  const configPath = path.join(targetSupabase, "config.toml");
  await access(configPath);
  const manifest = await copyLocalMigrations(path.join(sourceSupabase, "migrations"), path.join(targetSupabase, "migrations"));
  await copyFile(path.join(sourceSupabase, "seed.sql"), path.join(targetSupabase, "seed.sql"));
  const portConfig = configurePorts ? await configureLocalPorts(configPath, requestedOffset) : null;
  return { manifest, portConfig };
}

async function main() {
  const [repoRootArg, workRootArg] = process.argv.slice(2);
  if (!repoRootArg || !workRootArg) throw new Error("Usage: node scripts/prepare-dev-db.mjs <repo-root> <work-root>");
  const requestedOffset = process.env.DEV_DB_PORT_OFFSET ? Number(process.env.DEV_DB_PORT_OFFSET) : undefined;
  if (requestedOffset !== undefined && (!Number.isInteger(requestedOffset) || requestedOffset < 100 || requestedOffset > 10_000)) {
    throw new Error("DEV_DB_PORT_OFFSET은 100~10000 사이의 정수여야 합니다.");
  }
  const result = await prepareDevDb({
    repoRoot: path.resolve(repoRootArg),
    workRoot: path.resolve(workRootArg),
    requestedOffset,
    configurePorts: process.env.DEV_DB_KEEP_PORTS !== "1",
  });
  console.log(`[dev-db] migrations: ${result.manifest.length}개 준비`);
  if (result.portConfig) {
    console.log(`[dev-db] API/DB/Studio ports: ${result.portConfig.ports[54321]}/${result.portConfig.ports[54322]}/${result.portConfig.ports[54323]}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[dev-db] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

