import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareDevDb } from "./prepare-dev-db.mjs";

const temporaryRoots = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "autobiz-dev-db-"));
  temporaryRoots.push(root);
  const repoRoot = path.join(root, "repo");
  const workRoot = path.join(root, "work");
  await mkdir(path.join(repoRoot, "supabase", "migrations"), { recursive: true });
  await mkdir(path.join(workRoot, "supabase"), { recursive: true });
  await writeFile(path.join(workRoot, "supabase", "config.toml"), 'project_id = "fixture"\n[api]\nport = 54321\n', "utf8");
  await writeFile(path.join(repoRoot, "supabase", "seed.sql"), "select 'seed';\n", "utf8");
  return { repoRoot, workRoot };
}

describe("prepareDevDb", () => {
  it("renames duplicate migration versions only in the disposable copy", async () => {
    const { repoRoot, workRoot } = await fixture();
    const migrations = path.join(repoRoot, "supabase", "migrations");
    await writeFile(path.join(migrations, "0018_scheduler.sql"), "select 'scheduler';\n", "utf8");
    await writeFile(path.join(migrations, "0018_setup.sql"), "select 'setup';\n", "utf8");

    const result = await prepareDevDb({ repoRoot, workRoot, configurePorts: false });

    expect(result.manifest.map((item) => item.target)).toEqual(["0018_scheduler.sql", "001801_setup.sql"]);
    expect(await readFile(path.join(migrations, "0018_setup.sql"), "utf8")).toBe("select 'setup';\n");
    expect(await readFile(path.join(workRoot, "supabase", "migrations", "001801_setup.sql"), "utf8")).toBe("select 'setup';\n");
  });

  it("does not reuse a version already reserved by another source migration", async () => {
    const { repoRoot, workRoot } = await fixture();
    const migrations = path.join(repoRoot, "supabase", "migrations");
    await writeFile(path.join(migrations, "0018_a.sql"), "select 'a';\n", "utf8");
    await writeFile(path.join(migrations, "0018_b.sql"), "select 'b';\n", "utf8");
    await writeFile(path.join(migrations, "001801_existing.sql"), "select 'existing';\n", "utf8");

    const result = await prepareDevDb({ repoRoot, workRoot, configurePorts: false });

    expect(result.manifest.map((item) => item.target)).toEqual(expect.arrayContaining([
      "0018_a.sql",
      "001802_b.sql",
      "001801_existing.sql",
    ]));
  });

  it("keeps the bucket but removes storage.objects policy DDL from the local 0027 copy", async () => {
    const { repoRoot, workRoot } = await fixture();
    const source = path.join(repoRoot, "supabase", "migrations", "0027_instagram_marketing_assets_bucket.sql");
    await writeFile(source, "insert into storage.buckets values ('marketing-assets');\nalter table storage.objects enable row level security;\n", "utf8");

    await prepareDevDb({ repoRoot, workRoot, configurePorts: false });

    const copied = await readFile(path.join(workRoot, "supabase", "migrations", "0027_instagram_marketing_assets_bucket.sql"), "utf8");
    expect(copied).toContain("insert into storage.buckets");
    expect(copied).not.toMatch(/alter table storage\.objects|create policy/i);
    expect(await readFile(source, "utf8")).toContain("alter table storage.objects");
  });
});

