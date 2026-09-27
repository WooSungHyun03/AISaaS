import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");

/**
 * Test-only helper shared by taxonomy.test.ts and status.test.ts: finds the
 * highest-numbered migration file that mentions `constraintName`, so a test
 * always compares against the *current* DB constraint — not a hardcoded
 * file name — even after a future migration replaces this one.
 */
export function readLatestMigrationSql(constraintName: string): string {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_.*\.sql$/.test(file))
    .sort() // "0001_..." < "0002_..." lexicographically, since the prefix is zero-padded
    .reverse();

  for (const file of migrationFiles) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    if (sql.includes(constraintName)) return sql;
  }

  throw new Error(`No migration in ${MIGRATIONS_DIR} mentions constraint "${constraintName}"`);
}

/** Extracts the quoted values out of `<constraintName> ... in (...)`. */
export function extractCheckConstraintValues(sql: string, constraintName: string): string[] {
  const pattern = new RegExp(`${constraintName}[\\s\\S]*?in\\s*\\(([^)]*)\\)`, "i");
  const match = sql.match(pattern);
  if (!match) {
    throw new Error(`Could not find an "in (...)" value list for constraint "${constraintName}"`);
  }

  return match[1]
    .split(",")
    .map((value) => value.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}
