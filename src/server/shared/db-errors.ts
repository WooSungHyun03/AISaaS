/**
 * Postgres "undefined column/table/function" and PostgREST schema-cache misses: the running code expects a
 * newer database than the one it is connected to (a migration was not applied yet).
 */
const SCHEMA_ERROR_CODES = new Set(["42703", "42P01", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"]);

function dbCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** True when `error` (or anything in its `cause` chain) is a "the database is behind the code" error. */
export function isMissingSchemaError(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    const code = dbCode(current);
    if (code && SCHEMA_ERROR_CODES.has(code)) return true;
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}
